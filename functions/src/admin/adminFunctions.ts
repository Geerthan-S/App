/**
 * Admin Portal, Queues & Moderation Cloud Functions
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import type { DocumentData, Query, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAdmin, requireStaff, requireSuperAdmin, requireStepUpAuth } from '../security/guards';
import { DocIdSchema, ModerationActionSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';
import { REVIEWABLE_CASE_STATUSES } from '../verification/verificationStates';
import {
  FEATURE_FLAG_KEYS, OFFER_EXPIRY_HOURS_RANGE, PLATFORM_DEFAULTS, getOfferExpiryHours,
} from '../shared/platformConfig';

/** Assignment states that still hold a seat on a duty. */
const OPEN_ASSIGNMENT_STATUSES = ['selected', 'confirmed', 'active'];

/** Moderation actions only apply to the kind of target they act on. */
const ACTION_TARGET_TYPES: Record<string, string[]> = {
  hide_duty: ['duty'],
  warn_user: ['user'],
  suspend_user: ['user'],
  dismiss: ['duty', 'user'],
};

/** Each editable configuration document has a fixed key and a validated shape. */
const CONFIG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  offer_policy: z.object({
    offerExpiryHours: z.number().int().min(OFFER_EXPIRY_HOURS_RANGE.min).max(OFFER_EXPIRY_HOURS_RANGE.max),
  }).strict(),
};

const AuditLogQuerySchema = z.object({
  limit: z.number().int().min(1).max(50).default(25),
  action: z.string().regex(/^[A-Z0-9_]{2,64}$/).optional(),
  targetId: DocIdSchema.optional(),
  cursor: DocIdSchema.optional(),
}).refine(q => !(q.action && q.targetId), { message: 'Filter by action or target, not both' });

const FeatureFlagSchema = z.object({
  flagKey: z.enum(FEATURE_FLAG_KEYS),
  enabled: z.boolean(),
});

const toIso = (value: unknown): string | null =>
  value && typeof (value as Timestamp).toDate === 'function' ? (value as Timestamp).toDate().toISOString() : null;

const countOf = async (query: Query): Promise<number> => (await query.count().get()).data().count;

/** Live platform totals for the portal dashboard. Counts only; no personal data. */
export const getAdminDashboard = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireStaff(request, correlationId);

  const cases = db().collection('verificationCases').where('status', 'in', REVIEWABLE_CASE_STATUSES);
  const [
    doctors, verifiedDoctors, organizations, approvedOrganizations,
    publishedDuties, filledDuties, applications, openAssignments,
    doctorCases, organizationCases, openReports,
  ] = await Promise.all([
    countOf(db().collection('doctors')),
    countOf(db().collection('doctors').where('isVerified', '==', true)),
    countOf(db().collection('organizations')),
    countOf(db().collection('organizations').where('verificationState', '==', 'approved')),
    countOf(db().collection('duties').where('status', '==', 'published')),
    countOf(db().collection('duties').where('status', '==', 'filled')),
    countOf(db().collection('applications')),
    countOf(db().collection('assignments').where('status', 'in', OPEN_ASSIGNMENT_STATUSES)),
    countOf(cases.where('subjectType', '==', 'doctor')),
    countOf(cases.where('subjectType', '==', 'organization')),
    countOf(db().collection('moderationReports').where('status', '==', 'open')),
  ]);

  return {
    doctors: { total: doctors, verified: verifiedDoctors },
    organizations: { total: organizations, approved: approvedOrganizations },
    duties: { published: publishedDuties, filled: filledDuties },
    applications: { total: applications },
    assignments: { open: openAssignments },
    pending: { doctorCases, organizationCases, openReports },
    generatedAt: new Date().toISOString(),
  };
});

export const getAdminQueues = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);

  const pendingCasesSnap = await db()
    .collection('verificationCases')
    .where('status', 'in', REVIEWABLE_CASE_STATUSES)
    .limit(20)
    .get();

  const reportsSnap = await db()
    .collection('moderationReports')
    .where('status', '==', 'open')
    .limit(20)
    .get();

  return {
    verificationQueue: pendingCasesSnap.docs.map(d => d.data()),
    moderationQueue: reportsSnap.docs.map(d => ({ ...d.data(), reportId: d.id, createdAt: toIso(d.data().createdAt) })),
  };
});

/**
 * Suspension is enforced at every trusted boundary: the shared callable guard
 * rejects suspended accounts immediately, contested transactions re-check the
 * counterparty, and refresh tokens are revoked so client sessions (and
 * therefore Firestore rule access) end within the ID-token lifetime.
 */
export const submitModerationAction = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const adminUid = requireAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);

  const parsed = ModerationActionSchema.safeParse(request.data);
  if (!parsed.success || !DocIdSchema.safeParse(parsed.data.reportId).success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid moderation payload', correlationId);
  }

  const { reportId, action, reasonCode, notes } = parsed.data;
  const reportRef = db().collection('moderationReports').doc(reportId);

  const report = await db().runTransaction(async tx => {
    const reportDoc = await tx.get(reportRef);
    if (!reportDoc.exists) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Moderation report not found', correlationId);
    }
    const data = reportDoc.data()!;
    if (data.status !== 'open') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Moderation report is already resolved', correlationId);
    }
    if (!DocIdSchema.safeParse(data.targetId).success) {
      throw new DomainError('VALIDATION_FAILED', 'Report target is invalid', correlationId);
    }
    if (!ACTION_TARGET_TYPES[action].includes(data.targetType)) {
      throw new DomainError('VALIDATION_FAILED', `Action ${action} does not apply to a ${data.targetType} report`, correlationId);
    }
    if (action === 'suspend_user' && data.targetId === adminUid) {
      throw new DomainError('PERMISSION_DENIED', 'Administrators cannot suspend themselves', correlationId);
    }

    tx.update(reportRef, {
      status: 'resolved',
      actionTaken: action,
      resolvedBy: adminUid,
      resolvedAt: nowTimestamp(),
    });

    if (action === 'hide_duty' && data.targetType === 'duty') {
      tx.update(db().collection('duties').doc(data.targetId), {
        status: 'paused',
        updatedAt: nowTimestamp(),
      });
    } else if (action === 'suspend_user' && data.targetType === 'user') {
      tx.set(db().collection('users').doc(data.targetId), {
        status: 'suspended',
        suspendedAt: nowTimestamp(),
        suspendedBy: adminUid,
        suspensionReason: reasonCode,
        updatedAt: nowTimestamp(),
      }, { merge: true });
    }

    stageAudit(tx, {
      actorId: adminUid,
      actorRole: 'admin',
      action: `MODERATION_${action.toUpperCase()}`,
      targetType: data.targetType,
      targetId: data.targetId,
      reasonCode,
      correlationId,
      result: 'SUCCESS',
      afterSummary: { action, reportId, notes: notes ?? null },
    });
    return data;
  });

  if (action === 'suspend_user' && report.targetType === 'user') {
    await getAuth().revokeRefreshTokens(report.targetId).catch(error => {
      // The account is already blocked at every callable; record that sessions were not revoked.
      console.error('Refresh token revocation failed after suspension', { targetId: report.targetId, error });
    });
  }

  return { success: true, reportId, action };
});

/** Immutable audit trail, newest first, with a cursor for older pages. */
export const getAuditLogs = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);

  const parsed = AuditLogQuerySchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid audit log query', correlationId);
  }
  const { limit, action, targetId, cursor } = parsed.data;

  let query: Query = db().collection('auditLogs');
  if (action) query = query.where('action', '==', action);
  if (targetId) query = query.where('targetId', '==', targetId);
  query = query.orderBy('createdAt', 'desc');
  if (cursor) {
    const cursorSnap = await db().collection('auditLogs').doc(cursor).get();
    if (!cursorSnap.exists) {
      throw new DomainError('VALIDATION_FAILED', 'Unknown audit log cursor', correlationId);
    }
    query = query.startAfter(cursorSnap);
  }

  const snap = await query.limit(limit + 1).get();
  const page = snap.docs.slice(0, limit);
  return {
    entries: page.map(doc => {
      const data = doc.data();
      return {
        auditId: doc.id,
        actorId: data.actorId,
        actorRole: data.actorRole,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        reasonCode: data.reasonCode,
        correlationId: data.correlationId,
        result: data.result,
        beforeSummary: data.beforeSummary ?? null,
        afterSummary: data.afterSummary ?? null,
        createdAt: toIso(data.createdAt),
      };
    }),
    nextCursor: snap.docs.length > limit ? page[page.length - 1].id : null,
  };
});

/** Current editable settings, feature flags, and the fixed security settings for reference. */
export const getPlatformConfig = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);

  const [offerSnap, flagSnaps, offerExpiryHours] = await Promise.all([
    db().collection('configuration').doc('offer_policy').get(),
    Promise.all(FEATURE_FLAG_KEYS.map(key => db().collection('featureFlags').doc(key).get())),
    getOfferExpiryHours(),
  ]);

  const meta = (data: DocumentData | undefined) => ({
    version: data?.version ?? 0,
    updatedBy: data?.updatedBy ?? null,
    updatedAt: toIso(data?.updatedAt),
  });

  return {
    offerPolicy: { offerExpiryHours, range: OFFER_EXPIRY_HOURS_RANGE, ...meta(offerSnap.data()) },
    featureFlags: flagSnaps.map(snap => ({ key: snap.id, enabled: Boolean(snap.data()?.enabled), ...meta(snap.data()) })),
    fixed: {
      stepUpAuthMaxAgeSeconds: PLATFORM_DEFAULTS.STEP_UP_AUTH_MAX_AGE_SECONDS,
      maxEvidenceFileSizeBytes: PLATFORM_DEFAULTS.MAX_EVIDENCE_FILE_SIZE_BYTES,
      signedUrlExpirySeconds: PLATFORM_DEFAULTS.SIGNED_URL_EXPIRY_SECONDS,
      consentVersion: PLATFORM_DEFAULTS.CURRENT_CONSENT_VERSION,
    },
    canEdit: Boolean(request.auth?.token?.isSuperAdmin),
  };
});

/**
 * Only allow-listed configuration documents can be written, each validated
 * against its schema and stored in the shape the platform reads back.
 */
export const updatePlatformConfig = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const superAdminUid = requireSuperAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);

  const { configKey, configValue } = request.data || {};
  const schema = typeof configKey === 'string' && Object.prototype.hasOwnProperty.call(CONFIG_SCHEMAS, configKey) ?
    CONFIG_SCHEMAS[configKey] : undefined;
  const parsed = schema?.safeParse(configValue);
  if (!schema || !parsed?.success) {
    throw new DomainError('VALIDATION_FAILED', 'Unknown configuration key or invalid value', correlationId);
  }

  const configRef = db().collection('configuration').doc(configKey);
  await db().runTransaction(async tx => {
    const existing = (await tx.get(configRef)).data();
    const before = existing ? Object.fromEntries(
      Object.entries(existing).filter(([field]) => !['key', 'version', 'updatedBy', 'updatedAt'].includes(field))
    ) : null;
    tx.set(configRef, {
      ...parsed.data,
      key: configKey,
      version: (existing?.version || 0) + 1,
      updatedBy: superAdminUid,
      updatedAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: superAdminUid,
      actorRole: 'super_admin',
      action: 'PLATFORM_CONFIG_UPDATED',
      targetType: 'configuration',
      targetId: configKey,
      reasonCode: 'MASTER_CONFIG_EDIT',
      correlationId,
      result: 'SUCCESS',
      beforeSummary: before,
      afterSummary: { configKey, ...parsed.data },
    });
  });

  return { success: true, configKey };
});

export const setFeatureFlag = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const superAdminUid = requireSuperAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);

  const parsed = FeatureFlagSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Unknown feature flag or invalid value', correlationId);
  }
  const { flagKey, enabled } = parsed.data;
  const flagRef = db().collection('featureFlags').doc(flagKey);

  await db().runTransaction(async tx => {
    const existing = (await tx.get(flagRef)).data();
    tx.set(flagRef, {
      enabled,
      version: (existing?.version || 0) + 1,
      updatedBy: superAdminUid,
      updatedAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: superAdminUid,
      actorRole: 'super_admin',
      action: 'FEATURE_FLAG_UPDATED',
      targetType: 'featureFlags',
      targetId: flagKey,
      reasonCode: 'MASTER_CONFIG_EDIT',
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { enabled: Boolean(existing?.enabled) },
      afterSummary: { enabled },
    });
  });

  return { success: true, flagKey, enabled };
});
