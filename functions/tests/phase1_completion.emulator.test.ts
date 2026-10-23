/**
 * Phase 1 completion against the Auth and Firestore emulators: hospital roles,
 * invitations and offboarding; data export, privacy requests and account
 * deletion; devices; notification preferences; verification appeals; duty
 * edits; saved searches; app release config; backup naming.
 * Run with: npm run test:emulator
 */
import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import {
  CONSENT, HOUR, MFA, adminDb, call, clearFirestore, describeWithEmulator, expectDomainError, isoIn, verifierToken,
} from './helpers/emulator';
import {
  inviteOrgMember, listMyInvitations, listOrgMembers, removeOrgMember, respondToInvitation, revokeOrgInvitation,
  updateOrgMemberRole,
} from '../src/hospitals/teamFunctions';
import {
  deleteMyAccount, exportMyData, getNotificationPreferences, listMyDevices, signOutEverywhere, submitPrivacyRequest,
  updateNotificationPreferences,
} from '../src/account/accountFunctions';
import { categoryOf, inQuietHours, shouldPush } from '../src/notifications/preferences';
import { decideVerificationAppeal, listVerificationAppeals, submitVerificationAppeal } from '../src/verification/appealFunctions';
import { updateDuty } from '../src/duties/dutyEditFunctions';
import { publishDuty } from '../src/duties/dutyFunctions';
import { shortlistApplication } from '../src/applications/applicationFunctions';
import { listSavedSearches, matchingSearchers, saveSearch, updateSavedSearch } from '../src/search/savedSearchFunctions';
import { updatePlatformConfig } from '../src/admin/adminFunctions';
import { exportOutputPrefix } from '../src/ops/backupFunctions';

jest.setTimeout(60_000);

const now = () => Math.floor(Date.now() / 1000);
const superToken = () => ({ isSuperAdmin: true, auth_time: now(), ...MFA });
const fresh = () => ({ auth_time: now() });
const db = () => adminDb();
const ts = (ms: number) => Timestamp.fromMillis(ms);

const clearAuth = async () => {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (host) await fetch(`http://${host}/emulator/v1/projects/demo-healthforce/accounts`, { method: 'DELETE' });
};

const member = (orgId: string, uid: string, role: string, status = 'active') =>
  db().doc(`organizations/${orgId}/members/${uid}`).set({ userId: uid, organizationId: orgId, role, status });

const consented = (...uids: string[]) => Promise.all(uids.map(uid => db().doc(`users/${uid}`).set(CONSENT, { merge: true })));

describeWithEmulator('phase 1 completion', () => {
  beforeAll(() => { adminDb(); });
  beforeEach(async () => {
    await clearFirestore();
    await clearAuth();
  });

  describe('hospital roles', () => {
    test('operations staff cannot publish duties or shortlist; recruiters can', async () => {
      await db().doc('organizations/o1').set({ legalName: 'City Care', verificationState: 'approved' });
      await member('o1', 'ops', 'operations');
      await member('o1', 'rec', 'recruiter');
      await consented('ops', 'rec');
      await db().doc('duties/u1').set({ organizationId: 'o1', status: 'draft', version: 1, schedule: { startAt: isoIn(48 * HOUR) } });
      await db().doc('duties/u1/applications/doc1').set({ doctorId: 'doc1', status: 'submitted', version: 1 });

      await expectDomainError(call(publishDuty, 'ops', { dutyId: 'u1' }), 'PERMISSION_DENIED');
      await expectDomainError(call(shortlistApplication, 'ops', { dutyId: 'u1', doctorId: 'doc1' }), 'PERMISSION_DENIED');
      await call(publishDuty, 'rec', { dutyId: 'u1' });
      await call(shortlistApplication, 'rec', { dutyId: 'u1', doctorId: 'doc1' });
      expect((await db().doc('duties/u1').get()).data()?.status).toBe('published');
    });
  });

  describe('team invitations and offboarding', () => {
    beforeEach(async () => {
      await db().doc('organizations/o1').set({ legalName: 'City Care Pvt Ltd', displayName: 'City Care' });
      await member('o1', 'owner1', 'owner');
      await member('o1', 'admin1', 'admin');
    });

    test('invite by phone, accept as the invited number, appear in the team', async () => {
      const { inviteId } = await call<{ inviteId: string }>(inviteOrgMember, 'owner1',
        { organizationId: 'o1', phoneNumber: '+919800000011', role: 'recruiter' });
      await expectDomainError(call(inviteOrgMember, 'owner1', { organizationId: 'o1', phoneNumber: '+919800000011', role: 'recruiter' }),
        'APPLICATION_ALREADY_EXISTS');

      // Someone signed in with a different number sees nothing and cannot accept.
      expect((await call<{ invitations: unknown[] }>(listMyInvitations, 'stranger', {}, { phone_number: '+919800000099' })).invitations).toEqual([]);
      await expectDomainError(call(respondToInvitation, 'stranger', { inviteId, accept: true }, { phone_number: '+919800000099' }),
        'RESOURCE_NOT_FOUND');

      const mine = await call<{ invitations: { inviteId: string; organizationName: string; role: string }[] }>(
        listMyInvitations, 'newbie', {}, { phone_number: '+919800000011' });
      expect(mine.invitations).toMatchObject([{ inviteId, organizationName: 'City Care', role: 'recruiter' }]);
      await call(respondToInvitation, 'newbie', { inviteId, accept: true }, { phone_number: '+919800000011' });

      expect((await db().doc('organizations/o1/members/newbie').get()).data()).toMatchObject({ role: 'recruiter', status: 'active' });
      expect((await db().doc('users/newbie').get()).data()?.organizationIds).toEqual(['o1']);
      const team = await call<{ members: { userId: string }[]; canManage: boolean }>(listOrgMembers, 'newbie', { organizationId: 'o1' });
      expect(team.canManage).toBe(false);
      expect(team.members.map(m => m.userId).sort()).toEqual(['admin1', 'newbie', 'owner1']);
    });

    test('only owners invite admins; revoked invitations cannot be accepted', async () => {
      await expectDomainError(call(inviteOrgMember, 'admin1', { organizationId: 'o1', email: 'boss@example.com', role: 'admin' }),
        'PERMISSION_DENIED');
      const { inviteId } = await call<{ inviteId: string }>(inviteOrgMember, 'admin1',
        { organizationId: 'o1', email: 'Ops@Example.com', role: 'operations' });
      await call(revokeOrgInvitation, 'admin1', { inviteId });
      await expectDomainError(call(respondToInvitation, 'x', { inviteId, accept: true }, { email: 'ops@example.com', email_verified: true }),
        'RESOURCE_NOT_FOUND');
    });

    test('ownership continuity: the last owner cannot be demoted or leave; nobody edits their own role', async () => {
      await expectDomainError(call(updateOrgMemberRole, 'owner1', { organizationId: 'o1', userId: 'owner1', role: 'admin' }),
        'PERMISSION_DENIED');
      await expectDomainError(call(removeOrgMember, 'owner1', { organizationId: 'o1', userId: 'owner1' }), 'INVALID_STATE_TRANSITION');
      await expectDomainError(call(updateOrgMemberRole, 'admin1', { organizationId: 'o1', userId: 'owner1', role: 'recruiter' }),
        'PERMISSION_DENIED');

      await call(updateOrgMemberRole, 'owner1', { organizationId: 'o1', userId: 'admin1', role: 'owner' });
      await call(removeOrgMember, 'owner1', { organizationId: 'o1', userId: 'owner1' });
      expect((await db().doc('organizations/o1/members/owner1').get()).data()?.status).toBe('removed');
      const actions = (await db().collection('auditLogs').where('targetId', '==', 'o1').get()).docs.map(d => d.data().action).sort();
      expect(actions).toEqual(['ORG_MEMBER_LEFT', 'ORG_MEMBER_ROLE_CHANGED']);
    });
  });

  describe('privacy and account controls', () => {
    test('export returns the caller\'s own records and is audited', async () => {
      const user = await getAuth().createUser({ phoneNumber: '+919800000021' });
      await db().doc(`doctors/${user.uid}`).set({ fullName: 'Dr. Export', registrationNo: 'R1' });
      await db().doc(`duties/u1/applications/${user.uid}`).set({ doctorId: user.uid, status: 'submitted' });
      await db().doc('duties/u2/applications/someoneElse').set({ doctorId: 'someoneElse', status: 'submitted' });

      const out = await call<{ account: { phoneNumber: string }; doctorProfile: { fullName: string }; applications: { id: string }[] }>(
        exportMyData, user.uid, {});
      expect(out.account.phoneNumber).toBe('+919800000021');
      expect(out.doctorProfile.fullName).toBe('Dr. Export');
      expect(out.applications.map(a => a.id)).toEqual([user.uid]);
      expect((await db().collection('auditLogs').where('action', '==', 'DATA_EXPORTED').get()).size).toBe(1);
    });

    test('a privacy request opens a support case', async () => {
      const { requestId } = await call<{ requestId: string }>(submitPrivacyRequest, 'd1',
        { type: 'correction', details: 'My registration year is wrong on my profile.' });
      expect((await db().doc(`supportCases/${requestId}`).get()).data()).toMatchObject({ category: 'privacy', requesterUid: 'd1', status: 'open' });
    });

    test('deletion needs DELETE and a fresh sign-in, is refused with an active duty, then anonymises and deletes', async () => {
      const user = await getAuth().createUser({ phoneNumber: '+919800000031' });
      const uid = user.uid;
      await db().doc(`doctors/${uid}`).set({ fullName: 'Dr. Leaving', bio: 'Hello', isVerified: true });
      await db().doc(`duties/u1/applications/${uid}`).set({ doctorId: uid, status: 'submitted', version: 1 });
      await db().doc('assignments/a1').set({ doctorId: uid, status: 'confirmed' });
      await db().doc('savedSearches/s1').set({ uid, name: 'x' });

      await expectDomainError(call(deleteMyAccount, uid, { confirm: 'delete' }, fresh()), 'VALIDATION_FAILED');
      await expectDomainError(call(deleteMyAccount, uid, { confirm: 'DELETE' }, { auth_time: now() - 3600 }), 'STEP_UP_REQUIRED');
      await expectDomainError(call(deleteMyAccount, uid, { confirm: 'DELETE' }, fresh()), 'INVALID_STATE_TRANSITION');

      await db().doc('assignments/a1').update({ status: 'completed' });
      await call(deleteMyAccount, uid, { confirm: 'DELETE' }, fresh());

      expect((await db().doc(`doctors/${uid}`).get()).data()).toMatchObject({ fullName: 'Deleted user', bio: '', isVerified: false, deleted: true });
      expect((await db().doc(`duties/u1/applications/${uid}`).get()).data()?.status).toBe('withdrawn');
      expect((await db().doc(`users/${uid}`).get()).data()?.status).toBe('deleted');
      expect((await db().doc('savedSearches/s1').get()).exists).toBe(false);
      await expect(getAuth().getUser(uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
      expect((await db().doc('assignments/a1').get()).exists).toBe(true); // history retained
    });

    test('hospital owners must hand over before deleting', async () => {
      const user = await getAuth().createUser({ phoneNumber: '+919800000041' });
      await db().doc(`users/${user.uid}`).set({ organizationIds: ['o1'] });
      await member('o1', user.uid, 'owner');
      await expectDomainError(call(deleteMyAccount, user.uid, { confirm: 'DELETE' }, fresh()), 'INVALID_STATE_TRANSITION');
    });

    test('devices are listed with the current one marked; sign out everywhere disables all', async () => {
      const user = await getAuth().createUser({ phoneNumber: '+919800000051' });
      const { deviceTokenId } = await import('../src/notifications/deviceTokenFunctions');
      const tokenA = 'a'.repeat(40);
      await db().doc(`deviceTokens/${deviceTokenId(tokenA)}`).set({ uid: user.uid, token: tokenA, platform: 'android', enabled: true });
      await db().doc(`deviceTokens/${deviceTokenId('b'.repeat(40))}`).set({ uid: user.uid, token: 'b'.repeat(40), platform: 'android', enabled: true });

      const { devices } = await call<{ devices: { thisDevice: boolean }[] }>(listMyDevices, user.uid, { currentToken: tokenA });
      expect(devices.filter(d => d.thisDevice)).toHaveLength(1);
      expect(devices).toHaveLength(2);
      await call(signOutEverywhere, user.uid, {});
      expect((await db().collection('deviceTokens').where('enabled', '==', true).get()).size).toBe(0);
    });
  });

  describe('notification preferences', () => {
    test('save and read back; invalid values are refused', async () => {
      await call(updateNotificationPreferences, 'd1', { mutedCategories: ['duty_alerts'], quietHours: { enabled: true, start: '22:00', end: '07:00' } });
      const { preferences } = await call<{ preferences: { mutedCategories: string[] } }>(getNotificationPreferences, 'd1', {});
      expect(preferences.mutedCategories).toEqual(['duty_alerts']);
      await expectDomainError(call(updateNotificationPreferences, 'd1',
        { mutedCategories: ['everything'], quietHours: { enabled: true, start: '25:00', end: '07:00' } }), 'VALIDATION_FAILED');
    });

    test('mutes and quiet hours suppress pushes, never critical ones', () => {
      // 23:00 IST = 17:30 UTC
      const lateNight = Date.UTC(2026, 9, 16, 17, 30);
      const noon = Date.UTC(2026, 9, 16, 6, 30);
      const prefs = { mutedCategories: ['duty_alerts'], quietHours: { enabled: true, start: '22:00', end: '07:00' } };
      expect(inQuietHours(prefs.quietHours, lateNight)).toBe(true);
      expect(inQuietHours(prefs.quietHours, noon)).toBe(false);
      expect(shouldPush('duty.saved_search_match', prefs, noon)).toBe(false); // muted
      expect(shouldPush('verification.updated', prefs, lateNight)).toBe(false); // quiet hours
      expect(shouldPush('verification.updated', prefs, noon)).toBe(true);
      expect(shouldPush('application.selected', prefs, lateNight)).toBe(true); // critical
      expect(categoryOf('duty.updated')).toBe('applications');
    });
  });

  describe('verification appeals', () => {
    const seedRejected = async (decidedMsAgo = 2 * 24 * HOUR) => {
      await db().doc('doctors/d1').set({ fullName: 'Dr. Appeal', verificationCaseId: 'c1', profileRevision: 1 });
      await db().doc('verificationCases/c1').set({
        caseId: 'c1', subjectType: 'doctor', subjectId: 'd1', subjectRevision: 1, status: 'rejected',
        reviewerId: 'verA', decisionReason: 'NAME_MISMATCH: ', decidedAt: ts(Date.now() - decidedMsAgo),
      });
      await db().doc('verificationDocuments/e1').set({
        documentId: 'e1', caseId: 'c1', bucket: 'b', objectKey: 'verification/doctor/d1/c1/x.pdf',
        generation: '1', scannedGeneration: '1', scanStatus: 'clean', sha256: 'h',
      });
    };

    test('appeal once within 30 days; the rejecting verifier cannot decide it; overturning reopens review with the evidence', async () => {
      await seedRejected();
      await expectDomainError(call(submitVerificationAppeal, 'other', { caseId: 'c1', statement: 'x'.repeat(30) }), 'PERMISSION_DENIED');
      await call(submitVerificationAppeal, 'd1', { caseId: 'c1', statement: 'The register shows my name with an initial; same person.' });
      await expectDomainError(call(submitVerificationAppeal, 'd1', { caseId: 'c1', statement: 'Again, please review it.' }),
        'APPLICATION_ALREADY_EXISTS');

      const { appeals } = await call<{ appeals: { caseId: string; canDecide: boolean }[] }>(listVerificationAppeals, 'verA', {}, verifierToken());
      expect(appeals).toMatchObject([{ caseId: 'c1', canDecide: false }]);
      await expectDomainError(call(decideVerificationAppeal, 'verA',
        { caseId: 'c1', outcome: 'overturned', reasonCode: 'NAME_VARIANT_OK' }, verifierToken()), 'PERMISSION_DENIED');

      const r = await call<{ newCaseId: string }>(decideVerificationAppeal, 'verB',
        { caseId: 'c1', outcome: 'overturned', reasonCode: 'NAME_VARIANT_OK' }, verifierToken());
      expect((await db().doc('verificationCases/c1').get()).data()).toMatchObject({ status: 'rejected', appeal: { status: 'overturned', newCaseId: r.newCaseId } });
      expect((await db().doc(`verificationCases/${r.newCaseId}`).get()).data()).toMatchObject({ status: 'submitted', appealOf: 'c1', subjectId: 'd1' });
      expect((await db().doc('doctors/d1').get()).data()?.verificationCaseId).toBe(r.newCaseId);
      const carried = await db().collection('verificationDocuments').where('caseId', '==', r.newCaseId).get();
      expect(carried.docs.map(d => d.data())).toMatchObject([{ scanStatus: 'clean', copiedFromDocumentId: 'e1', objectKey: 'verification/doctor/d1/c1/x.pdf' }]);
    });

    test('an overturn supersedes the untouched draft the app opened after the rejection, but not a submitted case', async () => {
      await seedRejected();
      await db().doc('verificationCases/c2').set({ caseId: 'c2', subjectType: 'doctor', subjectId: 'd1', status: 'draft', previousCaseId: 'c1', subjectRevision: 1 });
      await db().doc('doctors/d1').update({ verificationCaseId: 'c2' });
      await call(submitVerificationAppeal, 'd1', { caseId: 'c1', statement: 'The register shows my name with an initial.' });
      const r = await call<{ newCaseId: string }>(decideVerificationAppeal, 'verB',
        { caseId: 'c1', outcome: 'overturned', reasonCode: 'NAME_VARIANT_OK' }, verifierToken());
      expect((await db().doc('verificationCases/c2').get()).data()?.status).toBe('superseded');
      expect((await db().doc('doctors/d1').get()).data()?.verificationCaseId).toBe(r.newCaseId);

      await seedRejected();
      await db().doc('verificationCases/c3').set({ caseId: 'c3', subjectType: 'doctor', subjectId: 'd1', status: 'submitted', previousCaseId: 'c1' });
      await db().doc('doctors/d1').update({ verificationCaseId: 'c3' });
      await call(submitVerificationAppeal, 'd1', { caseId: 'c1', statement: 'The register shows my name with an initial.' });
      await expectDomainError(call(decideVerificationAppeal, 'verB',
        { caseId: 'c1', outcome: 'overturned', reasonCode: 'NAME_VARIANT_OK' }, verifierToken()), 'INVALID_STATE_TRANSITION');
    });

    test('appeals close after 30 days; upheld appeals change nothing else', async () => {
      await seedRejected(31 * 24 * HOUR);
      await expectDomainError(call(submitVerificationAppeal, 'd1', { caseId: 'c1', statement: 'Please look again at it.' }),
        'INVALID_STATE_TRANSITION');
      await db().doc('verificationCases/c1').update({ decidedAt: ts(Date.now()) });
      await call(submitVerificationAppeal, 'd1', { caseId: 'c1', statement: 'Please look again at it.' });
      await call(decideVerificationAppeal, 'verB', { caseId: 'c1', outcome: 'upheld', reasonCode: 'NO_NEW_EVIDENCE' }, verifierToken());
      expect((await db().doc('doctors/d1').get()).data()?.verificationCaseId).toBe('c1');
    });
  });

  describe('duty edits', () => {
    beforeEach(async () => {
      await member('o1', 'rec', 'recruiter');
      await consented('rec');
      await db().doc('duties/u1').set({
        organizationId: 'o1', status: 'published', version: 3, specialtyName: 'Cardiology', facilityName: 'Main',
        headcount: 2, remainingHeadcount: 1, schedule: { startAt: isoIn(48 * HOUR), endAt: isoIn(56 * HOUR), shiftType: 'night' },
        paymentTerms: { amount: 5000, currency: 'INR', basis: 'per_shift', expectedPaymentTiming: 'end_of_shift' },
      });
      await db().doc('duties/u1/applications/docA').set({ doctorId: 'docA', status: 'submitted' });
      await db().doc('duties/u1/applications/docB').set({ doctorId: 'docB', status: 'rejected' });
    });
    const pay = (amount: number) => ({ amount, currency: 'INR', basis: 'per_shift', expectedPaymentTiming: 'end_of_shift' });

    test('a material edit is versioned and notifies open applicants only', async () => {
      await expectDomainError(call(updateDuty, 'rec', { dutyId: 'u1', expectedVersion: 2, changes: { paymentTerms: pay(6000) } }),
        'CONCURRENT_UPDATE');
      const r = await call<{ version: number; applicantsNotified: number }>(updateDuty, 'rec',
        { dutyId: 'u1', expectedVersion: 3, changes: { paymentTerms: pay(6000), notes: 'Parking available' } });
      expect(r).toMatchObject({ version: 4, applicantsNotified: 1 });
      expect((await db().doc('duties/u1/versions/4').get()).data()).toMatchObject({
        changedFields: ['paymentTerms', 'notes'], materialFields: ['paymentTerms'], before: { paymentTerms: { amount: 5000 } },
      });
      const outbox = await db().collection('notificationOutbox').where('eventType', '==', 'duty.updated').get();
      expect(outbox.docs.map(d => d.data().targetUserId)).toEqual(['docA']);
    });

    test('pay and schedule lock once a doctor holds a seat; headcount cannot drop below filled seats', async () => {
      await db().doc('assignments/a1').set({ dutyId: 'u1', status: 'confirmed' });
      await expectDomainError(call(updateDuty, 'rec', { dutyId: 'u1', expectedVersion: 3, changes: { paymentTerms: pay(9000) } }),
        'INVALID_STATE_TRANSITION');
      await expectDomainError(call(updateDuty, 'rec', { dutyId: 'u1', expectedVersion: 3, changes: { headcount: 1 } }), 'VALIDATION_FAILED');
      const r = await call<{ version: number }>(updateDuty, 'rec', { dutyId: 'u1', expectedVersion: 3, changes: { headcount: 3 } });
      expect(r.version).toBe(4);
      expect((await db().doc('duties/u1').get()).data()).toMatchObject({ headcount: 3, remainingHeadcount: 2 });
    });
  });

  describe('saved searches', () => {
    test('save, list, limit, toggle and delete', async () => {
      const { searchId } = await call<{ searchId: string }>(saveSearch, 'd1', { name: 'Night cardio', specialtyName: 'Cardiology', city: 'Chennai', minPay: 4000 });
      for (let i = 0; i < 9; i += 1) await call(saveSearch, 'd1', { name: `Any ${i}` });
      await expectDomainError(call(saveSearch, 'd1', { name: 'Eleventh' }), 'VALIDATION_FAILED');
      await call(updateSavedSearch, 'd1', { searchId, alertsEnabled: false });
      await expectDomainError(call(updateSavedSearch, 'intruder', { searchId, delete: true }), 'RESOURCE_NOT_FOUND');
      await call(updateSavedSearch, 'd1', { searchId, delete: true });
      expect((await call<{ searches: unknown[] }>(listSavedSearches, 'd1', {})).searches).toHaveLength(9);
    });

    test('alerts match specialty, city and pay, and skip the posting hospital\'s own members', async () => {
      await member('o1', 'insider', 'recruiter');
      await call(saveSearch, 'match', { name: 'Cardio Chennai', specialtyName: 'cardiology', city: 'chennai' });
      await call(saveSearch, 'any', { name: 'Anything' });
      await call(saveSearch, 'tooPricey', { name: 'High pay', specialtyName: 'Cardiology', minPay: 9000 });
      await call(saveSearch, 'otherCity', { name: 'Madurai', specialtyName: 'Cardiology', city: 'Madurai' });
      await call(saveSearch, 'insider', { name: 'Own', specialtyName: 'Cardiology' });
      const muted = await call<{ searchId: string }>(saveSearch, 'muted', { name: 'Off', specialtyName: 'Cardiology' });
      await call(updateSavedSearch, 'muted', { searchId: muted.searchId, alertsEnabled: false });

      const uids = await matchingSearchers({ organizationId: 'o1', specialtyName: 'Cardiology', city: 'Chennai', paymentTerms: { amount: 5000 } });
      expect(uids.sort()).toEqual(['any', 'match']);
    });
  });

  describe('app release config and backups', () => {
    test('super admins set minimum version and maintenance mode in the public appVersions doc', async () => {
      const value = { minimumVersion: { android: '1.2.0', ios: '1.0.0' }, latestVersion: '1.3.0',
        updateUrl: 'https://play.google.com/store/apps/details?id=com.geerthan.healthcareworkforce',
        maintenance: { enabled: true, message: 'Back at 6 am' } };
      await call(updatePlatformConfig, 's1', { configKey: 'app_release', configValue: value }, superToken());
      expect((await db().doc('appVersions/current').get()).data()).toMatchObject({ ...value, version: 1 });
      await expectDomainError(call(updatePlatformConfig, 's1',
        { configKey: 'app_release', configValue: { ...value, latestVersion: 'v1' } }, superToken()), 'VALIDATION_FAILED');
    });

    test('daily exports are written under a dated prefix', () => {
      expect(exportOutputPrefix('gs://hf-backups', new Date('2026-10-16T21:00:00Z'))).toBe('gs://hf-backups/firestore/2026-10-16');
    });
  });
});
