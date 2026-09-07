/**
 * Typed Domain Error Envelope & Error Classes
 */

import { HttpsError, FunctionsErrorCode } from 'firebase-functions/v2/https';

export type DomainErrorCode =
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'STEP_UP_REQUIRED'
  | 'HOSPITAL_NOT_VERIFIED'
  | 'DOCTOR_NOT_VERIFIED'
  | 'APPLICATION_ALREADY_EXISTS'
  | 'INVALID_STATE_TRANSITION'
  | 'ASSIGNMENT_CONFLICT'
  | 'DUTY_CAPACITY_FILLED'
  | 'OFFER_EXPIRED'
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
      case 'INVALID_STATE_TRANSITION':
        functionsCode = 'invalid-argument';
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
