/**
 * Callable error translation.
 * Contested transactions can exhaust Firestore's retries and throw gRPC ABORTED
 * (seen in the load-test seat race); clients must get a retryable conflict
 * instead of a generic INTERNAL_ERROR.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { DomainError, toCallableError } from '../src/shared/errors';

const firestoreAborted = () =>
  Object.assign(new Error('10 ABORTED: Transaction lock timeout.'), { code: 10 });

describe('toCallableError', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  test('Firestore ABORTED becomes a retryable CONCURRENT_UPDATE conflict', () => {
    const result = toCallableError(firestoreAborted(), 'corr_1');

    expect(result).toBeInstanceOf(HttpsError);
    expect(result.code).toBe('aborted');
    expect(result.httpErrorCode.status).toBe(409);
    expect(result.details).toMatchObject({ code: 'CONCURRENT_UPDATE', correlationId: 'corr_1' });
    expect(console.error).not.toHaveBeenCalled();
  });

  test('CONCURRENT_UPDATE domain error maps to the aborted status', () => {
    const result = new DomainError('CONCURRENT_UPDATE', 'busy', 'corr_2').toHttpsError();

    expect(result.code).toBe('aborted');
    expect(result.details).toMatchObject({ code: 'CONCURRENT_UPDATE' });
  });

  test('errors with other numeric codes stay INTERNAL_ERROR', () => {
    const unavailable = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    const result = toCallableError(unavailable, 'corr_3');

    expect(result.code).toBe('internal');
    expect(result.details).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(console.error).toHaveBeenCalled();
  });

  test('domain errors keep their own code', () => {
    const filled = new DomainError('DUTY_CAPACITY_FILLED', 'filled', 'corr_4');
    const result = toCallableError(filled, 'corr_4');

    expect(result.code).toBe('already-exists');
    expect(result.details).toMatchObject({ code: 'DUTY_CAPACITY_FILLED' });
  });
});
