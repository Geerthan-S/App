/**
 * Chat, the client-review demo workspace and testing-mode approvals, against
 * the Auth and Firestore emulators. Run with: npm run test:emulator
 */
import {
  CONSENT, HOUR, MFA, adminDb, call, clearFirestore, describeWithEmulator, expectDomainError, isoIn, verifierToken,
} from './helpers/emulator';
import { markConversationRead, sendChatMessage, startConversation } from '../src/chat/chatFunctions';
import {
  clearDemoWorkspace, ensureDemoContent, getDemoWorkspaceStatus, seedDemoWorkspace,
} from '../src/demo/demoFunctions';
import { DEMO_DOCTORS, DEMO_DUTIES, DEMO_ORGS, demoScheduleOf } from '../src/demo/demoData';
import { recordVerificationDecision } from '../src/verification/verificationFunctions';
import { getHospitalProfile } from '../src/hospitals/hospitalFunctions';

jest.setTimeout(90_000);

const now = () => Math.floor(Date.now() / 1000);
const superToken = () => ({ isSuperAdmin: true, auth_time: now(), ...MFA });
const db = () => adminDb();
const consented = (...uids: string[]) => Promise.all(uids.map(uid => db().doc(`users/${uid}`).set(CONSENT, { merge: true })));

describeWithEmulator('chat, demo workspace and testing-mode approvals', () => {
  beforeAll(() => { adminDb(); });
  beforeEach(async () => {
    await clearFirestore();
    delete process.env.REQUIRE_VERIFICATION_EVIDENCE;
  });

  describe('chat', () => {
    beforeEach(async () => {
      await db().doc('organizations/o1').set({ displayName: 'City Care', verificationState: 'approved' });
      await db().doc('organizations/o1/members/staff1').set({ userId: 'staff1', role: 'recruiter', status: 'active' });
      await db().doc('organizations/o1/members/ops1').set({ userId: 'ops1', role: 'operations', status: 'active' });
      await db().doc('doctors/doc1').set({ fullName: 'Asha Rao' });
      await db().doc('duties/d1').set({ organizationId: 'o1', status: 'published', specialtyName: 'Emergency Medicine', department: 'Casualty' });
      await consented('doc1', 'staff1', 'ops1', 'stranger');
    });

    test('a doctor can open a thread only after applying', async () => {
      await expectDomainError(call(startConversation, 'doc1', { dutyId: 'd1' }), 'PERMISSION_DENIED');
      await db().doc('duties/d1/applications/doc1').set({ doctorId: 'doc1', status: 'submitted' });
      const { conversationId } = await call<{ conversationId: string }>(startConversation, 'doc1', { dutyId: 'd1' });
      expect(conversationId).toBe('o1__doc1');
      const thread = (await db().doc(`conversations/${conversationId}`).get()).data();
      expect(thread).toMatchObject({ doctorName: 'Dr. Asha Rao', organizationName: 'City Care', dutyTitle: 'Emergency Medicine · Casualty' });
      // Opening it again reuses the same thread.
      expect((await call<{ conversationId: string }>(startConversation, 'doc1', { dutyId: 'd1' })).conversationId).toBe(conversationId);
    });

    test('messages update unread counts both ways and notify the other side', async () => {
      await db().doc('duties/d1/applications/doc1').set({ doctorId: 'doc1', status: 'submitted' });
      // Operations staff cannot start threads with applicants; recruiters can.
      await expectDomainError(call(startConversation, 'ops1', { dutyId: 'd1', doctorId: 'doc1' }), 'PERMISSION_DENIED');
      const { conversationId } = await call<{ conversationId: string }>(startConversation, 'staff1', { dutyId: 'd1', doctorId: 'doc1' });

      await call(sendChatMessage, 'staff1', { conversationId, text: 'Can you start at 8?' });
      await call(sendChatMessage, 'staff1', { conversationId, text: 'Parking is behind the main block.' });
      let thread = (await db().doc(`conversations/${conversationId}`).get()).data()!;
      expect(thread.unread).toEqual({ doctor: 2, organization: 0 });
      expect(thread.lastMessage).toMatchObject({ senderSide: 'organization', senderName: 'City Care' });

      await call(sendChatMessage, 'doc1', { conversationId, text: 'Yes, see you then.' });
      thread = (await db().doc(`conversations/${conversationId}`).get()).data()!;
      expect(thread.unread).toEqual({ doctor: 0, organization: 1 });
      await call(markConversationRead, 'ops1', { conversationId });
      expect((await db().doc(`conversations/${conversationId}`).get()).data()!.unread.organization).toBe(0);

      const messages = await db().collection(`conversations/${conversationId}/messages`).orderBy('createdAt').get();
      expect(messages.docs.map(d => d.data().senderSide)).toEqual(['organization', 'organization', 'doctor']);
      const outbox = await db().collection('notificationOutbox').where('eventType', '==', 'chat.message').get();
      expect(outbox.size).toBe(3);
      expect(outbox.docs.some(d => d.data().targetOrganizationId === 'o1')).toBe(true);
    });

    test('outsiders cannot read receipts or send, and empty messages are refused', async () => {
      await db().doc('duties/d1/applications/doc1').set({ doctorId: 'doc1', status: 'submitted' });
      const { conversationId } = await call<{ conversationId: string }>(startConversation, 'doc1', { dutyId: 'd1' });
      await expectDomainError(call(sendChatMessage, 'stranger', { conversationId, text: 'hi' }), 'PERMISSION_DENIED');
      await expectDomainError(call(markConversationRead, 'stranger', { conversationId }), 'PERMISSION_DENIED');
      await expectDomainError(call(sendChatMessage, 'doc1', { conversationId, text: '   ' }), 'VALIDATION_FAILED');
    });
  });

  describe('demo workspace', () => {
    test('is off until a super admin seeds it', async () => {
      await consented('newdoc');
      expect(await call(ensureDemoContent, 'newdoc', {})).toEqual({ enabled: false });
      await expectDomainError(call(seedDemoWorkspace, 'verifier1', {}, verifierToken()), 'PERMISSION_DENIED');
    });

    test('a new doctor gets four threads, an offer, a completed duty and inbox items, once', async () => {
      const seeded = await call<Record<string, number>>(seedDemoWorkspace, 'super1', {}, superToken());
      expect(seeded).toMatchObject({ hospitals: 4, doctors: 4, duties: DEMO_DUTIES.length });
      const open = await db().collection('duties').where('isDemo', '==', true).where('status', '==', 'published').get();
      expect(open.size).toBe(DEMO_DUTIES.length);
      expect(open.docs.every(d => Date.parse(d.data().schedule.startAt) > Date.now())).toBe(true);

      await db().doc('users/newdoc').set({ ...CONSENT, displayName: 'Meera' });
      await call(ensureDemoContent, 'newdoc', {});
      const threads = await db().collection('conversations').where('doctorId', '==', 'newdoc').get();
      expect(threads.size).toBe(4);
      expect(threads.docs.every(t => t.data().isDemo === true && t.data().doctorName === 'Meera')).toBe(true);
      expect((await db().collection('conversations/demo_org_meridian__newdoc/messages').get()).size).toBe(4);

      const assignments = await db().collection('assignments').where('doctorId', '==', 'newdoc').get();
      expect(assignments.docs.map(a => a.data().status).sort()).toEqual(['completed', 'selected']);
      expect((await db().collection('inboxNotifications').where('userId', '==', 'newdoc').get()).size).toBe(4);
      expect((await db().collection('feedback').where('targetId', '==', 'newdoc').get()).size).toBe(1);

      // A second call adds nothing.
      await call(ensureDemoContent, 'newdoc', {});
      expect((await db().collection('conversations').where('doctorId', '==', 'newdoc').get()).size).toBe(4);
    });

    test('a sample thread replies automatically and sends no push', async () => {
      await call(seedDemoWorkspace, 'super1', {}, superToken());
      await consented('newdoc');
      await call(ensureDemoContent, 'newdoc', {});
      const conversationId = 'demo_org_lakeview__newdoc';
      await call(sendChatMessage, 'newdoc', { conversationId, text: 'Is there a canteen?' });
      const messages = await db().collection(`conversations/${conversationId}/messages`).orderBy('createdAt').get();
      const last2 = messages.docs.slice(-2).map(d => d.data());
      expect(last2[0]).toMatchObject({ senderSide: 'doctor', text: 'Is there a canteen?' });
      expect(last2[1]).toMatchObject({ senderSide: 'organization', senderId: 'demo_org_lakeview', isDemo: true });
      expect((await db().collection('notificationOutbox').get()).size).toBe(0);
    });

    test('a hospital gets sample threads at once and sample applicants once approved', async () => {
      await call(seedDemoWorkspace, 'super1', {}, superToken());
      await db().doc('organizations/o1').set({ displayName: 'City Care', verificationState: 'submitted', city: 'Chennai' });
      await db().doc('organizations/o1/members/owner1').set({ userId: 'owner1', role: 'owner', status: 'active' });
      await db().doc('users/owner1').set({ ...CONSENT, organizationIds: ['o1'] });

      await call(ensureDemoContent, 'owner1', {});
      expect((await db().collection('conversations').where('organizationId', '==', 'o1').get()).size).toBe(4);
      expect((await db().collection('duties').where('organizationId', '==', 'o1').get()).size).toBe(0);

      await db().doc('organizations/o1').update({ verificationState: 'approved' });
      await call(ensureDemoContent, 'owner1', {});
      const duties = await db().collection('duties').where('organizationId', '==', 'o1').get();
      expect(duties.docs.map(d => d.data().status).sort()).toEqual(['draft', 'published']);
      const applicants = await db().collection('duties/demo_duty_o1_open/applications').get();
      expect(applicants.size).toBe(3);
      expect((await db().collection('conversations').where('organizationId', '==', 'o1').get()).size).toBe(4);
    });

    test('clearing removes every sample record and allows a fresh seed later', async () => {
      await call(seedDemoWorkspace, 'super1', {}, superToken());
      await db().doc('organizations/o1').set({ displayName: 'City Care', verificationState: 'approved' });
      await db().doc('organizations/o1/members/owner1').set({ userId: 'owner1', role: 'owner', status: 'active' });
      await db().doc('users/owner1').set({ ...CONSENT, organizationIds: ['o1'] });
      await call(ensureDemoContent, 'owner1', {});
      // A selection the hospital made of a sample doctor during the review.
      await db().doc('assignments/a1').set({ doctorId: DEMO_DOCTORS[0].id, organizationId: 'o1', status: 'selected' });

      await expectDomainError(call(clearDemoWorkspace, 'super1', {}, { isSuperAdmin: true, auth_time: now() - 3600, ...MFA }), 'STEP_UP_REQUIRED');
      await call(clearDemoWorkspace, 'super1', {}, superToken());

      const status = await call<{ enabled: boolean; counts: Record<string, number> }>(getDemoWorkspaceStatus, 'super1', {}, superToken());
      expect(status.enabled).toBe(false);
      expect(Object.values(status.counts).every(n => n === 0)).toBe(true);
      expect((await db().doc('assignments/a1').get()).exists).toBe(false);
      expect((await db().collectionGroup('applications').get()).size).toBe(0);
      expect((await db().collectionGroup('messages').get()).size).toBe(0);
      expect((await db().doc('organizations/o1').get()).data()).not.toHaveProperty('demoSeededAt');
      expect((await db().doc('organizations/o1').get()).exists).toBe(true);
    });

    test('sample schedules land at the stated IST hour, in the future', () => {
      const nowMs = Date.parse('2026-10-20T22:00:00Z'); // 03:30 IST on the 21st
      const { startAt, endAt } = demoScheduleOf({ dayOffset: 1, startHourIst: 20, hours: 12 }, nowMs);
      expect(startAt).toBe('2026-10-22T14:30:00.000Z'); // 20:00 IST on the 22nd
      expect(Date.parse(endAt) - Date.parse(startAt)).toBe(12 * HOUR);
      expect(DEMO_ORGS.every(o => o.registrationNumber.startsWith('DEMO-'))).toBe(true);
    });
  });

  describe('public hospital profile', () => {
    test('doctors see approved hospitals with reviewers shown by initials only', async () => {
      await db().doc('organizations/o1').set({ displayName: 'City Care', verificationState: 'approved', city: 'Chennai', createdBy: 'owner1' });
      await db().doc('organizations/o1/facilities/f1').set({ name: 'Main campus', city: 'Chennai' });
      await db().doc('feedback/r1').set({
        targetId: 'o1', targetType: 'organization', authorId: 'docX', reviewerName: 'Dr. Priya Nair', rating: 4, comment: 'Good', createdAt: new Date(),
      });
      await db().doc('organizations/o2').set({ displayName: 'Draft Hospital', verificationState: 'draft' });

      const profile = await call<Record<string, any>>(getHospitalProfile, 'doc1', { organizationId: 'o1' });
      expect(profile).toMatchObject({ displayName: 'City Care', verified: true, facilities: [{ name: 'Main campus' }] });
      expect(profile.reviews).toEqual([expect.objectContaining({ rating: 4, reviewer: 'Dr. P. N.' })]);
      expect(JSON.stringify(profile)).not.toMatch(/docX|owner1|Priya/);
      await expectDomainError(call(getHospitalProfile, 'doc1', { organizationId: 'o2' }), 'RESOURCE_NOT_FOUND');
    });
  });

  describe('testing-mode approvals', () => {
    const review = (url = 'https://clinicalestablishments.gov.in/search') => ({
      sourceUrl: url, checkedAt: new Date(Date.now() - 60_000).toISOString(),
      registrationNumberMatched: true, nameMatched: true, councilMatched: true, qualificationMatched: true, officialStatus: 'ACTIVE',
    });
    beforeEach(async () => {
      await db().doc('organizations/o1').set({ legalName: 'City Care', verificationState: 'submitted', verificationCaseId: 'c1' });
      await db().doc('verificationCases/c1').set({ caseId: 'c1', subjectType: 'organization', subjectId: 'o1', status: 'submitted', subjectRevision: 1 });
    });

    test('by default an approval without scanned documents is refused', async () => {
      await expectDomainError(call(recordVerificationDecision, 'verifier1',
        { caseId: 'c1', decision: 'approved', reasonCode: 'REGISTRY_MATCH', review: review() }, verifierToken()), 'INVALID_STATE_TRANSITION');
    });

    test('in testing mode the registry check alone approves, and the policy is recorded', async () => {
      process.env.REQUIRE_VERIFICATION_EVIDENCE = 'false';
      // No saved registry list: the national registers are trusted by default.
      await expectDomainError(call(recordVerificationDecision, 'verifier1',
        { caseId: 'c1', decision: 'approved', reasonCode: 'REGISTRY_MATCH', review: review('https://example.com/x') }, verifierToken()),
        'INVALID_STATE_TRANSITION');
      await call(recordVerificationDecision, 'verifier1',
        { caseId: 'c1', decision: 'approved', reasonCode: 'REGISTRY_MATCH', review: review() }, verifierToken());
      expect((await db().doc('organizations/o1').get()).data()?.verificationState).toBe('approved');
      const check = (await db().collection('verificationChecks').where('caseId', '==', 'c1').get()).docs[0].data();
      expect(check.evidencePolicy).toBe('TESTING_MODE_EVIDENCE_OPTIONAL');
    });
  });
});

// Keep the helper import used even when only the pure test runs.
void isoIn;
