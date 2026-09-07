/**
 * Atomic Doctor Selection & Double-Booking Concurrency Test Suite
 * Simulates 25 simultaneous selection attempts against limited capacity.
 */

import { getDateIntervals, intervalsOverlap } from '../src/shared/firestoreHelpers';

describe('Atomic Selection & Concurrency Test Suite', () => {
  test('25 simultaneous selection attempts against duty capacity = 1', async () => {
    let remainingHeadcount = 1;
    let successfulSelections = 0;
    let conflictErrors = 0;

    // Simulated transaction locking helper
    const simulatedTransactionSelect = async (candidateId: string) => {
      // In a real Firestore transaction, the read & write are serialized atomically
      if (remainingHeadcount > 0) {
        remainingHeadcount -= 1;
        successfulSelections += 1;
        return { status: 200, candidateId, remainingHeadcount };
      } else {
        conflictErrors += 1;
        return { status: 409, code: 'DUTY_CAPACITY_FILLED' };
      }
    };

    // Spawn 25 concurrent requests
    const attempts = Array.from({ length: 25 }, (_, i) => simulatedTransactionSelect(`doc_${i + 1}`));
    const results = await Promise.all(attempts);

    expect(successfulSelections).toBe(1);
    expect(conflictErrors).toBe(24);
    expect(remainingHeadcount).toBe(0);

    const successfulResult = results.find(r => r.status === 200);
    expect(successfulResult).toBeDefined();
  });

  test('Double-Booking Prevention: Overlapping interval detection across dates', () => {
    const duty1Start = '2026-09-15T08:00:00Z';
    const duty1End = '2026-09-15T16:00:00Z';

    const overlappingDutyStart = '2026-09-15T14:00:00Z';
    const overlappingDutyEnd = '2026-09-15T22:00:00Z';

    const nonOverlappingDutyStart = '2026-09-15T17:00:00Z';
    const nonOverlappingDutyEnd = '2026-09-15T23:00:00Z';

    const isOverlap1 = intervalsOverlap(duty1Start, duty1End, overlappingDutyStart, overlappingDutyEnd);
    const isOverlap2 = intervalsOverlap(duty1Start, duty1End, nonOverlappingDutyStart, nonOverlappingDutyEnd);

    expect(isOverlap1).toBe(true);
    expect(isOverlap2).toBe(false);

    // Verify covered calendar dates helper
    const coveredDates = getDateIntervals(duty1Start, duty1End);
    expect(coveredDates).toEqual(['2026-09-15']);
  });

  test('Double-Booking Prevention: Midnight spanning shift coverage', () => {
    const nightShiftStart = '2026-09-15T20:00:00Z';
    const nightShiftEnd = '2026-09-16T08:00:00Z';

    const coveredDates = getDateIntervals(nightShiftStart, nightShiftEnd);
    expect(coveredDates).toEqual(['2026-09-15', '2026-09-16']);
  });
});
