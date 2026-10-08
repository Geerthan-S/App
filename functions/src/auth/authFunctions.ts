/**
 * Auth & Identity Cloud Functions
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, requireSuperAdmin } from '../security/guards';
import { DomainError } from '../shared/errors';
import { logAudit, stageAudit } from '../audit/auditLogger';
import { RecordConsentSchema, DocIdSchema } from '../shared/schemas';
import { PLATFORM_DEFAULTS } from '../shared/platformConfig';

/** Persists acceptance of the current consent version. Onboarding cannot advance without it. */
export const recordConsent = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = RecordConsentSchema.safeParse(request.data);
  if (!parsed.success || parsed.data.consentVersion !== PLATFORM_DEFAULTS.CURRENT_CONSENT_VERSION) {
    throw new DomainError('VALIDATION_FAILED',
      `Consent must be given for the current version (${PLATFORM_DEFAULTS.CURRENT_CONSENT_VERSION})`, correlationId);
  }
  const { consentVersion } = parsed.data;

  const batch = db().batch();
  batch.set(db().collection('users').doc(uid), {
    consentVersion,
    consentAcceptedAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  }, { merge: true });
  stageAudit(batch, {
    actorId: uid,
    actorRole: 'user',
    action: 'CONSENT_ACCEPTED',
    targetType: 'users',
    targetId: uid,
    reasonCode: 'USER_CONSENT_ACK',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { consentVersion },
  });
  await batch.commit();

  return { success: true, consentVersion };
});

export const setCustomClaims = domainCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const adminUid = requireSuperAdmin(request, correlationId);

  const targetUid = DocIdSchema.safeParse(request.data?.targetUid);
  const claims = request.data?.claims;

  if (!targetUid.success || typeof claims !== 'object' || claims === null) {
    throw new DomainError('VALIDATION_FAILED', 'targetUid and claims object are required', correlationId);
  }

  // Allowed coarse-grained claims only
  const sanitizedClaims = {
    isVerifier: Boolean(claims.isVerifier),
    isSupportAdmin: Boolean(claims.isSupportAdmin),
    isSuperAdmin: Boolean(claims.isSuperAdmin),
  };

  const previous = (await getAuth().getUser(targetUid.data)).customClaims ?? {};
  const privilegeRemoved = (['isVerifier', 'isSupportAdmin', 'isSuperAdmin'] as const)
    .some(claim => previous[claim] === true && !sanitizedClaims[claim]);

  await getAuth().setCustomUserClaims(targetUid.data, sanitizedClaims);
  if (privilegeRemoved) {
    // Existing sessions would otherwise keep the removed privilege until token refresh.
    await getAuth().revokeRefreshTokens(targetUid.data);
  }

  await logAudit({
    actorId: adminUid,
    actorRole: 'super_admin',
    action: 'CUSTOM_CLAIMS_SET',
    targetType: 'users',
    targetId: targetUid.data,
    reasonCode: request.data?.reasonCode || 'ADMIN_PRIVILEGE_GRANT',
    correlationId,
    result: 'SUCCESS',
    beforeSummary: previous,
    afterSummary: { ...sanitizedClaims, sessionsRevoked: privilegeRemoved },
  });

  return { success: true, targetUid: targetUid.data, claims: sanitizedClaims };
});
