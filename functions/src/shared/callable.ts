/**
 * Shared callable boundary.
 * Every client-facing callable is registered through `domainCall` so that:
 *  - suspended/deleted accounts are rejected before any handler logic runs,
 *  - operations that need consent require the current consent version, and
 *  - domain errors reach the client with their code instead of a bare INTERNAL.
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { requireEligibleAccount } from '../security/guards';
import { toCallableError } from './errors';
import { sanitizeCorrelationId } from './firestoreHelpers';

export interface DomainCallOptions {
  /** Business operations that need the caller to have accepted the current consent version. */
  requireConsent?: boolean;
}

export const domainCall = <T>(
  handler: (request: CallableRequest) => Promise<T>,
  options: DomainCallOptions = {}
) =>
  onCall(async (request: CallableRequest) => {
    const correlationId = sanitizeCorrelationId(request.data?.correlationId);
    try {
      if (request.auth?.uid) {
        await requireEligibleAccount(request.auth.uid, correlationId, options);
      }
      return await handler(request);
    } catch (error) {
      throw toCallableError(error, correlationId);
    }
  });
