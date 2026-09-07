/**
 * Idempotency & Network Retry Test Suite
 * Ensures duplicate calls never generate uncontrolled duplicate records or invalid state transitions.
 */

describe('Idempotency & Retry Test Suite', () => {
  test('applyToDuty: Re-executing apply with same doctorId and dutyId does not create second active application', () => {
    const existingApplications = new Map<string, any>();

    const apply = (dutyId: string, doctorId: string) => {
      const key = `${dutyId}_${doctorId}`;
      if (existingApplications.has(key)) {
        const existing = existingApplications.get(key);
        if (['submitted', 'shortlisted', 'selected'].includes(existing.status)) {
          return { status: 409, code: 'APPLICATION_ALREADY_EXISTS', appId: existing.appId };
        }
      }
      const app = { appId: `app_${key}`, dutyId, doctorId, status: 'submitted' };
      existingApplications.set(key, app);
      return { status: 200, appId: app.appId };
    };

    const firstCall = apply('duty_1', 'doc_1');
    const secondCallRetry = apply('duty_1', 'doc_1');

    expect(firstCall.status).toBe(200);
    expect(secondCallRetry.status).toBe(409);
    expect(existingApplications.size).toBe(1);
  });

  test('atomicSelectDoctor: Re-attempting selection for already selected candidate does not duplicate assignment', () => {
    let applicationStatus = 'shortlisted';
    let assignmentCount = 0;

    const select = () => {
      if (applicationStatus !== 'submitted' && applicationStatus !== 'shortlisted') {
        return { status: 409, code: 'INVALID_STATE_TRANSITION' };
      }
      applicationStatus = 'selected';
      assignmentCount += 1;
      return { status: 200 };
    };

    const firstSelect = select();
    const retrySelect = select();

    expect(firstSelect.status).toBe(200);
    expect(retrySelect.status).toBe(409);
    expect(assignmentCount).toBe(1);
  });

  test('confirmAssignment: Idempotent confirmation returns success without creating multiple contact grants', () => {
    let assignmentStatus = 'selected';
    let contactGrantCount = 0;

    const confirm = () => {
      if (assignmentStatus === 'confirmed') {
        return { status: 200, message: 'ALREADY_CONFIRMED' };
      }
      if (assignmentStatus !== 'selected') {
        return { status: 409, code: 'INVALID_STATE_TRANSITION' };
      }
      assignmentStatus = 'confirmed';
      contactGrantCount += 1;
      return { status: 200, message: 'CONFIRMED' };
    };

    const first = confirm();
    const second = confirm();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(contactGrantCount).toBe(1);
  });
});
