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
import { registryDomainsOf } from '../verification/registryDefaults';
import {
  FEATURE_FLAG_KEYS, OFFER_EXPIRY_HOURS_RANGE, PLATFORM_DEFAULTS, REVERIFY_MONTHS_RANGE, VERIFICATION_SLA_HOURS_RANGE,
  getOfferExpiryHours, getVerificationPolicy,
} from '../shared/platformConfig';
import { dashboardInsights } from './dashboardInsights';

/** Assignment states that still hold a seat on a duty. */
const OPEN_ASSIGNMENT_STATUSES = ['selected', 'confirmed', 'active'];

/** Moderation actions only apply to the kind of target they act on. */
const ACTION_TARGET_TYPES: Record<string, string[]> = {
  hide_duty: ['duty'],
  warn_user: ['user'],
  suspend_user: ['user'],
  dismiss: ['duty', 'user'],
};

/** A bare lowercase hostname such as `registry.nmc.org.in`: no scheme, path, port or wildcard. */
const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Each editable configuration document has a fixed key and a validated shape. */
const CONFIG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  offer_policy: z.object({
    offerExpiryHours: z.number().int().min(OFFER_EXPIRY_HOURS_RANGE.min).max(OFFER_EXPIRY_HOURS_RANGE.max),
  }).strict(),
  // Official registries a verifier may cite when approving a case (read by recordVerificationDecision).
  // At least one is required: an empty list would block every approval.
  approved_registry_domains: z.object({
    value: z.array(z.string().regex(HOSTNAME_PATTERN)).min(1).max(50)
      .refine(domains => new Set(domains).size === domains.length, 'Duplicate domain'),
  }).strict(),
  // Review turnaround target and re-verification interval (read by getVerificationPolicy).
  verification_policy: z.object({
    slaHours: z.number().int().min(VERIFICATION_SLA_HOURS_RANGE.min).max(VERIFICATION_SLA_HOURS_RANGE.max),
    reverifyAfterMonths: z.number().int().min(REVERIFY_MONTHS_RANGE.min).max(REVERIFY_MONTHS_RANGE.max),
  }).strict(),
};

/** Semantic version as shipped in pubspec.yaml (e.g. 1.4.2). */
const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
CONFIG_SCHEMAS.app_release = z.object({
  minimumVersion: z.object({ android: z.string().regex(SEMVER), ios: z.string().regex(SEMVER) }).strict(),
  latestVersion: z.string().regex(SEMVER),
  updateUrl: z.string().url().max(500).refine(u => u.startsWith('https://'), 'Must be an https link').nullable(),
  maintenance: z.object({ enabled: z.boolean(), message: z.string().trim().max(300) }).strict(),
}).strict();

/**
 * Where each config key is stored. App release settings live in the public
 * appVersions/current document because the app reads them before sign-in.
 */
const configDoc = (configKey: string) => (configKey === 'app_release'
  ? db().collection('appVersions').doc('current')
  : db().collection('configuration').doc(configKey));

/** Audit actor roles that belong to portal staff (the Admin Activity view). */
const STAFF_ACTOR_ROLES = ['verifier', 'support_admin', 'super_admin', 'admin'];

const AuditLogQuerySchema = z.object({
  limit: z.number().int().min(1).max(50).default(25),
  action: z.string().regex(/^[A-Z0-9_]{2,64}$/).optional(),
  targetId: DocIdSchema.optional(),
  actorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  result: z.enum(['SUCCESS', 'FAILED', 'DENIED']).optional(),
  /** `staff`: only actions taken by portal staff. */
  scope: z.enum(['all', 'staff']).default('all'),
  cursor: DocIdSchema.optional(),
  correlationId: z.string().optional(),
}).refine(q => [q.action, q.targetId, q.actorId, q.result, q.scope === 'staff' ? 'staff' : undefined]
  .filter(Boolean).length <= 1, { message: 'Use one filter at a time' });

const FeatureFlagSchema = z.object({
  flagKey: z.enum(FEATURE_FLAG_KEYS),
  enabled: z.boolean(),
});

const toIso = (value: unknown): string | null =>
  value && typeof (value as Timestamp).toDate === 'function' ? (value as Timestamp).toDate().toISOString() : null;

const countOf = async (query: Query): Promise<number> => (await query.count().get()).data().count;

/** Live platform totals for the portal dashboard. Counts only; no personal data. */
export const getAdminDashboard = domainCall('getAdminDashboard', async (request: CallableRequest) => {
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
    // Applications live under each duty (duties/{dutyId}/applications).
    countOf(db().collectionGroup('applications')),
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
    insights: await dashboardInsights(),
    generatedAt: new Date().toISOString(),
  };
}, { audience: 'staff' });

export const getAdminQueues = domainCall('getAdminQueues', async (request: CallableRequest) => {
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
}, { audience: 'staff' });

/**
 * Suspension is enforced at every trusted boundary: the shared callable guard
 * rejects suspended accounts immediately, contested transactions re-check the
 * counterparty, and refresh tokens are revoked so client sessions (and
 * therefore Firestore rule access) end within the ID-token lifetime.
 */
export const submitModerationAction = domainCall('submitModerationAction', async (request: CallableRequest) => {
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
    // Read before any write: Duty Moderation needs the pre-hide status to restore the duty.
    const dutySnap = action === 'hide_duty' ? await tx.get(db().collection('duties').doc(data.targetId)) : null;

    tx.update(reportRef, {
      status: 'resolved',
      actionTaken: action,
      resolvedBy: adminUid,
      resolvedAt: nowTimestamp(),
    });

    if (action === 'hide_duty' && data.targetType === 'duty') {
      tx.update(db().collection('duties').doc(data.targetId), {
        status: 'paused',
        moderationHidden: true,
        statusBeforeHide: dutySnap?.data()?.status ?? null,
        hiddenBy: adminUid,
        hiddenAt: nowTimestamp(),
        hiddenReason: reasonCode,
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
}, { audience: 'staff' });

/** Immutable audit trail, newest first, with a cursor for older pages. */
export const getAuditLogs = domainCall('getAuditLogs', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);

  const parsed = AuditLogQuerySchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid audit log query', correlationId);
  }
  const { limit, action, targetId, actorId, result, scope, cursor } = parsed.data;

  let query: Query = db().collection('auditLogs');
  if (action) query = query.where('action', '==', action);
  if (targetId) query = query.where('targetId', '==', targetId);
  if (actorId) query = query.where('actorId', '==', actorId);
  if (result) query = query.where('result', '==', result);
  if (scope === 'staff') query = query.where('actorRole', 'in', STAFF_ACTOR_ROLES);
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
        securityMetadata: data.securityMetadata ?? null,
        createdAt: toIso(data.createdAt),
      };
    }),
    nextCursor: snap.docs.length > limit ? page[page.length - 1].id : null,
  };
}, { audience: 'staff' });

/** Current editable settings, feature flags, and the fixed security settings for reference. */
export const getPlatformConfig = domainCall('getPlatformConfig', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);

  const [offerSnap, registrySnap, policySnap, releaseSnap, flagSnaps, offerExpiryHours, verificationPolicy] = await Promise.all([
    db().collection('configuration').doc('offer_policy').get(),
    db().collection('configuration').doc('approved_registry_domains').get(),
    db().collection('configuration').doc('verification_policy').get(),
    configDoc('app_release').get(),
    Promise.all(FEATURE_FLAG_KEYS.map(key => db().collection('featureFlags').doc(key).get())),
    getOfferExpiryHours(),
    getVerificationPolicy(),
  ]);

  const meta = (data: DocumentData | undefined) => ({
    version: data?.version ?? 0,
    updatedBy: data?.updatedBy ?? null,
    updatedAt: toIso(data?.updatedAt),
  });

  return {
    offerPolicy: { offerExpiryHours, range: OFFER_EXPIRY_HOURS_RANGE, ...meta(offerSnap.data()) },
    registryDomains: {
      value: registryDomainsOf(registrySnap.data()),
      isDefault: !(Array.isArray(registrySnap.data()?.value) && registrySnap.data()!.value.length),
      ...meta(registrySnap.data()),
    },
    verificationPolicy: {
      ...verificationPolicy,
      ranges: { slaHours: VERIFICATION_SLA_HOURS_RANGE, reverifyAfterMonths: REVERIFY_MONTHS_RANGE },
      ...meta(policySnap.data()),
    },
    appRelease: {
      minimumVersion: releaseSnap.data()?.minimumVersion ?? { android: '1.0.0', ios: '1.0.0' },
      latestVersion: releaseSnap.data()?.latestVersion ?? '1.0.0',
      updateUrl: releaseSnap.data()?.updateUrl ?? null,
      maintenance: releaseSnap.data()?.maintenance ?? { enabled: false, message: '' },
      ...meta(releaseSnap.data()),
    },
    featureFlags: flagSnaps.map(snap => ({ key: snap.id, enabled: Boolean(snap.data()?.enabled), ...meta(snap.data()) })),
    fixed: {
      stepUpAuthMaxAgeSeconds: PLATFORM_DEFAULTS.STEP_UP_AUTH_MAX_AGE_SECONDS,
      maxEvidenceFileSizeBytes: PLATFORM_DEFAULTS.MAX_EVIDENCE_FILE_SIZE_BYTES,
      signedUrlExpirySeconds: PLATFORM_DEFAULTS.SIGNED_URL_EXPIRY_SECONDS,
      consentVersion: PLATFORM_DEFAULTS.CURRENT_CONSENT_VERSION,
    },
    canEdit: Boolean(request.auth?.token?.isSuperAdmin),
  };
}, { audience: 'staff' });

/**
 * Only allow-listed configuration documents can be written, each validated
 * against its schema and stored in the shape the platform reads back.
 */
export const updatePlatformConfig = domainCall('updatePlatformConfig', async (request: CallableRequest) => {
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

  const configRef = configDoc(configKey);
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
}, { audience: 'staff' });

export const setFeatureFlag = domainCall('setFeatureFlag', async (request: CallableRequest) => {
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
}, { audience: 'staff' });
