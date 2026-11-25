/**
 * Trust & safety phase: solo practitioners, last-minute withdrawal, mutual
 * cancellation, radius alerts, SOS, chat parity and the lending scaffold,
 * against the Firestore emulator. Run with: npm run test:emulator
 */
import {
  CONSENT, HOUR, MFA, adminDb, call, clearFirestore, describeWithEmulator, expectDomainError, isoIn,
} from './helpers/emulator';
import { createOrganizationDraft, addFacility } from '../src/hospitals/hospitalFunctions';
import { createDuty, publishDuty } from '../src/duties/dutyFunctions';
import { applyToDuty } from '../src/applications/applicationFunctions';

jest.setTimeout(90_000);

const db = () => adminDb();
const now = () => Math.floor(Date.now() / 1000);
export const staffToken = () => ({ isSupportAdmin: true, auth_time: now(), ...MFA });
const consented = (...uids: string[]) => Promise.all(uids.map(uid => db().doc(`users/${uid}`).set(CONSENT, { merge: true })));
const flag = (key: string, enabled = true) => db().doc(`featureFlags/${key}`).set({ enabled });

const seedDoctor = (uid: string, extra: Record<string, unknown> = {}) =>
  db().doc(`doctors/${uid}`).set({
    fullName: `Doctor ${uid}`, isVerified: true, specialties: ['Emergency Medicine'], primarySpecialty: 'Emergency Medicine',
    council: 'Tamil Nadu Medical Council', registrationNo: `TN${uid}`, qualification: 'MBBS', yearsOfExperience: 5, ...extra,
  });

const soloPractice = {
  legalName: 'Dr. Solo Relief Practice', displayName: 'Dr. Solo', organizationType: 'solo_practice',
  address: '12 Anna Salai, Chennai', city: 'Chennai',
};

const dutyInput = (organizationId: string, facilityId: string) => ({
  organizationId, facilityId, facilityName: 'ignored', city: 'Chennai', department: 'OPD',
  specialtyId: 'em', specialtyName: 'Emergency Medicine', qualificationRequired: 'MBBS', experienceMinYears: 1,
  schedule: { startAt: isoIn(48 * HOUR), endAt: isoIn(56 * HOUR), shiftType: 'morning' },
  headcount: 1,
  paymentTerms: { amount: 4000, currency: 'INR', basis: 'per_shift', expectedPaymentTiming: 'end_of_shift' },
});

describeWithEmulator('trust & safety phase', () => {
  beforeAll(() => { adminDb(); });
  beforeEach(async () => {
    await clearFirestore();
    await consented('solo1', 'doc2', 'unverified1');
  });

  describe('WP1 solo practitioners', () => {
    test('a verified doctor creates an approved solo practice, stays a doctor and publishes a duty', async () => {
      await flag('solo_posting_enabled');
      await seedDoctor('solo1');
      await db().doc('users/solo1').set({ activeRole: 'doctor' }, { merge: true });

      const created = await call<{ organizationId: string; verificationState: string }>(createOrganizationDraft, 'solo1', soloPractice);
      expect(created.verificationState).toBe('approved');
      const org = (await db().doc(`organizations/${created.organizationId}`).get()).data()!;
      expect(org).toMatchObject({ verificationState: 'approved', verificationBasis: 'verified_doctor', registrationNumber: 'TNsolo1' });
      const user = (await db().doc('users/solo1').get()).data()!;
      expect(user.activeRole).toBe('doctor');
      expect(user.organizationIds).toContain(created.organizationId);
      const audit = await db().collection('auditLogs').where('targetId', '==', created.organizationId).get();
      expect(audit.docs[0].data()).toMatchObject({ reasonCode: 'SOLO_PRACTICE_REGISTRATION' });

      const { facilityId } = await call<{ facilityId: string }>(addFacility, 'solo1', {
        organizationId: created.organizationId, name: 'Practice', address: '12 Anna Salai, Chennai', city: 'Chennai',
        latitude: 13.06, longitude: 80.25,
      });
      const { dutyId } = await call<{ dutyId: string }>(createDuty, 'solo1', dutyInput(created.organizationId, facilityId));
      const published = await call<{ status: string }>(publishDuty, 'solo1', { dutyId });
      expect(published.status).toBe('published');

      // Conflict of interest still applies: the poster cannot take their own duty.
      await expectDomainError(call(applyToDuty, 'solo1', { dutyId, idempotencyKey: 'solo-apply-0001' }), 'PERMISSION_DENIED');
    });

    test('an unverified doctor is refused', async () => {
      await flag('solo_posting_enabled');
      await seedDoctor('unverified1', { isVerified: false });
      await expectDomainError(call(createOrganizationDraft, 'unverified1', soloPractice), 'DOCTOR_NOT_VERIFIED');
    });

    test('the flag off refuses', async () => {
      await seedDoctor('solo1');
      await expectDomainError(call(createOrganizationDraft, 'solo1', soloPractice), 'FEATURE_DISABLED');
    });

    test('hospitals still need a registration number and start as drafts', async () => {
      await expectDomainError(call(createOrganizationDraft, 'doc2', { ...soloPractice, organizationType: 'hospital' }), 'VALIDATION_FAILED');
      const created = await call<{ verificationState: string }>(createOrganizationDraft, 'doc2', {
        ...soloPractice, organizationType: 'hospital', registrationNumber: 'EST-1',
      });
      expect(created.verificationState).toBe('draft');
    });
  });
});
