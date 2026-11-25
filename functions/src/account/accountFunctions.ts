/**
 * The signed-in person's control over their own account (blueprint §3.10,
 * App Store guideline 5.1.1(v)): export, privacy requests, deletion, devices,
 * sign-out everywhere and notification preferences.
 *
 * Deletion keeps what the platform must retain for legal and fraud purposes
 * (verification cases and evidence, audit logs, assignment history, and the
 * registration-number reservation) and removes or anonymises the rest. The
 * retained records are purged by the retention job described in
 * docs/runbooks/launch-readiness.md.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, type DocumentSnapshot, type WriteBatch } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, requireStepUpAuth } from '../security/guards';
import { DomainError } from '../shared/errors';
import { logAudit, stageAudit } from '../audit/auditLogger';
import { CorrelationField, parseOrThrow, toIso } from '../admin/adminShared';
import { deviceTokenId } from '../notifications/deviceTokenFunctions';
import { NOTIFICATION_CATEGORIES } from '../notifications/preferences';

/** Assignment states that still commit the doctor or the hospital to a shift. */
const ACTIVE_ASSIGNMENT_STATUSES = ['selected', 'confirmed', 'in_progress', 'active'];
const OPEN_APPLICATION_STATUSES = ['submitted', 'shortlisted'];

/** Firestore Timestamps and nested values to plain JSON for the export file. */
const plain = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') return toIso(value);
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plain(v)]));
  }
  return value;
};
const docs = (snaps: DocumentSnapshot[]) => snaps.map(s => ({ id: s.id, ...(plain(s.data()) as object) }));

// ── Export ────────────────────────────────────────────────

/** Everything the platform holds about the caller that is theirs to see. */
export const exportMyData = domainCall('exportMyData', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const [user, doctor, applications, assignments, feedback, inbox, savedSearches, consent] = await Promise.all([
    db().collection('users').doc(uid).get(),
    db().collection('doctors').doc(uid).get(),
    db().collectionGroup('applications').where('doctorId', '==', uid).limit(500).get(),
    db().collection('assignments').where('doctorId', '==', uid).limit(500).get(),
    db().collection('feedback').where('authorId', '==', uid).limit(500).get(),
    db().collection('inboxNotifications').where('userId', '==', uid).limit(500).get(),
    db().collection('savedSearches').where('uid', '==', uid).limit(50).get(),
    db().collection('auditLogs').where('actorId', '==', uid).where('action', '==', 'CONSENT_ACCEPTED').limit(20).get(),
  ]);
  const auth = await getAuth().getUser(uid).catch(() => null);

  await logAudit({
    actorId: uid, actorRole: 'user', action: 'DATA_EXPORTED', targetType: 'users', targetId: uid,
    reasonCode: 'DATA_PRINCIPAL_REQUEST', correlationId, result: 'SUCCESS',
  });

  return {
    exportedAt: new Date().toISOString(),
    notice: 'Verification evidence files are not included; ask support for a copy of a specific document.',
    account: {
      uid,
      phoneNumber: auth?.phoneNumber ?? null,
      email: auth?.email ?? null,
      createdAt: auth?.metadata.creationTime ? new Date(auth.metadata.creationTime).toISOString() : null,
      ...(plain(user.data() ?? {}) as object),
    },
    doctorProfile: doctor.exists ? plain(doctor.data()) : null,
    applications: docs(applications.docs),
    assignments: docs(assignments.docs),
    feedbackWritten: docs(feedback.docs),
    notifications: docs(inbox.docs),
    savedSearches: docs(savedSearches.docs),
    consentRecords: consent.docs.map(d => ({ consentVersion: d.data().afterSummary?.consentVersion, at: toIso(d.data().createdAt) })),
  };
}, { rateLimit: { limit: 3, windowSeconds: 86400 } });

// ── Privacy requests ──────────────────────────────────────

const PrivacyRequestSchema = z.object({
  type: z.enum(['correction', 'restriction', 'other']),
  details: z.string().trim().min(10).max(2000),
  ...CorrelationField,
}).strict();

/** Opens a support case (category `privacy`) that staff work from the portal. */
export const submitPrivacyRequest = domainCall('submitPrivacyRequest', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { type, details } = parseOrThrow(PrivacyRequestSchema, request.data, correlationId, 'Describe what you need (at least 10 characters)');
  const ref = db().collection('supportCases').doc();
  const batch = db().batch();
  batch.set(ref, {
    caseId: ref.id,
    subject: `Privacy request: ${type}`,
    description: details,
    category: 'privacy',
    priority: 'high',
    status: 'open',
    requesterUid: uid,
    requesterContact: 'In-app privacy request',
    relatedType: null,
    relatedId: null,
    assigneeId: null,
    assigneeName: null,
    notes: [],
    createdBy: uid,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
    resolvedAt: null,
  });
  stageAudit(batch, {
    actorId: uid, actorRole: 'user', action: 'PRIVACY_REQUEST_SUBMITTED', targetType: 'supportCases', targetId: ref.id,
    reasonCode: `PRIVACY_${type.toUpperCase()}`, correlationId, result: 'SUCCESS',
  });
  await batch.commit();
  return { success: true, requestId: ref.id };
}, { rateLimit: { limit: 5, windowSeconds: 86400 } });

// ── Account deletion ──────────────────────────────────────

const DeleteSchema = z.object({ confirm: z.literal('DELETE'), ...CorrelationField }).strict();

export const deleteMyAccount = domainCall('deleteMyAccount', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  parseOrThrow(DeleteSchema, request.data, correlationId, 'Type DELETE to confirm');
  requireStepUpAuth(request, correlationId, 600);

  const [activeAssignments, user, applications, devices, searches] = await Promise.all([
    db().collection('assignments').where('doctorId', '==', uid).where('status', 'in', ACTIVE_ASSIGNMENT_STATUSES).limit(1).get(),
    db().collection('users').doc(uid).get(),
    db().collectionGroup('applications').where('doctorId', '==', uid).where('status', 'in', OPEN_APPLICATION_STATUSES).limit(200).get(),
    db().collection('deviceTokens').where('uid', '==', uid).limit(50).get(),
    db().collection('savedSearches').where('uid', '==', uid).limit(50).get(),
  ]);
  if (!activeAssignments.empty) {
    throw new DomainError('INVALID_STATE_TRANSITION',
      'You have an upcoming or active duty. Complete or cancel it before deleting your account.', correlationId);
  }
  const orgIds: string[] = Array.isArray(user.data()?.organizationIds) ? user.data()!.organizationIds : [];
  const memberships = orgIds.length
    ? await db().getAll(...orgIds.map(id => db().collection('organizations').doc(id).collection('members').doc(uid)))
    : [];
  const ownsActive = memberships.some(m => m.exists && m.data()?.role === 'owner' &&
    (m.data()?.status === undefined || m.data()?.status === 'active'));
  if (ownsActive) {
    throw new DomainError('INVALID_STATE_TRANSITION',
      'You own a hospital on HealthForce. Transfer ownership or contact support before deleting your account.', correlationId);
  }

  // Writes are chunked: a batch holds at most 500 operations.
  const ops: ((b: WriteBatch) => void)[] = [];
  applications.docs.forEach(a => ops.push(b => b.update(a.ref, {
    status: 'withdrawn', withdrawnReason: 'ACCOUNT_DELETED', version: FieldValue.increment(1), updatedAt: nowTimestamp(),
  })));
  memberships.filter(m => m.exists).forEach(m => ops.push(b => b.update(m.ref, {
    status: 'removed', removedAt: nowTimestamp(), removedBy: uid,
  })));
  devices.docs.forEach(d => ops.push(b => b.update(d.ref, { enabled: false, disabledReason: 'ACCOUNT_DELETED', updatedAt: nowTimestamp() })));
  searches.docs.forEach(s => ops.push(b => b.delete(s.ref)));
  const doctorRef = db().collection('doctors').doc(uid);
  if ((await doctorRef.get()).exists) {
    ops.push(b => b.update(doctorRef, {
      fullName: 'Deleted user', bio: '', preferredCities: [], isVerified: false,
      verificationStatus: 'deleted', deleted: true, deletedAt: nowTimestamp(), updatedAt: nowTimestamp(),
    }));
  }
  ops.push(b => b.set(db().collection('users').doc(uid), {
    status: 'deleted', deletedAt: nowTimestamp(), displayName: null, organizationIds: [],
    notificationPreferences: FieldValue.delete(), updatedAt: nowTimestamp(),
  }, { merge: true }));
  ops.push(b => stageAudit(b, {
    actorId: uid, actorRole: 'user', action: 'ACCOUNT_DELETED', targetType: 'users', targetId: uid,
    reasonCode: 'DATA_PRINCIPAL_REQUEST', correlationId, result: 'SUCCESS',
    afterSummary: { applicationsWithdrawn: applications.size, membershipsRemoved: memberships.filter(m => m.exists).length },
  }));
  for (let i = 0; i < ops.length; i += 450) {
    const batch = db().batch();
    ops.slice(i, i + 450).forEach(op => op(batch));
    await batch.commit();
  }

  // Last: the Firestore side is already blocked (status: deleted) if this fails.
  await getAuth().revokeRefreshTokens(uid).catch(() => undefined);
  await getAuth().deleteUser(uid).catch(async error => {
    await logAudit({
      actorId: uid, actorRole: 'user', action: 'ACCOUNT_AUTH_DELETE_FAILED', targetType: 'users', targetId: uid,
      reasonCode: 'DATA_PRINCIPAL_REQUEST', correlationId, result: 'FAILED',
    });
    throw error;
  });
  return { success: true };
}, { rateLimit: { limit: 5, windowSeconds: 3600 } });

// ── Devices and sessions ──────────────────────────────────

const DevicesSchema = z.object({ currentToken: z.string().min(20).max(4096).optional(), ...CorrelationField }).strict();

/**
 * Devices registered for push. Firebase cannot list or end one session, so
 * this is the device view the blueprint asks for, with "sign out everywhere".
 */
export const listMyDevices = domainCall('listMyDevices', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { currentToken } = parseOrThrow(DevicesSchema, request.data, correlationId, 'Invalid request');
  const currentId = currentToken ? deviceTokenId(currentToken) : null;
  const snap = await db().collection('deviceTokens').where('uid', '==', uid).where('enabled', '==', true).limit(20).get();
  return {
    devices: snap.docs.map(d => ({
      deviceId: d.id.slice(0, 12),
      platform: d.data().platform ?? 'android',
      registeredAt: toIso(d.data().createdAt),
      lastSeenAt: toIso(d.data().updatedAt),
      thisDevice: d.id === currentId,
    })),
  };
});

export const signOutEverywhere = domainCall('signOutEverywhere', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const devices = await db().collection('deviceTokens').where('uid', '==', uid).where('enabled', '==', true).limit(50).get();
  const batch = db().batch();
  devices.docs.forEach(d => batch.update(d.ref, { enabled: false, disabledReason: 'SIGNED_OUT_EVERYWHERE', updatedAt: nowTimestamp() }));
  stageAudit(batch, {
    actorId: uid, actorRole: 'user', action: 'SIGNED_OUT_EVERYWHERE', targetType: 'users', targetId: uid,
    reasonCode: 'USER_SESSION_REVOKE', correlationId, result: 'SUCCESS', afterSummary: { devices: devices.size },
  });
  await batch.commit();
  await getAuth().revokeRefreshTokens(uid);
  return { success: true, devicesSignedOut: devices.size };
}, { rateLimit: { limit: 5, windowSeconds: 3600 } });

// ── Notification preferences ──────────────────────────────

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PreferencesSchema = z.object({
  mutedCategories: z.array(z.enum(NOTIFICATION_CATEGORIES)).max(NOTIFICATION_CATEGORIES.length)
    .refine(list => new Set(list).size === list.length, 'Duplicate category'),
  quietHours: z.object({ enabled: z.boolean(), start: z.string().regex(HHMM), end: z.string().regex(HHMM) }).strict(),
  ...CorrelationField,
}).strict();

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  mutedCategories: [] as string[],
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
};

export const getNotificationPreferences = domainCall('getNotificationPreferences', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const prefs = (await db().collection('users').doc(uid).get()).data()?.notificationPreferences;
  return {
    preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(prefs ?? {}) },
    categories: NOTIFICATION_CATEGORIES,
    timezone: 'Asia/Kolkata',
  };
});

export const updateNotificationPreferences = domainCall('updateNotificationPreferences', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { mutedCategories, quietHours } = parseOrThrow(PreferencesSchema, request.data, correlationId, 'Invalid notification preferences');
  await db().collection('users').doc(uid).set({
    notificationPreferences: { mutedCategories, quietHours, updatedAt: nowTimestamp() },
    updatedAt: nowTimestamp(),
  }, { merge: true });
  return { success: true };
}, { rateLimit: { limit: 30, windowSeconds: 3600 } });
