/**
 * Hospital team management (blueprint §4.2): invite staff into a role, accept
 * or decline an invitation, change roles, and offboard people without losing
 * duties or audit history.
 *
 * Invariants:
 *  - only owners/admins manage the team, and only owners can grant or change
 *    the `owner` or `admin` roles;
 *  - nobody changes their own role, and the last active owner can never be
 *    demoted or removed (ownership continuity);
 *  - an invitation is accepted only by the account signed in with the invited
 *    phone number or verified email.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, requireOrgMember, requireOrgPermission } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';
import { CorrelationField, ReasonCodeSchema, parseOrThrow, subjectNameOf, toIso } from '../admin/adminShared';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Roles an invitation can grant. Ownership is transferred by role change, never invited. */
const INVITABLE_ROLES = ['admin', 'recruiter', 'operations'] as const;
const ASSIGNABLE_ROLES = ['owner', 'admin', 'recruiter', 'operations'] as const;
const PRIVILEGED_ROLES = ['owner', 'admin'];

const E164 = /^\+[1-9]\d{7,14}$/;

const orgRef = (orgId: string) => db().collection('organizations').doc(orgId);
const memberRef = (orgId: string, uid: string) => orgRef(orgId).collection('members').doc(uid);
const isActive = (data: DocumentData | undefined) =>
  data !== undefined && (data.status === undefined || data.status === 'active');

/** Active owners other than `exceptUid`, read inside the transaction. */
const otherActiveOwners = async (tx: Transaction, orgId: string, exceptUid: string): Promise<number> => {
  const owners = await tx.get(orgRef(orgId).collection('members').where('role', '==', 'owner'));
  return owners.docs.filter(d => d.id !== exceptUid && isActive(d.data())).length;
};

// ── Invite ────────────────────────────────────────────────

const InviteSchema = z.object({
  organizationId: DocIdSchema,
  phoneNumber: z.string().trim().regex(E164, 'Use international format, e.g. +919876543210').optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  role: z.enum(INVITABLE_ROLES),
  ...CorrelationField,
}).strict().refine(v => Boolean(v.phoneNumber) !== Boolean(v.email), { message: 'Give a phone number or an email' });

export const inviteOrgMember = domainCall('inviteOrgMember', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { organizationId, phoneNumber, email, role } = parseOrThrow(InviteSchema, request.data, correlationId, 'Invalid invitation');
  const inviterRole = await requireOrgPermission(uid, organizationId, 'manageTeam', correlationId);
  if (role === 'admin' && inviterRole !== 'owner') {
    throw new DomainError('PERMISSION_DENIED', 'Only an owner can invite an admin', correlationId);
  }

  const contact = phoneNumber ?? email!;
  const contactField = phoneNumber ? 'inviteePhone' : 'inviteeEmail';
  const invites = db().collection('organizationInvitations');
  const inviteRef = invites.doc();

  await db().runTransaction(async tx => {
    const [org, pending] = await Promise.all([
      tx.get(orgRef(organizationId)),
      tx.get(invites.where('organizationId', '==', organizationId).where(contactField, '==', contact).where('status', '==', 'pending')),
    ]);
    if (!org.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Hospital not found', correlationId);
    if (pending.docs.some(d => (d.data().expiresAt as Timestamp).toMillis() > Date.now())) {
      throw new DomainError('APPLICATION_ALREADY_EXISTS', 'This person already has a pending invitation', correlationId);
    }
    tx.set(inviteRef, {
      inviteId: inviteRef.id,
      organizationId,
      organizationName: subjectNameOf(org.data()),
      role,
      inviteePhone: phoneNumber ?? null,
      inviteeEmail: email ?? null,
      status: 'pending',
      invitedBy: uid,
      createdAt: nowTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: inviterRole,
      action: 'ORG_MEMBER_INVITED',
      targetType: 'organizations',
      targetId: organizationId,
      reasonCode: 'TEAM_INVITE',
      correlationId,
      result: 'SUCCESS',
      afterSummary: { inviteId: inviteRef.id, role, channel: phoneNumber ? 'phone' : 'email' },
    });
  });
  return { success: true, inviteId: inviteRef.id };
}, { rateLimit: { limit: 30, windowSeconds: 3600 } });

// ── Invitee side ──────────────────────────────────────────

/** Pending, unexpired invitations addressed to the caller's verified phone or email. */
const invitationsFor = async (request: CallableRequest) => {
  const token: Record<string, unknown> = request.auth?.token ?? {};
  const phone = typeof token.phone_number === 'string' ? token.phone_number : null;
  const email = typeof token.email === 'string' && token.email_verified === true ? token.email.toLowerCase() : null;
  const invites = db().collection('organizationInvitations');
  const queries = [
    phone ? invites.where('inviteePhone', '==', phone).where('status', '==', 'pending').get() : null,
    email ? invites.where('inviteeEmail', '==', email).where('status', '==', 'pending').get() : null,
  ];
  const snaps = await Promise.all(queries.map(q => q ?? Promise.resolve(null)));
  return snaps.flatMap(s => s?.docs ?? []).filter(d => (d.data().expiresAt as Timestamp).toMillis() > Date.now());
};

export const listMyInvitations = domainCall('listMyInvitations', async (request: CallableRequest) => {
  requireAuth(request);
  const docs = await invitationsFor(request);
  return {
    invitations: docs.map(d => ({
      inviteId: d.id,
      organizationId: d.data().organizationId,
      organizationName: d.data().organizationName ?? null,
      role: d.data().role,
      expiresAt: toIso(d.data().expiresAt),
    })),
  };
});

const RespondSchema = z.object({ inviteId: DocIdSchema, accept: z.boolean(), ...CorrelationField }).strict();

export const respondToInvitation = domainCall('respondToInvitation', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { inviteId, accept } = parseOrThrow(RespondSchema, request.data, correlationId, 'Invalid response');
  if (!(await invitationsFor(request)).some(d => d.id === inviteId)) {
    // Same answer for "not yours" and "not found": invitations are not enumerable.
    throw new DomainError('RESOURCE_NOT_FOUND', 'Invitation not found or no longer valid', correlationId);
  }
  const inviteRef = db().collection('organizationInvitations').doc(inviteId);

  return db().runTransaction(async tx => {
    const invite = (await tx.get(inviteRef)).data()!;
    const mRef = memberRef(invite.organizationId, uid);
    const existing = await tx.get(mRef);
    if (invite.status !== 'pending' || (invite.expiresAt as Timestamp).toMillis() <= Date.now()) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Invitation is no longer valid', correlationId);
    }
    if (accept && isActive(existing.data())) {
      throw new DomainError('APPLICATION_ALREADY_EXISTS', 'You are already a member of this hospital', correlationId);
    }
    tx.update(inviteRef, { status: accept ? 'accepted' : 'declined', respondedBy: uid, respondedAt: nowTimestamp() });
    if (accept) {
      tx.set(mRef, {
        userId: uid,
        organizationId: invite.organizationId,
        role: invite.role,
        status: 'active',
        invitedBy: invite.invitedBy,
        inviteId,
        joinedAt: nowTimestamp(),
        removedAt: null,
        removedBy: null,
      }, { merge: true });
      tx.set(db().collection('users').doc(uid), {
        organizationIds: FieldValue.arrayUnion(invite.organizationId),
        updatedAt: nowTimestamp(),
      }, { merge: true });
      enqueueNotification(tx, {
        dedupeKey: `org_joined_${inviteId}`,
        eventType: 'organization.member_joined',
        targetOrganizationId: invite.organizationId,
        title: 'New team member',
        body: `Someone accepted your invitation as ${invite.role}.`,
        payload: { organizationId: invite.organizationId, role: invite.role },
      });
    }
    stageAudit(tx, {
      actorId: uid,
      actorRole: 'invitee',
      action: accept ? 'ORG_INVITATION_ACCEPTED' : 'ORG_INVITATION_DECLINED',
      targetType: 'organizations',
      targetId: invite.organizationId,
      reasonCode: 'TEAM_INVITE_RESPONSE',
      correlationId,
      result: 'SUCCESS',
      afterSummary: { inviteId, role: invite.role },
    });
    return { success: true, organizationId: invite.organizationId, accepted: accept };
  });
});

// ── Team view and changes ─────────────────────────────────

const OrgSchema = z.object({ organizationId: DocIdSchema, ...CorrelationField }).strict();

export const listOrgMembers = domainCall('listOrgMembers', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { organizationId } = parseOrThrow(OrgSchema, request.data, correlationId, 'organizationId is required');
  const myRole = await requireOrgMember(uid, organizationId, correlationId);
  const canManage = myRole === 'owner' || myRole === 'admin';

  const [members, invites] = await Promise.all([
    orgRef(organizationId).collection('members').limit(200).get(),
    canManage ? db().collection('organizationInvitations').where('organizationId', '==', organizationId)
      .where('status', '==', 'pending').limit(100).get() : Promise.resolve(null),
  ]);
  const active = members.docs.filter(d => isActive(d.data()));
  const users = active.length ? await db().getAll(...active.map(d => db().collection('users').doc(d.id))) : [];
  const names = new Map(users.map(u => [u.id, u.data()?.displayName ?? null]));

  return {
    myRole,
    canManage,
    members: active.map(d => ({
      userId: d.id,
      displayName: names.get(d.id) ?? null,
      role: d.data().role ?? 'member',
      joinedAt: toIso(d.data().joinedAt),
      isYou: d.id === uid,
    })),
    invitations: (invites?.docs ?? [])
      .filter(d => (d.data().expiresAt as Timestamp).toMillis() > Date.now())
      .map(d => ({
        inviteId: d.id,
        role: d.data().role,
        contact: d.data().inviteePhone ?? d.data().inviteeEmail,
        expiresAt: toIso(d.data().expiresAt),
      })),
  };
});

const RoleChangeSchema = z.object({
  organizationId: DocIdSchema,
  userId: DocIdSchema,
  role: z.enum(ASSIGNABLE_ROLES),
  ...CorrelationField,
}).strict();

export const updateOrgMemberRole = domainCall('updateOrgMemberRole', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { organizationId, userId, role } = parseOrThrow(RoleChangeSchema, request.data, correlationId, 'Invalid role change');
  if (userId === uid) {
    throw new DomainError('PERMISSION_DENIED', 'You cannot change your own role', correlationId);
  }
  const myRole = await requireOrgPermission(uid, organizationId, 'manageTeam', correlationId);

  await db().runTransaction(async tx => {
    const target = await tx.get(memberRef(organizationId, userId));
    const owners = await otherActiveOwners(tx, organizationId, userId);
    if (!isActive(target.data())) throw new DomainError('RESOURCE_NOT_FOUND', 'Member not found', correlationId);
    const current = target.data()?.role ?? 'member';
    const touchesPrivileged = PRIVILEGED_ROLES.includes(current) || PRIVILEGED_ROLES.includes(role);
    if (touchesPrivileged && myRole !== 'owner') {
      throw new DomainError('PERMISSION_DENIED', 'Only an owner can grant or change owner and admin roles', correlationId);
    }
    if (current === 'owner' && role !== 'owner' && owners === 0) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'A hospital must keep at least one owner', correlationId);
    }
    if (current === role) return;
    tx.update(memberRef(organizationId, userId), { role, roleChangedBy: uid, roleChangedAt: nowTimestamp() });
    stageAudit(tx, {
      actorId: uid,
      actorRole: myRole,
      action: 'ORG_MEMBER_ROLE_CHANGED',
      targetType: 'organizations',
      targetId: organizationId,
      reasonCode: 'TEAM_ROLE_CHANGE',
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { userId, role: current },
      afterSummary: { userId, role },
    });
  });
  return { success: true, userId, role };
});

const RemoveSchema = z.object({
  organizationId: DocIdSchema,
  userId: DocIdSchema,
  reasonCode: ReasonCodeSchema.optional(),
  ...CorrelationField,
}).strict();

/**
 * Offboards a member (or lets a member leave). Duties they created and the
 * audit trail stay; their access ends at every callable and rule immediately.
 */
export const removeOrgMember = domainCall('removeOrgMember', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { organizationId, userId, reasonCode } = parseOrThrow(RemoveSchema, request.data, correlationId, 'Invalid removal');
  const leaving = userId === uid;
  const myRole = leaving
    ? await requireOrgMember(uid, organizationId, correlationId)
    : await requireOrgPermission(uid, organizationId, 'manageTeam', correlationId);

  await db().runTransaction(async tx => {
    const target = await tx.get(memberRef(organizationId, userId));
    const owners = await otherActiveOwners(tx, organizationId, userId);
    if (!isActive(target.data())) throw new DomainError('RESOURCE_NOT_FOUND', 'Member not found', correlationId);
    const current = target.data()?.role ?? 'member';
    if (!leaving && PRIVILEGED_ROLES.includes(current) && myRole !== 'owner') {
      throw new DomainError('PERMISSION_DENIED', 'Only an owner can remove an owner or admin', correlationId);
    }
    if (current === 'owner' && owners === 0) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Make someone else an owner first; a hospital must keep at least one owner', correlationId);
    }
    tx.update(memberRef(organizationId, userId), { status: 'removed', removedAt: nowTimestamp(), removedBy: uid });
    tx.set(db().collection('users').doc(userId), {
      organizationIds: FieldValue.arrayRemove(organizationId),
      updatedAt: nowTimestamp(),
    }, { merge: true });
    stageAudit(tx, {
      actorId: uid,
      actorRole: myRole,
      action: leaving ? 'ORG_MEMBER_LEFT' : 'ORG_MEMBER_REMOVED',
      targetType: 'organizations',
      targetId: organizationId,
      reasonCode: reasonCode ?? (leaving ? 'MEMBER_LEFT' : 'TEAM_OFFBOARDING'),
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { userId, role: current },
    });
  });
  return { success: true, userId };
});

const RevokeSchema = z.object({ inviteId: DocIdSchema, ...CorrelationField }).strict();

export const revokeOrgInvitation = domainCall('revokeOrgInvitation', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { inviteId } = parseOrThrow(RevokeSchema, request.data, correlationId, 'inviteId is required');
  const ref = db().collection('organizationInvitations').doc(inviteId);
  const invite = (await ref.get()).data();
  if (!invite) throw new DomainError('RESOURCE_NOT_FOUND', 'Invitation not found', correlationId);
  const myRole = await requireOrgPermission(uid, invite.organizationId, 'manageTeam', correlationId);

  await db().runTransaction(async tx => {
    const latest = (await tx.get(ref)).data()!;
    if (latest.status !== 'pending') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Only pending invitations can be revoked', correlationId);
    }
    tx.update(ref, { status: 'revoked', revokedBy: uid, revokedAt: nowTimestamp() });
    stageAudit(tx, {
      actorId: uid,
      actorRole: myRole,
      action: 'ORG_INVITATION_REVOKED',
      targetType: 'organizations',
      targetId: invite.organizationId,
      reasonCode: 'TEAM_INVITE_REVOKE',
      correlationId,
      result: 'SUCCESS',
      afterSummary: { inviteId },
    });
  });
  return { success: true, inviteId };
});
