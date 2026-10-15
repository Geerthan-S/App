/**
 * Auth & Identity Cloud Functions
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth } from '../security/guards';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';
import { RecordConsentSchema } from '../shared/schemas';
import { PLATFORM_DEFAULTS } from '../shared/platformConfig';

/** Persists acceptance of the current consent version. Onboarding cannot advance without it. */
export const recordConsent = domainCall('recordConsent', async (request: CallableRequest) => {
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
