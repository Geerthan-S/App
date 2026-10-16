/**
 * Verification Workflow & Decision Engine Test Suite
 */

import { ManualVerificationAdapter } from '../src/verification/verificationSourceAdapter';
import { normalizeRegistrationNo } from '../src/shared/firestoreHelpers';

describe('Doctor Verification & Adapter Test Suite', () => {
  test('Registration Number Normalization: Canonical uppercase with council key', () => {
    const council = 'Tamil Nadu Medical Council';
    const regNo = '98234 / 2020 ';

    const normalized = normalizeRegistrationNo(council, regNo);
    expect(normalized).toBe('TAMIL_NADU_MEDICAL_COUNCIL_982342020');
  });

  test('Manual adapter does not fabricate an official registry match', async () => {
    const adapter = new ManualVerificationAdapter();
    const result = await adapter.lookup({
      council: 'Tamil Nadu Medical Council',
      registrationNumber: 'TNMC_98234',
      doctorName: 'Dr. Aravind Swaminathan',
    });

    expect(result.matched).toBe(false);
    expect(result.officialStatus).toBe('SOURCE_UNAVAILABLE');
    expect(result.sourceName).toContain('pending');
    expect(result.checkedAt).toBeDefined();
  });
});
