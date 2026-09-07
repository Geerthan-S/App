/**
 * Auth & Identity Cloud Functions
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAuth, requireSuperAdmin } from '../security/guards';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';

export const recordConsent = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const consentVersion = request.data?.consentVersion || 'v1.0';

  const userRef = db().collection('users').doc(uid);
  await userRef.set({
    consentVersion,
    updatedAt: nowTimestamp(),
  }, { merge: true });

  await logAudit({
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

  return { success: true, consentVersion };
});

export const setCustomClaims = onCall(async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const adminUid = requireSuperAdmin(request, correlationId);

  const targetUid = request.data?.targetUid;
  const claims = request.data?.claims;

  if (!targetUid || typeof claims !== 'object') {
    throw new DomainError('VALIDATION_FAILED', 'targetUid and claims object are required', correlationId);
  }

  // Allowed coarse-grained claims only
  const sanitizedClaims = {
    isVerifier: Boolean(claims.isVerifier),
    isSupportAdmin: Boolean(claims.isSupportAdmin),
    isSuperAdmin: Boolean(claims.isSuperAdmin),
  };

  await getAuth().setCustomUserClaims(targetUid, sanitizedClaims);

  await logAudit({
    actorId: adminUid,
    actorRole: 'super_admin',
    action: 'CUSTOM_CLAIMS_SET',
    targetType: 'users',
    targetId: targetUid,
    reasonCode: request.data?.reasonCode || 'ADMIN_PRIVILEGE_GRANT',
    correlationId,
    result: 'SUCCESS',
    afterSummary: sanitizedClaims,
  });

  return { success: true, targetUid, claims: sanitizedClaims };
});
