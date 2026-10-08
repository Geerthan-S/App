/**
 * Production handler tests against the Firestore emulator.
 * Each test drives the real callables through the shared boundary wrapper, so
 * they cover authorization, transactions, error transport and atomic audit/outbox
 * writes — not simulations. Run with: npm run test:emulator
 */
import {
  adminDb, call, clearFirestore, CONSENT, describeWithEmulator, expectDomainError, HOUR, isoIn, verifierToken,
} from './helpers/emulator';
import { submitDoctorProfile } from '../src/doctors/doctorFunctions';
import {
  createVerificationCase, submitVerificationCase, recordVerificationDecision,
} from '../src/verification/verificationFunctions';
import {
  atomicSelectDoctor, confirmAssignment, cancelAssignment, completeAssignment,
} from '../src/assignments/assignmentFunctions';
import { expireAssignmentOffer, sweepExpiredOffers } from '../src/assignments/offerExpiryWorker';
import { applyToDuty } from '../src/applications/applicationFunctions';
import { recordConsent } from '../src/auth/authFunctions';
import { deliverOutboxEvent, recoverNotificationOutbox } from '../src/notifications/outboxWorker';
import { registerDeviceToken, deviceTokenId } from '../src/notifications/deviceTokenFunctions';
import { applyEvidenceScanResult } from '../src/verification/evidenceIngest';
import { requestDutyReplacement } from '../src/phase2/phase2Functions';

// The first call pays emulator and module cold-start costs.
jest.setTimeout(30_000);

const DOCTOR = 'doctorA';
const OTHER_DOCTOR = 'doctorB';
const STAFF = 'staffA';
const OUTSIDER = 'staffB';
const ORG = 'orgA';
const DUTY = 'dutyA';
const VERIFIER = 'verifierA';

const profile = {
  fullName: 'Synthetic Doctor',
  council: 'Synthetic Council',
  registrationNo: 'TEST123',
  qualification: 'MBBS',
  specialties: ['general_medicine'],
  primarySpecialty: 'general_medicine',
  yearsOfExperience: 4,
  preferredCities: ['Chennai'],
};

const db = () => adminDb();

const seedUsers = async () => {
  for (const uid of [DOCTOR, OTHER_DOCTOR, STAFF, OUTSIDER, VERIFIER]) {
    await db().doc(`users/${uid}`).set(CONSENT);
  }
};

const seedOrgAndDuty = async (overrides: Record<string, unknown> = {}) => {
  await db().doc(`organizations/${ORG}`).set({ displayName: 'Synthetic Hospital', verificationState: 'approved' });
  await db().doc(`organizations/${ORG}/members/${STAFF}`).set({ role: 'owner', status: 'active' });
  await db().doc(`duties/${DUTY}`).set({
    dutyId: DUTY,
    organizationId: ORG,
    facilityId: 'facA',
    facilityName: 'Synthetic Facility',
    department: 'ER',
    specialtyName: 'General Medicine',
    experienceMinYears: 2,
    schedule: { startAt: isoIn(48 * HOUR), endAt: isoIn(56 * HOUR), shiftType: 'morning' },
    headcount: 1,
    remainingHeadcount: 1,
    paymentTerms: { amount: 5000, currency: 'INR', basis: 'per_shift', expectedPaymentTiming: 'end_of_shift' },
    status: 'published',
    version: 1,
    ...overrides,
  });
};

/** Doctor with a verified profile on its current revision. */
const seedVerifiedDoctor = async (uid = DOCTOR) => {
  await call(submitDoctorProfile, uid, { ...profile, registrationNo: `REG${uid}` });
  await db().doc(`doctors/${uid}`).update({ isVerified: true, verificationStatus: 'approved' });
};

const selectDoctor = async (key = 'select-key-0001') => {
  await call(applyToDuty, DOCTOR, { dutyId: DUTY, idempotencyKey: 'apply-key-00001' });
  return call<{ assignmentId: string; expiresAt: string }>(atomicSelectDoctor, STAFF, {
    dutyId: DUTY, doctorId: DOCTOR, idempotencyKey: key,
  });
};

const countDocs = async (collection: string, field: string, value: string) =>
  (await db().collection(collection).where(field, '==', value).get()).size;

describeWithEmulator('production workflows (Firestore emulator)', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedUsers();
  });

  describe('credential revisions', () => {
    test('a qualification change (MBBS -> MD) revokes verification and supersedes the open case', async () => {
      await call(submitDoctorProfile, DOCTOR, profile);
      const { caseId } = await call<{ caseId: string }>(createVerificationCase, DOCTOR, { subjectType: 'doctor' });
      await db().doc(`doctors/${DOCTOR}`).update({ isVerified: true });

      const result = await call<{ isVerified: boolean; verificationReset: boolean; profileRevision: number }>(
        submitDoctorProfile, DOCTOR, { ...profile, qualification: 'MD' });

      expect(result).toMatchObject({ isVerified: false, verificationReset: true, profileRevision: 2 });
      const doctor = (await db().doc(`doctors/${DOCTOR}`).get()).data()!;
      expect(doctor.isVerified).toBe(false);
      expect(doctor.verificationCaseId).toBeNull();
      expect(doctor.previousVerificationCaseId).toBe(caseId);
      expect((await db().doc(`verificationCases/${caseId}`).get()).data()!.status).toBe('superseded');
    });

    test('a harmless bio edit keeps verification', async () => {
      await call(submitDoctorProfile, DOCTOR, profile);
      await db().doc(`doctors/${DOCTOR}`).update({ isVerified: true });
      const result = await call<{ isVerified: boolean; profileRevision: number }>(
        submitDoctorProfile, DOCTOR, { ...profile, bio: 'Now with a bio', preferredCities: ['Madurai'] });
      expect(result).toMatchObject({ isVerified: true, profileRevision: 1 });
    });

    test('registration numbers are unique across doctors', async () => {
      await call(submitDoctorProfile, DOCTOR, profile);
      await expectDomainError(call(submitDoctorProfile, OTHER_DOCTOR, profile), 'APPLICATION_ALREADY_EXISTS', 'already-exists');
    });

    test('approved -> name change -> new case; the approved decision stays as history', async () => {
      await call(submitDoctorProfile, DOCTOR, profile);
      const first = await call<{ caseId: string }>(createVerificationCase, DOCTOR, { subjectType: 'doctor' });
      await db().doc(`verificationCases/${first.caseId}`).update({ status: 'approved' });
      await db().doc(`doctors/${DOCTOR}`).update({ isVerified: true });

      // Unchanged, verified profile: the approved case is still current.
      const same = await call<{ caseId: string; created: boolean }>(createVerificationCase, DOCTOR, { subjectType: 'doctor' });
      expect(same).toMatchObject({ caseId: first.caseId, created: false });

      await call(submitDoctorProfile, DOCTOR, { ...profile, fullName: 'Changed Synthetic Name' });
      const second = await call<{ caseId: string; created: boolean }>(createVerificationCase, DOCTOR, { subjectType: 'doctor' });

      expect(second.created).toBe(true);
      expect(second.caseId).not.toBe(first.caseId);
      const newCase = (await db().doc(`verificationCases/${second.caseId}`).get()).data()!;
      expect(newCase).toMatchObject({ status: 'draft', subjectRevision: 2, previousCaseId: first.caseId });
      expect((await db().doc(`verificationCases/${first.caseId}`).get()).data()!.status).toBe('approved');
    });

    test('a rejected case is followed by a new resubmission case', async () => {
      await call(submitDoctorProfile, DOCTOR, profile);
      const first = await call<{ caseId: string }>(createVerificationCase, DOCTOR, { subjectType: 'doctor' });
      await db().doc(`verificationCases/${first.caseId}`).update({ status: 'rejected' });
      const second = await call<{ caseId: string; created: boolean }>(createVerificationCase, DOCTOR, { subjectType: 'doctor' });
      expect(second.created).toBe(true);
      expect((await db().doc(`verificationCases/${second.caseId}`).get()).data()!.previousCaseId).toBe(first.caseId);
    });
  });

  describe('verification decisions', () => {
    const review = () => ({
      sourceUrl: 'https://registry.example.gov.in/search',
      checkedAt: new Date(Date.now() - 60_000).toISOString(),
      registrationNumberMatched: true,
      nameMatched: true,
      councilMatched: true,
      qualificationMatched: true,
      officialStatus: 'ACTIVE',
    });

    const openSubmittedCase = async () => {
      await call(submitDoctorProfile, DOCTOR, profile);
      const { caseId } = await call<{ caseId: string }>(createVerificationCase, DOCTOR, { subjectType: 'doctor' });
      await db().doc('configuration/approved_registry_domains').set({ value: ['registry.example.gov.in'] });
      await db().doc('verificationDocuments/' + 'a'.repeat(64)).set({
        caseId, scanStatus: 'clean', generation: '17', scannedGeneration: '17', sha256: 'b'.repeat(64),
      });
      await call(submitVerificationCase, DOCTOR, { caseId });
      return caseId;
    };

    test('approval binds to the reviewed revision and marks the doctor verified', async () => {
      const caseId = await openSubmittedCase();
      await call(recordVerificationDecision, VERIFIER,
        { caseId, decision: 'approved', reasonCode: 'REGISTRY_MATCH', review: review() }, verifierToken());

      const doctor = (await db().doc(`doctors/${DOCTOR}`).get()).data()!;
      expect(doctor).toMatchObject({ isVerified: true, verifiedRevision: 1, verifiedCaseId: caseId });
      // Decision, check, audit and outbox committed together.
      expect(await countDocs('auditLogs', 'targetId', caseId)).toBeGreaterThanOrEqual(1);
      expect(await countDocs('notificationOutbox', 'targetUserId', DOCTOR)).toBe(1);
    });

    test('a case cannot be approved after the profile changed under review', async () => {
      const caseId = await openSubmittedCase();
      await call(submitDoctorProfile, DOCTOR, { ...profile, qualification: 'MD' });
      // The open case was superseded by the material change.
      await expectDomainError(
        call(recordVerificationDecision, VERIFIER,
          { caseId, decision: 'approved', reasonCode: 'REGISTRY_MATCH', review: review() }, verifierToken()),
        'INVALID_STATE_TRANSITION');
      expect((await db().doc(`doctors/${DOCTOR}`).get()).data()!.isVerified).toBe(false);
    });

    test('approval is refused while any evidence is unscanned or scanned at another generation', async () => {
      const caseId = await openSubmittedCase();
      await db().doc('verificationDocuments/' + 'c'.repeat(64)).set({
        caseId, scanStatus: 'clean', generation: '22', scannedGeneration: '21', sha256: 'd'.repeat(64),
      });
      await expectDomainError(
        call(recordVerificationDecision, VERIFIER,
          { caseId, decision: 'approved', reasonCode: 'REGISTRY_MATCH', review: review() }, verifierToken()),
        'INVALID_STATE_TRANSITION');
    });

    test('a verifier who is a member of the organization cannot decide its case', async () => {
      await seedOrgAndDuty();
      await db().doc(`organizations/${ORG}/members/${VERIFIER}`).set({ role: 'admin', status: 'active' });
      await db().doc(`verificationCases/orgCase`).set({ subjectType: 'organization', subjectId: ORG, status: 'submitted' });
      await db().doc(`organizations/${ORG}`).update({ verificationCaseId: 'orgCase' });
      await expectDomainError(
        call(recordVerificationDecision, VERIFIER,
          { caseId: 'orgCase', decision: 'rejected', reasonCode: 'CONFLICT_TEST' }, verifierToken()),
        'PERMISSION_DENIED', 'permission-denied');
    });

    test('scanner verdicts only apply to the exact indexed generation and hash', async () => {
      const id = 'e'.repeat(64);
      await db().doc(`verificationDocuments/${id}`).set({
        bucket: 'bucket', objectKey: 'verification/doctor/x/y/z.pdf', generation: '5', sha256: 'f'.repeat(64),
        scanStatus: 'pending', scannedGeneration: null,
      });
      const base = {
        documentId: id, bucket: 'bucket', objectKey: 'verification/doctor/x/y/z.pdf', sha256: 'f'.repeat(64),
        verdict: 'clean' as const, scannerId: 'scanner', scannedAt: new Date().toISOString(),
      };
      expect(await applyEvidenceScanResult({ ...base, generation: '4' })).toBe('stale');
      expect((await db().doc(`verificationDocuments/${id}`).get()).data()!.scanStatus).toBe('pending');
      expect(await applyEvidenceScanResult({ ...base, generation: '5' })).toBe('applied');
      expect((await db().doc(`verificationDocuments/${id}`).get()).data()).toMatchObject({ scanStatus: 'clean', scannedGeneration: '5' });
    });
  });

  describe('selection, confirmation and cancellation', () => {
    beforeEach(async () => {
      await seedOrgAndDuty();
      await seedVerifiedDoctor();
    });

    test('cancellation releases the seat, schedule lock and application exactly once', async () => {
      const { assignmentId } = await selectDoctor();
      expect((await db().doc(`duties/${DUTY}`).get()).data()).toMatchObject({ remainingHeadcount: 0, status: 'filled' });

      // Two concurrent cancellations: one transition, one replay.
      await Promise.all([
        call(cancelAssignment, DOCTOR, { assignmentId }),
        call(cancelAssignment, DOCTOR, { assignmentId }),
      ]);

      expect((await db().doc(`assignments/${assignmentId}`).get()).data()!.status).toBe('cancelled');
      expect((await db().doc(`duties/${DUTY}`).get()).data()).toMatchObject({ remainingHeadcount: 1, status: 'published' });
      expect((await db().doc(`duties/${DUTY}/applications/${DOCTOR}`).get()).data()!.status).toBe('withdrawn');
      const schedules = await db().collection('doctorSchedules').where('doctorId', '==', DOCTOR).get();
      schedules.forEach(doc => expect(doc.data().intervals).toHaveLength(0));
      expect(await countDocs('assignmentEvents', 'assignmentId', assignmentId)).toBe(2); // selected, cancelled
    });

    test('on a multi-seat duty, concurrent cancellations restore exactly one seat', async () => {
      await db().doc(`duties/${DUTY}`).update({ headcount: 3, remainingHeadcount: 3 });
      await seedVerifiedDoctor(OTHER_DOCTOR);
      const { assignmentId } = await selectDoctor();
      await call(applyToDuty, OTHER_DOCTOR, { dutyId: DUTY, idempotencyKey: 'apply-key-00002' });
      await call(atomicSelectDoctor, STAFF, { dutyId: DUTY, doctorId: OTHER_DOCTOR, idempotencyKey: 'select-key-0002' });
      expect((await db().doc(`duties/${DUTY}`).get()).data()!.remainingHeadcount).toBe(1);

      await Promise.all([
        call(cancelAssignment, DOCTOR, { assignmentId }),
        call(cancelAssignment, STAFF, { assignmentId }),
        call(cancelAssignment, DOCTOR, { assignmentId }),
      ]);
      expect((await db().doc(`duties/${DUTY}`).get()).data()!.remainingHeadcount).toBe(2);
    });

    test('a confirmed assignment can be cancelled by the hospital and revokes contact access', async () => {
      const { assignmentId } = await selectDoctor();
      await call(confirmAssignment, DOCTOR, { assignmentId, idempotencyKey: 'confirm-key-001' });
      expect((await db().doc(`contactGrants/asg_${assignmentId}`).get()).data()!.status).toBe('active');

      await call(cancelAssignment, STAFF, { assignmentId, reason: 'HOSPITAL_CHANGE' });
      expect((await db().doc(`contactGrants/asg_${assignmentId}`).get()).data()!.status).toBe('revoked');
      expect((await db().doc(`duties/${DUTY}`).get()).data()!.remainingHeadcount).toBe(1);
    });

    test('confirmation requires an idempotency key and replays harmlessly', async () => {
      const { assignmentId } = await selectDoctor();
      await expectDomainError(call(confirmAssignment, DOCTOR, { assignmentId }), 'VALIDATION_FAILED', 'invalid-argument');
      const first = await call<{ replayed: boolean }>(confirmAssignment, DOCTOR, { assignmentId, idempotencyKey: 'confirm-key-001' });
      const second = await call<{ replayed: boolean }>(confirmAssignment, DOCTOR, { assignmentId, idempotencyKey: 'confirm-key-001' });
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(await countDocs('contactGrants', 'assignmentId', assignmentId)).toBe(1);
    });

    test('selection replays the same idempotency key instead of double-reserving', async () => {
      const first = await selectDoctor('select-key-0001');
      const replay = await call<{ assignmentId: string }>(atomicSelectDoctor, STAFF, {
        dutyId: DUTY, doctorId: DOCTOR, idempotencyKey: 'select-key-0001',
      });
      expect(replay.assignmentId).toBe(first.assignmentId);
      expect(await countDocs('assignments', 'dutyId', DUTY)).toBe(1);
    });

    test('completion is recorded once and only after the shift starts', async () => {
      const { assignmentId } = await selectDoctor();
      await call(confirmAssignment, DOCTOR, { assignmentId, idempotencyKey: 'confirm-key-001' });
      await expectDomainError(call(completeAssignment, STAFF, { assignmentId }), 'INVALID_STATE_TRANSITION');

      await db().doc(`assignments/${assignmentId}`).update({ 'termsSnapshot.startAt': isoIn(-HOUR) });
      await Promise.all([
        call(completeAssignment, STAFF, { assignmentId }),
        call(completeAssignment, STAFF, { assignmentId }),
      ]);
      expect((await db().doc(`assignments/${assignmentId}`).get()).data()!.status).toBe('completed');
      expect(await countDocs('completionRecords', 'assignmentId', assignmentId)).toBe(1);
    });
  });

  describe('offer expiry', () => {
    beforeEach(async () => {
      await seedOrgAndDuty();
      await seedVerifiedDoctor();
    });

    test('an overdue offer is expired and its reservation released', async () => {
      const { assignmentId } = await selectDoctor();
      const later = Date.now() + 13 * HOUR;

      const counts = await sweepExpiredOffers(later);
      expect(counts.expired).toBe(1);
      expect((await db().doc(`assignments/${assignmentId}`).get()).data()!.status).toBe('expired');
      expect((await db().doc(`duties/${DUTY}`).get()).data()).toMatchObject({ remainingHeadcount: 1, status: 'published' });
      expect((await db().doc(`duties/${DUTY}/applications/${DOCTOR}`).get()).data()!.status).toBe('expired');

      // A second sweep, or a late confirmation, changes nothing.
      expect(await expireAssignmentOffer(assignmentId, later)).toBe('not_selected');
      await expectDomainError(
        call(confirmAssignment, DOCTOR, { assignmentId, idempotencyKey: 'confirm-key-001' }),
        'INVALID_STATE_TRANSITION');
      expect((await db().doc(`duties/${DUTY}`).get()).data()!.remainingHeadcount).toBe(1);
    });

    test('expiry and confirmation race: exactly one wins and capacity stays consistent', async () => {
      const { assignmentId } = await selectDoctor();
      // Offer has just expired; the doctor taps confirm at the same moment the sweep runs.
      await db().doc(`assignments/${assignmentId}`).update({ expiresAt: isoIn(-1000) });
      const [confirm, expire] = await Promise.allSettled([
        call(confirmAssignment, DOCTOR, { assignmentId, idempotencyKey: 'confirm-key-001' }),
        expireAssignmentOffer(assignmentId),
      ]);
      expect(confirm.status).toBe('rejected');
      expect(expire).toMatchObject({ status: 'fulfilled', value: 'expired' });
      expect((await db().doc(`duties/${DUTY}`).get()).data()!.remainingHeadcount).toBe(1);
    });

    test('an offer that has not expired is left alone and can still be confirmed', async () => {
      const { assignmentId } = await selectDoctor();
      expect(await expireAssignmentOffer(assignmentId)).toBe('not_due');
      await call(confirmAssignment, DOCTOR, { assignmentId, idempotencyKey: 'confirm-key-001' });
      expect(await expireAssignmentOffer(assignmentId, Date.now() + 24 * HOUR)).toBe('not_selected');
    });
  });

  describe('account and membership eligibility', () => {
    beforeEach(async () => {
      await seedOrgAndDuty();
      await seedVerifiedDoctor();
    });

    test('a suspended doctor cannot confirm, apply or be selected', async () => {
      const { assignmentId } = await selectDoctor();
      await db().doc(`users/${DOCTOR}`).update({ status: 'suspended' });
      await expectDomainError(
        call(confirmAssignment, DOCTOR, { assignmentId, idempotencyKey: 'confirm-key-001' }),
        'ACCOUNT_SUSPENDED', 'permission-denied');

      await call(cancelAssignment, STAFF, { assignmentId });
      await db().doc(`duties/${DUTY}/applications/${DOCTOR}`).update({ status: 'submitted' });
      await expectDomainError(
        call(atomicSelectDoctor, STAFF, { dutyId: DUTY, doctorId: DOCTOR, idempotencyKey: 'select-key-0002' }),
        'ACCOUNT_SUSPENDED');
    });

    test('a doctor whose verification was revoked cannot be selected', async () => {
      await call(applyToDuty, DOCTOR, { dutyId: DUTY, idempotencyKey: 'apply-key-00001' });
      await call(submitDoctorProfile, DOCTOR, { ...profile, registrationNo: `REG${DOCTOR}`, qualification: 'MD' });
      await expectDomainError(
        call(atomicSelectDoctor, STAFF, { dutyId: DUTY, doctorId: DOCTOR, idempotencyKey: 'select-key-0001' }),
        'DOCTOR_NOT_VERIFIED', 'failed-precondition');
    });

    test('a suspended staff account and a removed membership cannot act for the organization', async () => {
      await call(applyToDuty, DOCTOR, { dutyId: DUTY, idempotencyKey: 'apply-key-00001' });
      await db().doc(`users/${STAFF}`).update({ status: 'suspended' });
      await expectDomainError(
        call(atomicSelectDoctor, STAFF, { dutyId: DUTY, doctorId: DOCTOR, idempotencyKey: 'select-key-0001' }),
        'ACCOUNT_SUSPENDED');

      await db().doc(`users/${STAFF}`).update({ status: 'active' });
      await db().doc(`organizations/${ORG}/members/${STAFF}`).update({ status: 'removed' });
      await expectDomainError(
        call(atomicSelectDoctor, STAFF, { dutyId: DUTY, doctorId: DOCTOR, idempotencyKey: 'select-key-0001' }),
        'PERMISSION_DENIED');
      expect((await db().doc(`duties/${DUTY}`).get()).data()!.remainingHeadcount).toBe(1);
    });

    test('an outsider cannot cancel another party\'s assignment', async () => {
      const { assignmentId } = await selectDoctor();
      await expectDomainError(call(cancelAssignment, OUTSIDER, { assignmentId }), 'PERMISSION_DENIED');
    });
  });

  describe('consent', () => {
    test('business operations require recorded consent; consent is version-checked', async () => {
      await db().doc(`users/${DOCTOR}`).set({ status: 'active' });
      await expectDomainError(call(submitDoctorProfile, DOCTOR, profile), 'CONSENT_REQUIRED', 'failed-precondition');
      await expectDomainError(call(recordConsent, DOCTOR, { consentVersion: 'v0.9' }), 'VALIDATION_FAILED');
      await call(recordConsent, DOCTOR, { consentVersion: 'v1.0_2026' });
      expect((await db().doc(`users/${DOCTOR}`).get()).data()!.consentVersion).toBe('v1.0_2026');
      await call(submitDoctorProfile, DOCTOR, profile);
    });

    test('domain errors reach the client with their code and transport status', async () => {
      await expectDomainError(call(submitDoctorProfile, null, profile), 'AUTH_REQUIRED', 'unauthenticated');
    });
  });

  describe('notifications', () => {
    test('organization events fan out to active owners/admins with deterministic inbox ids', async () => {
      await seedOrgAndDuty();
      await db().doc(`organizations/${ORG}/members/adminB`).set({ role: 'admin', status: 'active' });
      await db().doc(`organizations/${ORG}/members/viewerC`).set({ role: 'member', status: 'active' });
      await db().doc(`organizations/${ORG}/members/formerD`).set({ role: 'admin', status: 'removed' });
      const ref = db().collection('notificationOutbox').doc('evt1');
      await ref.set({
        targetOrganizationId: ORG, targetUserId: null, title: 't', body: 'b', payload: {}, eventType: 'x',
        dedupeKey: 'k', status: 'pending', attemptCount: 0, maxAttempts: 5,
      });

      expect(await deliverOutboxEvent(ref)).toBe('delivered');
      const inbox = await db().collection('inboxNotifications').where('outboxId', '==', 'evt1').get();
      expect(inbox.docs.map(d => d.id).sort()).toEqual(['evt1_adminB', `evt1_${STAFF}`]);
      // Delivered events are not re-sent.
      expect(await deliverOutboxEvent(ref)).toBe('not_claimed');
    });

    test('a lease abandoned by a crashed worker is reclaimed and delivered once', async () => {
      const ref = db().collection('notificationOutbox').doc('evt2');
      await ref.set({
        targetUserId: DOCTOR, targetOrganizationId: null, title: 't', body: 'b', payload: {}, eventType: 'x',
        dedupeKey: 'k2', status: 'leased', leaseExpiresAt: isoIn(-60_000), attemptCount: 1, maxAttempts: 5,
      });
      expect(await recoverNotificationOutbox()).toBe(1);
      expect((await ref.get()).data()).toMatchObject({ status: 'delivered', attemptCount: 2 });
      expect((await db().doc(`inboxNotifications/evt2_${DOCTOR}`).get()).exists).toBe(true);
    });

    test('a device token moves to the account that registers it last', async () => {
      const token = 'fcm-token-' + 'x'.repeat(40);
      await call(registerDeviceToken, DOCTOR, { token, platform: 'android' });
      await call(registerDeviceToken, OTHER_DOCTOR, { token, platform: 'android' });
      const doc = (await db().doc(`deviceTokens/${deviceTokenId(token)}`).get()).data()!;
      expect(doc).toMatchObject({ uid: OTHER_DOCTOR, previousUid: DOCTOR, enabled: true });
    });
  });

  describe('phase 2 authorization', () => {
    test('an enabled flag does not let a non-party request a replacement', async () => {
      await seedOrgAndDuty();
      await seedVerifiedDoctor();
      const { assignmentId } = await selectDoctor();
      await call(confirmAssignment, DOCTOR, { assignmentId, idempotencyKey: 'confirm-key-001' });
      await db().doc('featureFlags/phase2_replacement_enabled').set({ enabled: true });
      await expectDomainError(
        call(requestDutyReplacement, OUTSIDER, { assignmentId, reason: 'Not my assignment' }),
        'PERMISSION_DENIED');
    });
  });
});
