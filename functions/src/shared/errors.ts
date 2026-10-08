/**
 * Typed Domain Error Envelope & Error Classes
 */

import { HttpsError, FunctionsErrorCode } from 'firebase-functions/v2/https';

export type DomainErrorCode =
  | 'AUTH_REQUIRED'
  | 'ACCOUNT_SUSPENDED'
  | 'CONSENT_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'STEP_UP_REQUIRED'
  | 'HOSPITAL_NOT_VERIFIED'
  | 'DOCTOR_NOT_VERIFIED'
  | 'APPLICATION_ALREADY_EXISTS'
  | 'INVALID_STATE_TRANSITION'
  | 'ASSIGNMENT_CONFLICT'
  | 'DUTY_CAPACITY_FILLED'
  | 'OFFER_EXPIRED'
  | 'PROFILE_CHANGED'
  | 'FILE_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'RESOURCE_NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly correlationId: string;
  public readonly fieldErrors?: Record<string, string[]>;
  public readonly retryAfter?: number;

  constructor(
    code: DomainErrorCode,
    message: string,
    correlationId: string,
    fieldErrors?: Record<string, string[]>,
    retryAfter?: number
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.correlationId = correlationId;
    this.fieldErrors = fieldErrors;
    this.retryAfter = retryAfter;
  }

  toHttpsError(): HttpsError {
    let functionsCode: FunctionsErrorCode = 'internal';

    switch (this.code) {
      case 'AUTH_REQUIRED':
        functionsCode = 'unauthenticated';
        break;
      case 'PERMISSION_DENIED':
      case 'ACCOUNT_SUSPENDED':
      case 'STEP_UP_REQUIRED':
        functionsCode = 'permission-denied';
        break;
      case 'RESOURCE_NOT_FOUND':
        functionsCode = 'not-found';
        break;
      case 'DUTY_CAPACITY_FILLED':
      case 'ASSIGNMENT_CONFLICT':
      case 'APPLICATION_ALREADY_EXISTS':
        functionsCode = 'already-exists';
        break;
      case 'VALIDATION_FAILED':
        functionsCode = 'invalid-argument';
        break;
      case 'CONSENT_REQUIRED':
      case 'HOSPITAL_NOT_VERIFIED':
      case 'DOCTOR_NOT_VERIFIED':
      case 'INVALID_STATE_TRANSITION':
      case 'PROFILE_CHANGED':
      case 'FILE_NOT_ALLOWED':
        functionsCode = 'failed-precondition';
        break;
      case 'RATE_LIMITED':
        functionsCode = 'resource-exhausted';
        break;
      case 'OFFER_EXPIRED':
        functionsCode = 'deadline-exceeded';
        break;
      default:
        functionsCode = 'internal';
    }

    return new HttpsError(functionsCode, this.message, {
      code: this.code,
      correlationId: this.correlationId,
      fieldErrors: this.fieldErrors,
      retryAfter: this.retryAfter,
    });
  }
}

/**
 * Converts any thrown value into the error the callable transport sends.
 * Firebase turns every non-HttpsError into a bare INTERNAL response, so domain
 * errors are translated here to keep their code and details for clients.
 */
export const toCallableError = (error: unknown, correlationId: string): HttpsError => {
  if (error instanceof DomainError) return error.toHttpsError();
  if (error instanceof HttpsError) return error;
  console.error('Unhandled callable error', { correlationId, error });
  return new HttpsError('internal', 'An internal error occurred', {
    code: 'INTERNAL_ERROR',
    correlationId,
  });
};
