/**
 * Shared callable boundary.
 * Every client-facing callable is registered through `domainCall` so that:
 *  - app callables require a valid App Check token (production only),
 *  - staff callables only accept the admin portal's origins,
 *  - every authenticated caller is rate limited per function,
 *  - suspended/deleted accounts are rejected before any handler logic runs,
 *  - operations that need consent require the current consent version,
 *  - denied staff attempts are written to the audit trail, and
 *  - domain errors reach the client with their code instead of a bare INTERNAL.
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { requireEligibleAccount } from '../security/guards';
import { DEFAULT_APP_RATE_LIMIT, DEFAULT_STAFF_RATE_LIMIT, RateLimit, enforceRateLimit } from '../security/rateLimit';
import { logAudit } from '../audit/auditLogger';
import { DomainError, toCallableError } from './errors';
import { sanitizeCorrelationId } from './firestoreHelpers';
import { contextFromRawRequest, runWithRequestContext } from './requestContext';
import { isEmulator } from './runtime';

/** `app`: the Android client. `staff`: the admin portal. */
export type CallableAudience = 'app' | 'staff';

export interface DomainCallOptions {
  /** Business operations that need the caller to have accepted the current consent version. */
  requireConsent?: boolean;
  /** Defaults to `app`. */
  audience?: CallableAudience;
  /** Overrides the audience's default per-user limit. */
  rateLimit?: RateLimit;
}

/**
 * Origins allowed to call staff callables: the hosted portal, and the local
 * portal server (serve_admin.js) that staff use against the live project.
 */
export const STAFF_ORIGINS: (string | RegExp)[] = [
  'https://doctor-c7c29.web.app',
  'https://doctor-c7c29.firebaseapp.com',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
];

const DENIAL_CODES = new Set(['PERMISSION_DENIED', 'MFA_REQUIRED']);

/** Records a refused staff call. Never throws: the caller still gets the original error. */
const recordDenial = async (name: string, request: CallableRequest, error: DomainError, correlationId: string) => {
  try {
    await logAudit({
      actorId: request.auth?.uid ?? 'anonymous',
      actorRole: 'unknown',
      action: 'ACCESS_DENIED',
      targetType: 'callable',
      targetId: name,
      reasonCode: error.code,
      correlationId,
      result: 'DENIED',
    });
  } catch (auditError) {
    console.error('Could not record denied staff call', { name, correlationId, auditError });
  }
};

export const domainCall = <T>(
  name: string,
  handler: (request: CallableRequest) => Promise<T>,
  options: DomainCallOptions = {}
) => {
  const audience = options.audience ?? 'app';
  const rateLimit = options.rateLimit ?? (audience === 'staff' ? DEFAULT_STAFF_RATE_LIMIT : DEFAULT_APP_RATE_LIMIT);

  return onCall({
    enforceAppCheck: audience === 'app' && !isEmulator(),
    cors: audience === 'staff' ? STAFF_ORIGINS : true,
  }, async (request: CallableRequest) => {
    const correlationId = sanitizeCorrelationId(request.data?.correlationId);
    const context = contextFromRawRequest(name, request.rawRequest as never);
    return runWithRequestContext(context, async () => {
      try {
        if (request.auth?.uid) {
          await enforceRateLimit(request.auth.uid, rateLimit.bucket ?? name, rateLimit, correlationId);
          await requireEligibleAccount(request.auth.uid, correlationId, options);
        }
        return await handler(request);
      } catch (error) {
        if (audience === 'staff' && error instanceof DomainError && DENIAL_CODES.has(error.code)) {
          await recordDenial(name, request, error, correlationId);
        }
        throw toCallableError(error, correlationId);
      }
    });
  });
};
