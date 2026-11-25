/**
 * Staff roles: who can use the admin portal and with which privileges.
 *
 * Roles live in Firebase Auth custom claims (what every guard checks). The
 * `staffDirectory` collection is an index of accounts that hold or held a
 * role, so the portal can list staff without scanning every user; live
 * claims, MFA enrollment and sign-in times are always read back from Auth.
 */

import { randomBytes } from 'crypto';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAdmin, requireAuth, requireStepUpAuth, requireSuperAdmin } from '../security/guards';
import { appCheckEnforced, staffMfaRequired, testingModeNotice } from '../shared/runtime';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit, stageAudit } from '../audit/auditLogger';

export const STAFF_CLAIMS = ['isVerifier', 'isSupportAdmin', 'isSuperAdmin'] as const;
type StaffClaims = Record<typeof STAFF_CLAIMS[number], boolean>;

const ReasonCodeSchema = z.string().regex(/^[A-Z0-9_]{2,64}$/, 'Use an upper-case reason code such as NEW_VERIFIER');

const SetClaimsSchema = z.object({
  targetUid: DocIdSchema.optional(),
  email: z.string().email().max(254).optional(),
  claims: z.object({
    isVerifier: z.boolean(),
    isSupportAdmin: z.boolean(),
    isSuperAdmin: z.boolean(),
  }).strict(),
  reasonCode: ReasonCodeSchema,
  correlationId: z.string().optional(),
}).strict().refine(v => Boolean(v.targetUid) !== Boolean(v.email), { message: 'Give either targetUid or email' });

const staffClaimsOf = (user: UserRecord): StaffClaims => ({
  isVerifier: user.customClaims?.isVerifier === true,
  isSupportAdmin: user.customClaims?.isSupportAdmin === true,
  isSuperAdmin: user.customClaims?.isSuperAdmin === true,
});

const hasAnyRole = (claims: StaffClaims) => STAFF_CLAIMS.some(claim => claims[claim]);

const findUser = async (target: { targetUid?: string; email?: string }, correlationId: string): Promise<UserRecord> => {
  try {
    return target.targetUid ? await getAuth().getUser(target.targetUid) : await getAuth().getUserByEmail(target.email!);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') {
      throw new DomainError('RESOURCE_NOT_FOUND', 'No account matches that user', correlationId);
    }
    throw error;
  }
};

/**
 * Grants or removes staff roles. The request is audited before the claims
 * change, and the outcome after, so a role change can never happen without a
 * record even if a later write fails.
 */
export const setCustomClaims = domainCall('setCustomClaims', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const adminUid = requireSuperAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);

  const parsed = SetClaimsSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid role change', correlationId, parsed.error.flatten().fieldErrors);
  }
  const { claims, reasonCode } = parsed.data;
  const user = await findUser(parsed.data, correlationId);
  if (user.uid === adminUid) {
    throw new DomainError('PERMISSION_DENIED', 'You cannot change your own roles. Ask another super admin.', correlationId);
  }

  const previous = staffClaimsOf(user);
  const privilegeRemoved = STAFF_CLAIMS.some(claim => previous[claim] && !claims[claim]);
  const audit = {
    actorId: adminUid,
    actorRole: 'super_admin',
    targetType: 'users',
    targetId: user.uid,
    reasonCode,
    correlationId,
    beforeSummary: previous,
  };

  await logAudit({ ...audit, action: 'CUSTOM_CLAIMS_CHANGE_REQUESTED', result: 'SUCCESS', afterSummary: claims });

  try {
    // Non-staff claims an account may carry are preserved.
    await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), ...claims });
    if (privilegeRemoved) {
      // Existing sessions would otherwise keep the removed privilege until token refresh.
      await getAuth().revokeRefreshTokens(user.uid);
    }
  } catch (error) {
    await logAudit({ ...audit, action: 'CUSTOM_CLAIMS_SET', result: 'FAILED', afterSummary: claims });
    throw error;
  }

  const batch = db().batch();
  batch.set(db().collection('staffDirectory').doc(user.uid), {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    roles: claims,
    active: hasAnyRole(claims),
    updatedBy: adminUid,
    updatedAt: nowTimestamp(),
  }, { merge: true });
  stageAudit(batch, {
    ...audit,
    action: 'CUSTOM_CLAIMS_SET',
    result: 'SUCCESS',
    afterSummary: { ...claims, sessionsRevoked: privilegeRemoved },
  });
  await batch.commit();

  return { success: true, targetUid: user.uid, claims, sessionsRevoked: privilegeRemoved };
}, { audience: 'staff', rateLimit: { limit: 20, windowSeconds: 600 } });

/** Staff accounts with their live roles, MFA enrollment and last sign-in. */
export const listStaff = domainCall('listStaff', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);

  const directory = await db().collection('staffDirectory').limit(300).get();
  const uids = directory.docs.map(doc => doc.id);
  const users = new Map<string, UserRecord>();
  for (let i = 0; i < uids.length; i += 100) {
    const result = await getAuth().getUsers(uids.slice(i, i + 100).map(uid => ({ uid })));
    result.users.forEach(user => users.set(user.uid, user));
  }

  const staff = directory.docs.map(doc => {
    const user = users.get(doc.id);
    const roles = user ? staffClaimsOf(user) : { isVerifier: false, isSupportAdmin: false, isSuperAdmin: false };
    return {
      uid: doc.id,
      email: user?.email ?? doc.data().email ?? null,
      displayName: user?.displayName ?? doc.data().displayName ?? null,
      roles,
      active: Boolean(user) && !user!.disabled && hasAnyRole(roles),
      disabled: user?.disabled ?? true,
      mfaFactors: user?.multiFactor?.enrolledFactors.map(f => f.factorId) ?? [],
      lastSignInAt: user?.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null,
      missingAccount: !user,
    };
  }).sort((a, b) => Number(b.active) - Number(a.active) || String(a.email).localeCompare(String(b.email)));

  return { staff, viewerCanEdit: request.auth?.token?.isSuperAdmin === true };
}, { audience: 'staff' });

/** Staff usernames map to `<username>@ADMIN_LOGIN_DOMAIN` (admin/js/core/session.js, scripts/set-admin-login.mjs). */
const ADMIN_LOGIN_DOMAIN = 'admin.doctor-c7c29.web.app';
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

const CreateStaffSchema = z.object({
  username: z.string().trim().toLowerCase().regex(USERNAME_PATTERN, '3-32 lowercase letters, digits, ".", "_" or "-"'),
  displayName: z.string().trim().min(2).max(80),
  claims: z.object({
    isVerifier: z.boolean(),
    isSupportAdmin: z.boolean(),
    isSuperAdmin: z.boolean(),
  }).strict().refine(hasAnyRole, 'Choose at least one role'),
  reasonCode: ReasonCodeSchema,
  correlationId: z.string().optional(),
}).strict();

/** 20 random characters from an unambiguous alphabet (~114 bits). */
const temporaryPassword = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(randomBytes(20), byte => alphabet[byte % alphabet.length]).join('');
};

/**
 * Creates a staff login (super admin only). The temporary password is returned
 * once for the super admin to hand over and is never stored or logged; the new
 * staff member must set up an authenticator on first sign-in and should change
 * the password from My account.
 */
export const createStaffAccount = domainCall('createStaffAccount', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const adminUid = requireSuperAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);
  const parsed = CreateStaffSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid staff account', correlationId, parsed.error.flatten().fieldErrors);
  }
  const { username, displayName, claims, reasonCode } = parsed.data;
  const email = `${username}@${ADMIN_LOGIN_DOMAIN}`;

  const existing = await getAuth().getUserByEmail(email).catch(error => {
    if ((error as { code?: string }).code === 'auth/user-not-found') return null;
    throw error;
  });
  if (existing) {
    throw new DomainError('APPLICATION_ALREADY_EXISTS', 'That username is taken', correlationId);
  }

  const audit = { actorId: adminUid, actorRole: 'super_admin', targetType: 'users', reasonCode, correlationId };
  const password = temporaryPassword();
  // Verified so the new staff member can enroll an authenticator (Identity Platform requires it).
  const user = await getAuth().createUser({ email, password, displayName, emailVerified: true });
  try {
    await getAuth().setCustomUserClaims(user.uid, claims);
  } catch (error) {
    await getAuth().deleteUser(user.uid).catch(() => undefined);
    await logAudit({ ...audit, targetId: user.uid, action: 'STAFF_ACCOUNT_CREATED', result: 'FAILED', afterSummary: { username } });
    throw error;
  }

  const batch = db().batch();
  batch.set(db().collection('staffDirectory').doc(user.uid), {
    uid: user.uid, email, displayName, roles: claims, active: true,
    createdBy: adminUid, updatedBy: adminUid, updatedAt: nowTimestamp(), createdAt: nowTimestamp(),
  });
  stageAudit(batch, {
    ...audit,
    targetId: user.uid,
    action: 'STAFF_ACCOUNT_CREATED',
    result: 'SUCCESS',
    afterSummary: { username, displayName, ...claims },
  });
  await batch.commit();

  return { success: true, uid: user.uid, username, email, temporaryPassword: password };
}, { audience: 'staff', rateLimit: { limit: 10, windowSeconds: 3600 } });

/**
 * What this deployment enforces for staff sessions. Checks the staff role but
 * not the second factor, so the portal can learn whether to send a new staff
 * member to authenticator enrollment before anything else will work.
 */
export const getSessionPolicy = domainCall('getSessionPolicy', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAuth(request);
  if (!STAFF_CLAIMS.some(claim => request.auth?.token?.[claim] === true)) {
    throw new DomainError('PERMISSION_DENIED', 'Staff privileges required', correlationId);
  }
  return { requireMfa: staffMfaRequired(), appCheckEnforced: appCheckEnforced(), testingModeNotice: testingModeNotice() };
}, { audience: 'staff' });
