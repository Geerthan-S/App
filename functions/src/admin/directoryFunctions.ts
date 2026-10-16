/**
 * Admin directory: doctors, hospitals and duties, global search, and the
 * account / duty actions support staff need outside the report queue.
 *
 * Reads are staff-only. Profile views are audited because they expose
 * personal data. Mutations need a support or super admin with a fresh sign-in
 * and record a reason code.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import type { DocumentData, DocumentSnapshot, Query } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAdmin, requireStaff, requireStepUpAuth, staffRoleOf } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit, stageAudit } from '../audit/auditLogger';
import { CorrelationField, NotesSchema, ReasonCodeSchema, parseOrThrow, subjectNameOf, toIso } from './adminShared';

const PAGE = 25;

const PageSchema = {
  cursor: DocIdSchema.optional(),
  limit: z.number().int().min(1).max(50).default(PAGE),
  ...CorrelationField,
};

/** Runs a query one page at a time, using the last document ID as the cursor. */
const page = async (collection: string, query: Query, cursor: string | undefined, limit: number, correlationId: string) => {
  let q = query;
  if (cursor) {
    const cursorSnap = await db().collection(collection).doc(cursor).get();
    if (!cursorSnap.exists) throw new DomainError('VALIDATION_FAILED', 'Unknown page cursor', correlationId);
    q = q.startAfter(cursorSnap);
  }
  const snap = await q.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  return { docs, nextCursor: snap.docs.length > limit ? docs[docs.length - 1].id : null };
};

const accountStatusOf = (user: DocumentData | undefined): string => user?.status ?? 'active';

const doctorRow = (doc: DocumentSnapshot, user?: DocumentData) => {
  const d = doc.data() ?? {};
  return {
    doctorId: doc.id,
    fullName: d.fullName ?? null,
    council: d.council ?? null,
    registrationNo: d.registrationNo ?? null,
    primarySpecialty: d.primarySpecialty ?? null,
    yearsOfExperience: d.yearsOfExperience ?? null,
    preferredCities: Array.isArray(d.preferredCities) ? d.preferredCities : [],
    isVerified: d.isVerified === true,
    verificationStatus: d.verificationStatus ?? (d.isVerified ? 'approved' : 'unverified'),
    verifiedAt: toIso(d.verifiedAt),
    accountStatus: accountStatusOf(user),
    createdAt: toIso(d.createdAt),
  };
};

const orgRow = (doc: DocumentSnapshot) => {
  const o = doc.data() ?? {};
  return {
    organizationId: doc.id,
    name: subjectNameOf(o),
    legalName: o.legalName ?? null,
    organizationType: o.organizationType ?? null,
    registrationNumber: o.registrationNumber ?? null,
    city: o.city ?? null,
    verificationState: o.verificationState ?? 'draft',
    createdAt: toIso(o.createdAt),
  };
};

const dutyRow = (doc: DocumentSnapshot) => {
  const u = doc.data() ?? {};
  return {
    dutyId: doc.id,
    organizationId: u.organizationId ?? null,
    facilityName: u.facilityName ?? null,
    city: u.city ?? null,
    department: u.department ?? null,
    specialtyName: u.specialtyName ?? null,
    startAt: u.schedule?.startAt ?? null,
    endAt: u.schedule?.endAt ?? null,
    shiftType: u.schedule?.shiftType ?? null,
    headcount: u.headcount ?? null,
    remainingHeadcount: u.remainingHeadcount ?? null,
    payment: u.paymentTerms ? { amount: u.paymentTerms.amount, currency: u.paymentTerms.currency, basis: u.paymentTerms.basis } : null,
    status: u.status ?? 'draft',
    moderationHidden: u.moderationHidden === true,
    hiddenReason: u.hiddenReason ?? null,
    hiddenAt: toIso(u.hiddenAt),
    createdAt: toIso(u.createdAt),
  };
};

/** Attaches each doctor's account status from `users`. */
const withAccounts = async (docs: DocumentSnapshot[]) => {
  const users = docs.length ? await db().getAll(...docs.map(d => db().collection('users').doc(d.id))) : [];
  return docs.map((doc, i) => doctorRow(doc, users[i]?.data()));
};

// ── Doctors ───────────────────────────────────────────────

const ListDoctorsSchema = z.object({
  filter: z.enum(['all', 'verified', 'unverified', 'suspended']).default('all'),
  ...PageSchema,
}).strict();

export const listDoctors = domainCall('listDoctors', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireStaff(request, correlationId);
  const { filter, cursor, limit } = parseOrThrow(ListDoctorsSchema, request.data, correlationId, 'Invalid doctor query');

  if (filter === 'suspended') {
    // Suspension lives on the account, so page through suspended doctor accounts.
    const users = db().collection('users').where('status', '==', 'suspended').where('activeRole', '==', 'doctor');
    const { docs, nextCursor } = await page('users', users.orderBy('suspendedAt', 'desc'), cursor, limit, correlationId);
    const doctors = docs.length ? await db().getAll(...docs.map(d => db().collection('doctors').doc(d.id))) : [];
    return {
      doctors: doctors.filter(d => d.exists).map(d => doctorRow(d, docs.find(u => u.id === d.id)?.data())),
      nextCursor,
    };
  }

  let query: Query = db().collection('doctors');
  if (filter !== 'all') query = query.where('isVerified', '==', filter === 'verified');
  const { docs, nextCursor } = await page('doctors', query.orderBy('createdAt', 'desc'), cursor, limit, correlationId);
  return { doctors: await withAccounts(docs), nextCursor };
}, { audience: 'staff' });

const isSupportOrSuper = (request: CallableRequest) =>
  request.auth?.token?.isSupportAdmin === true || request.auth?.token?.isSuperAdmin === true;

/** Sign-in details from Firebase Auth. Contact details are shown to support staff only. */
const authSummary = async (uid: string, includeContact: boolean) => {
  try {
    const user = await getAuth().getUser(uid);
    return {
      exists: true,
      disabled: user.disabled,
      providers: user.providerData.map(p => p.providerId),
      createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : null,
      lastSignInAt: user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null,
      email: includeContact ? user.email ?? null : null,
      phoneNumber: includeContact ? user.phoneNumber ?? null : null,
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') return { exists: false };
    throw error;
  }
};

const caseHistory = async (subjectId: string) => {
  const snap = await db().collection('verificationCases').where('subjectId', '==', subjectId).limit(30).get();
  return snap.docs.map(doc => {
    const c = doc.data();
    return {
      caseId: doc.id,
      status: c.status,
      subjectRevision: c.subjectRevision ?? 1,
      submittedAt: toIso(c.submittedAt),
      decidedAt: toIso(c.decidedAt),
      decisionReason: c.decisionReason ?? null,
      escalated: c.escalated === true,
      createdAt: toIso(c.createdAt),
    };
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
};

const countOf = async (query: Query): Promise<number> => (await query.count().get()).data().count;

export const getDoctorProfile = domainCall('getDoctorProfile', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireStaff(request, correlationId);
  const { doctorId } = parseOrThrow(z.object({ doctorId: DocIdSchema, ...CorrelationField }).strict(),
    request.data, correlationId, 'doctorId is required');

  const [doctorSnap, userSnap] = await Promise.all([
    db().collection('doctors').doc(doctorId).get(),
    db().collection('users').doc(doctorId).get(),
  ]);
  if (!doctorSnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Doctor not found', correlationId);
  const d = doctorSnap.data()!;
  const user = userSnap.data();
  const assignments = db().collection('assignments').where('doctorId', '==', doctorId);

  const [auth, cases, totalAssignments, completedAssignments, cancelledAssignments, reportsAgainst] = await Promise.all([
    authSummary(doctorId, isSupportOrSuper(request)),
    caseHistory(doctorId),
    countOf(assignments),
    countOf(assignments.where('status', '==', 'completed')),
    countOf(assignments.where('status', '==', 'cancelled')),
    countOf(db().collection('moderationReports').where('targetId', '==', doctorId)),
  ]);

  await logAudit({
    actorId: uid,
    actorRole: staffRoleOf(request),
    action: 'DOCTOR_PROFILE_VIEWED',
    targetType: 'doctors',
    targetId: doctorId,
    reasonCode: 'STAFF_LOOKUP',
    correlationId,
    result: 'SUCCESS',
  });

  return {
    doctor: {
      ...doctorRow(doctorSnap, user),
      qualification: d.qualification ?? null,
      specialties: Array.isArray(d.specialties) ? d.specialties : [],
      bio: d.bio ?? '',
      profileRevision: d.profileRevision ?? 1,
      verifiedCaseId: d.verifiedCaseId ?? null,
      renewalReminderAt: toIso(d.renewalReminderAt),
    },
    account: {
      status: accountStatusOf(user),
      suspendedAt: toIso(user?.suspendedAt),
      suspensionReason: user?.suspensionReason ?? null,
      consentVersion: user?.consentVersion ?? null,
      auth,
    },
    cases,
    stats: { totalAssignments, completedAssignments, cancelledAssignments, reportsAgainst },
  };
}, { audience: 'staff' });

// ── Hospitals ─────────────────────────────────────────────

const ListOrgsSchema = z.object({
  filter: z.enum(['all', 'approved', 'submitted', 'draft', 'rejected', 'needs_information']).default('all'),
  ...PageSchema,
}).strict();

export const listOrganizations = domainCall('listOrganizations', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireStaff(request, correlationId);
  const { filter, cursor, limit } = parseOrThrow(ListOrgsSchema, request.data, correlationId, 'Invalid hospital query');

  let query: Query = db().collection('organizations');
  if (filter !== 'all') query = query.where('verificationState', '==', filter);
  const { docs, nextCursor } = await page('organizations', query.orderBy('createdAt', 'desc'), cursor, limit, correlationId);
  return { organizations: docs.map(orgRow), nextCursor };
}, { audience: 'staff' });

export const getOrganizationProfile = domainCall('getOrganizationProfile', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireStaff(request, correlationId);
  const { organizationId } = parseOrThrow(z.object({ organizationId: DocIdSchema, ...CorrelationField }).strict(),
    request.data, correlationId, 'organizationId is required');

  const orgRef = db().collection('organizations').doc(organizationId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Hospital not found', correlationId);
  const o = orgSnap.data()!;
  const duties = db().collection('duties').where('organizationId', '==', organizationId);

  const [facilities, members, cases, published, filled, completed, reportsAgainst] = await Promise.all([
    orgRef.collection('facilities').limit(50).get(),
    orgRef.collection('members').limit(100).get(),
    caseHistory(organizationId),
    countOf(duties.where('status', '==', 'published')),
    countOf(duties.where('status', '==', 'filled')),
    countOf(duties.where('status', '==', 'completed')),
    countOf(db().collection('moderationReports').where('targetId', '==', organizationId)),
  ]);

  await logAudit({
    actorId: uid,
    actorRole: staffRoleOf(request),
    action: 'ORGANIZATION_PROFILE_VIEWED',
    targetType: 'organizations',
    targetId: organizationId,
    reasonCode: 'STAFF_LOOKUP',
    correlationId,
    result: 'SUCCESS',
  });

  return {
    organization: { ...orgRow(orgSnap), displayName: o.displayName ?? null, address: o.address ?? null, verifiedAt: toIso(o.verifiedAt) },
    facilities: facilities.docs.map(f => ({
      facilityId: f.id, name: f.data().name ?? null, city: f.data().city ?? null,
      address: f.data().address ?? null, status: f.data().status ?? 'active',
    })),
    members: members.docs.map(m => ({
      userId: m.id, role: m.data().role ?? 'member', status: m.data().status ?? 'active', joinedAt: toIso(m.data().joinedAt),
    })),
    cases,
    stats: { published, filled, completed, reportsAgainst },
  };
}, { audience: 'staff' });

// ── Duties ────────────────────────────────────────────────

const DUTY_FILTERS = ['all', 'draft', 'published', 'paused', 'filled', 'in_progress', 'completed', 'closed', 'cancelled', 'hidden'] as const;
const ListDutiesSchema = z.object({ filter: z.enum(DUTY_FILTERS).default('all'), ...PageSchema }).strict();

export const listDuties = domainCall('listDuties', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireStaff(request, correlationId);
  const { filter, cursor, limit } = parseOrThrow(ListDutiesSchema, request.data, correlationId, 'Invalid duty query');

  let query: Query = db().collection('duties');
  if (filter === 'hidden') query = query.where('moderationHidden', '==', true);
  else if (filter !== 'all') query = query.where('status', '==', filter);
  const { docs, nextCursor } = await page('duties', query.orderBy('createdAt', 'desc'), cursor, limit, correlationId);

  // Hospital names for the page in one batch read.
  const orgIds = [...new Set(docs.map(d => d.data()?.organizationId).filter((id): id is string => typeof id === 'string'))];
  const orgs = orgIds.length ? await db().getAll(...orgIds.map(id => db().collection('organizations').doc(id))) : [];
  const orgNames = new Map(orgs.map(o => [o.id, subjectNameOf(o.data())]));
  return {
    duties: docs.map(doc => ({ ...dutyRow(doc), organizationName: orgNames.get(doc.data()?.organizationId) ?? null })),
    nextCursor,
  };
}, { audience: 'staff' });

const DutyVisibilitySchema = z.object({
  dutyId: DocIdSchema,
  visibility: z.enum(['hidden', 'visible']),
  reasonCode: ReasonCodeSchema,
  notes: NotesSchema,
  ...CorrelationField,
}).strict();

/**
 * Hides a published duty from doctors, or restores one hidden by moderation.
 * A duty whose start time has passed cannot be republished.
 */
export const setDutyVisibility = domainCall('setDutyVisibility', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);
  const { dutyId, visibility, reasonCode, notes } =
    parseOrThrow(DutyVisibilitySchema, request.data, correlationId, 'Invalid duty visibility change');

  const dutyRef = db().collection('duties').doc(dutyId);
  return db().runTransaction(async tx => {
    const snap = await tx.get(dutyRef);
    if (!snap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
    const duty = snap.data()!;

    if (visibility === 'hidden') {
      if (duty.status !== 'published') {
        throw new DomainError('INVALID_STATE_TRANSITION', `Only published duties can be hidden (this one is ${duty.status})`, correlationId);
      }
      tx.update(dutyRef, {
        status: 'paused',
        moderationHidden: true,
        statusBeforeHide: duty.status,
        hiddenBy: uid,
        hiddenAt: nowTimestamp(),
        hiddenReason: reasonCode,
        updatedAt: nowTimestamp(),
      });
    } else {
      if (duty.moderationHidden !== true || duty.status !== 'paused') {
        throw new DomainError('INVALID_STATE_TRANSITION', 'Only duties hidden by moderation can be restored here', correlationId);
      }
      if (Date.parse(duty.schedule?.startAt) <= Date.now()) {
        throw new DomainError('INVALID_STATE_TRANSITION', 'The duty has already started, so it cannot be republished', correlationId);
      }
      tx.update(dutyRef, {
        status: duty.statusBeforeHide === 'published' ? 'published' : 'paused',
        moderationHidden: false,
        restoredBy: uid,
        restoredAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      });
    }
    stageAudit(tx, {
      actorId: uid,
      actorRole: staffRoleOf(request),
      action: visibility === 'hidden' ? 'DUTY_HIDDEN' : 'DUTY_RESTORED',
      targetType: 'duties',
      targetId: dutyId,
      reasonCode,
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { status: duty.status, moderationHidden: duty.moderationHidden === true },
      afterSummary: { visibility, notes: notes ?? null },
    });
    return { success: true, dutyId, visibility };
  });
}, { audience: 'staff' });

// ── Accounts ──────────────────────────────────────────────

const AccountStatusSchema = z.object({
  uid: DocIdSchema,
  status: z.enum(['suspended', 'active']),
  reasonCode: ReasonCodeSchema,
  notes: NotesSchema,
  ...CorrelationField,
}).strict();

/**
 * Suspends or reinstates any account. Suspension blocks every callable at the
 * shared boundary and ends the account's sessions. Staff accounts can only be
 * changed by a super admin, and nobody can change their own account.
 */
export const setAccountStatus = domainCall('setAccountStatus', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const adminUid = requireAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);
  const { uid, status, reasonCode, notes } = parseOrThrow(AccountStatusSchema, request.data, correlationId, 'Invalid account change');

  if (uid === adminUid) {
    throw new DomainError('PERMISSION_DENIED', 'You cannot change your own account status', correlationId);
  }
  const target = await getAuth().getUser(uid).catch(error => {
    if ((error as { code?: string }).code === 'auth/user-not-found') {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Account not found', correlationId);
    }
    throw error;
  });
  const targetIsStaff = ['isVerifier', 'isSupportAdmin', 'isSuperAdmin'].some(c => target.customClaims?.[c] === true);
  if (targetIsStaff && request.auth?.token?.isSuperAdmin !== true) {
    throw new DomainError('PERMISSION_DENIED', 'Only a super admin can suspend or reinstate a staff account', correlationId);
  }

  const userRef = db().collection('users').doc(uid);
  await db().runTransaction(async tx => {
    const current = (await tx.get(userRef)).data();
    const previous = accountStatusOf(current);
    if (previous === status) {
      throw new DomainError('INVALID_STATE_TRANSITION', `Account is already ${status}`, correlationId);
    }
    tx.set(userRef, status === 'suspended' ? {
      status: 'suspended',
      suspendedAt: nowTimestamp(),
      suspendedBy: adminUid,
      suspensionReason: reasonCode,
      updatedAt: nowTimestamp(),
    } : {
      status: 'active',
      suspendedAt: null,
      suspendedBy: null,
      suspensionReason: null,
      reinstatedAt: nowTimestamp(),
      reinstatedBy: adminUid,
      updatedAt: nowTimestamp(),
    }, { merge: true });
    stageAudit(tx, {
      actorId: adminUid,
      actorRole: staffRoleOf(request),
      action: status === 'suspended' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REINSTATED',
      targetType: 'users',
      targetId: uid,
      reasonCode,
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { status: previous },
      afterSummary: { status, notes: notes ?? null },
    });
  });

  if (status === 'suspended') {
    await getAuth().revokeRefreshTokens(uid).catch(error => {
      // The account is already blocked at every callable; record that sessions were not revoked.
      console.error('Refresh token revocation failed after suspension', { uid, error });
    });
  }
  return { success: true, uid, status };
}, { audience: 'staff' });

// ── Search ────────────────────────────────────────────────

const SearchSchema = z.object({ query: z.string().trim().min(2).max(128), ...CorrelationField }).strict();

interface SearchHit { type: 'doctor' | 'organization' | 'duty' | 'case' | 'user'; id: string; title: string; subtitle: string }

/** Prefix range query on a string field (Firestore has no full-text search). */
const prefix = (collection: string, field: string, value: string) =>
  db().collection(collection).where(field, '>=', value).where(field, '<=', `${value}`).limit(5).get();

/**
 * Finds records by exact ID, exact registration number, or name prefix.
 * Email and phone lookups are limited to support staff.
 */
export const adminSearch = domainCall('adminSearch', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireStaff(request, correlationId);
  const { query } = parseOrThrow(SearchSchema, request.data, correlationId, 'Enter at least 2 characters');

  const hits = new Map<string, SearchHit>();
  const add = (hit: SearchHit) => hits.set(`${hit.type}:${hit.id}`, hit);
  const addDoctor = (doc: DocumentSnapshot) => doc.exists && add({
    type: 'doctor', id: doc.id, title: doc.data()?.fullName ?? doc.id,
    subtitle: [doc.data()?.registrationNo, doc.data()?.council].filter(Boolean).join(' · ') || 'Doctor',
  });
  const addOrg = (doc: DocumentSnapshot) => doc.exists && add({
    type: 'organization', id: doc.id, title: subjectNameOf(doc.data()) ?? doc.id,
    subtitle: [doc.data()?.city, doc.data()?.registrationNumber].filter(Boolean).join(' · ') || 'Hospital',
  });

  const capitalized = query.charAt(0).toUpperCase() + query.slice(1);
  const names = [...new Set([query, capitalized])];
  const tasks: Promise<void>[] = [];

  if (DocIdSchema.safeParse(query).success) {
    tasks.push((async () => {
      const [doctor, org, duty, vcase] = await db().getAll(
        db().collection('doctors').doc(query), db().collection('organizations').doc(query),
        db().collection('duties').doc(query), db().collection('verificationCases').doc(query));
      addDoctor(doctor);
      addOrg(org);
      if (duty.exists) {
        add({ type: 'duty', id: duty.id, title: duty.data()?.specialtyName ?? 'Duty',
          subtitle: [duty.data()?.facilityName, duty.data()?.status].filter(Boolean).join(' · ') });
      }
      if (vcase.exists) {
        add({ type: 'case', id: vcase.id, title: `Verification case (${vcase.data()?.subjectType})`,
          subtitle: String(vcase.data()?.status ?? '') });
      }
    })());
  }
  tasks.push((async () => {
    const [reg, regNumber] = await Promise.all([
      db().collection('doctors').where('registrationNo', '==', query).limit(5).get(),
      db().collection('organizations').where('registrationNumber', '==', query).limit(5).get(),
    ]);
    reg.docs.forEach(addDoctor);
    regNumber.docs.forEach(addOrg);
  })());
  for (const name of names) {
    tasks.push(prefix('doctors', 'fullName', name).then(s => { s.docs.forEach(addDoctor); }));
    tasks.push(prefix('organizations', 'legalName', name).then(s => { s.docs.forEach(addOrg); }));
    tasks.push(prefix('organizations', 'displayName', name).then(s => { s.docs.forEach(addOrg); }));
  }
  if (isSupportOrSuper(request) && (query.includes('@') || /^\+\d{8,15}$/.test(query))) {
    tasks.push((async () => {
      const user = await (query.includes('@') ? getAuth().getUserByEmail(query) : getAuth().getUserByPhoneNumber(query))
        .catch(() => null);
      if (user) add({ type: 'user', id: user.uid, title: user.displayName ?? user.email ?? user.phoneNumber ?? user.uid, subtitle: 'Account' });
    })());
  }
  await Promise.all(tasks);

  return { results: [...hits.values()].slice(0, 20) };
}, { audience: 'staff' });

export const getDuty = domainCall('getDuty', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireStaff(request, correlationId);
  const { dutyId } = parseOrThrow(z.object({ dutyId: DocIdSchema, ...CorrelationField }).strict(),
    request.data, correlationId, 'dutyId is required');
  const snap = await db().collection('duties').doc(dutyId).get();
  if (!snap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
  const orgId = snap.data()?.organizationId;
  const org = typeof orgId === 'string' ? await db().collection('organizations').doc(orgId).get() : null;
  return { duty: { ...dutyRow(snap), organizationName: subjectNameOf(org?.data()) } };
}, { audience: 'staff' });
