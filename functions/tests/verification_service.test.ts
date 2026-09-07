/**
 * Tests for VerificationService, ComparisonEngine, and Platform Defaults
 */

import { ComparisonEngine, VerificationService } from '../src/verification/verificationService';
import { getOfferExpiryHours, PLATFORM_DEFAULTS } from '../src/shared/platformConfig';

describe('VerificationService & ComparisonEngine Tests', () => {
  test('Exact match against official active record yields MATCH and auto-approvable', () => {
    const submitted = {
      registrationNumber: 'TNMC_98234',
      council: 'Tamil Nadu Medical Council',
      fullName: 'Dr. Aravind Swaminathan',
      qualification: 'MBBS, MD',
    };

    const official = {
      registrationNumber: 'TNMC_98234',
      council: 'Tamil Nadu Medical Council',
      registeredName: 'Dr. Aravind Swaminathan',
      qualifications: ['MBBS', 'MD (General Medicine)'],
      status: 'ACTIVE' as const,
    };

    const result = ComparisonEngine.compare(submitted, official);
    expect(result.outcome).toBe('MATCH');
    expect(result.isAutoApprovable).toBe(true);
    expect(result.confidenceScore).toBe(100);
    expect(result.discrepancySummary).toBeNull();
  });

  test('Name variation with prefix removal matches successfully', () => {
    const submitted = {
      registrationNumber: 'TNMC123456',
      council: 'Tamil Nadu Medical Council',
      fullName: 'Dr. Arun Kumar',
      qualification: 'MBBS',
    };

    const official = {
      registrationNumber: 'TNMC123456',
      council: 'Tamil Nadu Medical Council',
      registeredName: 'Arun Kumar',
      qualifications: ['MBBS'],
      status: 'ACTIVE' as const,
    };

    const result = ComparisonEngine.compare(submitted, official);
    expect(result.outcome).toBe('MATCH');
    expect(result.isAutoApprovable).toBe(true);
  });

  test('Suspended official registration produces MISMATCH', () => {
    const submitted = {
      registrationNumber: 'TNMC_SUSPENDED',
      council: 'Tamil Nadu Medical Council',
      fullName: 'Dr. Suspended Practitioner',
      qualification: 'MBBS',
    };

    const official = {
      registrationNumber: 'TNMC_SUSPENDED',
      council: 'Tamil Nadu Medical Council',
      registeredName: 'Dr. Suspended Practitioner',
      qualifications: ['MBBS'],
      status: 'SUSPENDED' as const,
    };

    const result = ComparisonEngine.compare(submitted, official);
    expect(result.outcome).toBe('MISMATCH');
    expect(result.isAutoApprovable).toBe(false);
    expect(result.discrepancySummary).toContain('Council registration status is SUSPENDED');
  });

  test('Registration number mismatch produces MISMATCH', () => {
    const submitted = {
      registrationNumber: 'TNMC_WRONG_NUMBER',
      council: 'Tamil Nadu Medical Council',
      fullName: 'Dr. Aravind Swaminathan',
      qualification: 'MBBS',
    };

    const official = {
      registrationNumber: 'TNMC_98234',
      council: 'Tamil Nadu Medical Council',
      registeredName: 'Dr. Aravind Swaminathan',
      qualifications: ['MBBS'],
      status: 'ACTIVE' as const,
    };

    const result = ComparisonEngine.compare(submitted, official);
    expect(result.outcome).toBe('MISMATCH');
    expect(result.isAutoApprovable).toBe(false);
    expect(result.discrepancySummary).toContain('Registration number mismatch');
  });

  test('Missing/unfound record produces NOT_FOUND', () => {
    const submitted = {
      registrationNumber: 'UNKNOWN_99999',
      council: 'Tamil Nadu Medical Council',
      fullName: 'Dr. Non Existent',
      qualification: 'MBBS',
    };

    const result = ComparisonEngine.compare(submitted, null);
    expect(result.outcome).toBe('NOT_FOUND');
    expect(result.isAutoApprovable).toBe(false);
    expect(result.confidenceScore).toBe(0);
  });

  test('VerificationService orchestrator looks up authorized NMC sandbox', async () => {
    const service = new VerificationService();

    // Known test record in sandbox
    const matchRes = await service.verifyDoctor({
      registrationNumber: 'TNMC98234',
      council: 'Tamil Nadu Medical Council',
      fullName: 'Dr. Aravind Swaminathan',
      qualification: 'MBBS, MD',
    });

    expect(matchRes.providerStatus).toBe('SUCCESS');
    expect(matchRes.comparison.outcome).toBe('MATCH');
    expect(matchRes.officialRecord?.status).toBe('ACTIVE');

    // Unknown record
    const notFoundRes = await service.verifyDoctor({
      registrationNumber: 'NON_EXISTENT_1111',
      council: 'Delhi Medical Council',
      fullName: 'Dr. Ghost',
      qualification: 'MBBS',
    });

    expect(notFoundRes.providerStatus).toBe('NOT_FOUND');
    expect(notFoundRes.comparison.outcome).toBe('NOT_FOUND');
  });

  test('Platform default offer expiry duration is centralized to 12 hours', async () => {
    expect(PLATFORM_DEFAULTS.OFFER_EXPIRY_HOURS).toBe(12);
    const duration = await getOfferExpiryHours();
    expect(duration).toBe(12);
  });
});
