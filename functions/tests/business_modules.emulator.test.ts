/**
 * QR attendance, payments, premium early access, the last-minute service,
 * community channels and the AI assistant, against the Firestore emulator.
 * Run with: npm run test:emulator
 */
import {
  CONSENT, HOUR, MFA, adminDb, call, clearFirestore, describeWithEmulator, expectDomainError, isoIn,
} from './helpers/emulator';
import { acknowledgeAttendance, issueAttendanceCode, scanAttendanceCode } from '../src/attendance/attendanceFunctions';
import { listPaymentOrders, recordPaymentAction, syncDutyBookingOrder } from '../src/payments/paymentFunctions';
import { getBusinessFeatures, grantSubscription, releaseEarlyAccessDuties, requestSubscription } from '../src/subscriptions/subscriptionFunctions';
import {
  acceptLastMinuteDuty, closeSearch, requestLastMinuteConfirmation, setStandbyAvailability,
} from '../src/lastMinute/lastMinuteFunctions';
import { indiaDateOf } from '../src/lastMinute/lastMinuteCore';
import {
  createChannel, joinChannel, joinChannelByCode, listRecommendedChannels, removeChannelMember, reportChannelMessage, sendChannelMessage,
} from '../src/channels/channelFunctions';
import { askAssistant, setOpenAiTransportForTests } from '../src/ai/aiFunctions';
import { publishDuty } from '../src/duties/dutyFunctions';
import { applyToDuty } from '../src/applications/applicationFunctions';
import { completeAssignment } from '../src/assignments/assignmentFunctions';

jest.setTimeout(90_000);

const db = () => adminDb();
const now = () => Math.floor(Date.now() / 1000);
const staffToken = () => ({ isSupportAdmin: true, auth_time: now(), ...MFA });
const consented = (...uids: string[]) => Promise.all(uids.map(uid => db().doc(`users/${uid}`).set(CONSENT, { merge: true })));
const flag = (key: string, enabled = true) => db().doc(`featureFlags/${key}`).set({ enabled });
const runTrigger = (fn: unknown, event: unknown) => (fn as { run: (e: unknown) => Promise<unknown> }).run(event);
const changeEvent = (assignmentId: string, before: Record<string, unknown>, after: Record<string, unknown>) => ({
  params: { assignmentId },
  data: { before: { data: () => before }, after: { data: () => after } },
});

const HOSPITAL = { latitude: 13.0604, longitude: 80.2496 };

const seedHospital = async () => {
  await db().doc('organizations/o1').set({ displayName: 'City Care', verificationState: 'approved' });
  await db().doc('organizations/o1/members/staff1').set({ userId: 'staff1', role: 'owner', status: 'active' });
  await db().doc('organizations/o1/facilities/f1').set({ name: 'Main', geo: HOSPITAL });
};

const seedDoctor = (uid: string, extra: Record<string, unknown> = {}) =>
  db().doc(`doctors/${uid}`).set({
    fullName: `Doctor ${uid}`, isVerified: true, specialties: ['Emergency Medicine'], primarySpecialty: 'Emergency Medicine',
    council: 'Tamil Nadu Medical Council', registrationNo: `TN${uid}`, registrationNoNorm: `TN_${uid}`, qualification: 'MBBS',
    yearsOfExperience: 5, ...extra,
  });

const seedAssignment = (id: string, status: string, startOffsetMs: number, durationMs = 8 * HOUR) =>
  db().doc(`assignments/${id}`).set({
    assignmentId: id, dutyId: 'd1', doctorId: 'doc1', doctorName: 'Dr. One', organizationId: 'o1', facilityId: 'f1',
    facilityName: 'Main', specialtyName: 'Emergency Medicine', status, version: 1,
    termsSnapshot: { amount: 5000, currency: 'INR', basis: 'per_shift', startAt: isoIn(startOffsetMs), endAt: isoIn(startOffsetMs + durationMs) },
  });

describeWithEmulator('business modules', () => {
  beforeAll(() => { adminDb(); });
  beforeEach(async () => {
    await clearFirestore();
    await seedHospital();
    await consented('staff1', 'doc1', 'doc2', 'doc3');
  });

  describe('QR attendance', () => {
    beforeEach(async () => { await seedDoctor('doc1'); });

    test('on-time, on-site check-in starts the shift; the code is single use', async () => {
      await seedAssignment('a1', 'confirmed', 10 * 60000);
      const issued = await call<{ code: string }>(issueAttendanceCode, 'staff1', { assignmentId: 'a1', kind: 'check_in' });
      expect(issued.code).toMatch(/^HFATT1:/);

      const scan = await call<{ discrepancies: string[]; withinRadius: boolean }>(scanAttendanceCode, 'doc1', {
        code: issued.code, location: { latitude: 13.0606, longitude: 80.2497, accuracyMeters: 12 },
      });
      expect(scan).toMatchObject({ withinRadius: true, discrepancies: [] });
      expect((await db().doc('assignments/a1').get()).data()!.status).toBe('in_progress');
      const attendance = (await db().doc('attendance/a1').get()).data()!;
      expect(attendance.needsAcknowledgement).toBe(false);
      expect(attendance.checkIn.distanceMeters).toBeLessThan(50);

      await expectDomainError(call(scanAttendanceCode, 'doc1', { code: issued.code, location: HOSPITAL }), 'ATTENDANCE_CODE_INVALID');
    });

    test('a different doctor, a stranger or a forged code are refused', async () => {
      await seedAssignment('a1', 'confirmed', 10 * 60000);
      await expectDomainError(call(issueAttendanceCode, 'stranger', { assignmentId: 'a1', kind: 'check_in' }), 'PERMISSION_DENIED');
      const issued = await call<{ code: string }>(issueAttendanceCode, 'staff1', { assignmentId: 'a1', kind: 'check_in' });
      await expectDomainError(call(scanAttendanceCode, 'doc2', { code: issued.code, location: HOSPITAL }), 'PERMISSION_DENIED');
      await expectDomainError(call(scanAttendanceCode, 'doc1', { code: 'HFATT1:nottherightcodeatall123', location: HOSPITAL }), 'ATTENDANCE_CODE_INVALID');
    });

    test('check-in opens only shortly before the shift', async () => {
      await seedAssignment('a1', 'confirmed', 10 * HOUR);
      await expectDomainError(call(issueAttendanceCode, 'staff1', { assignmentId: 'a1', kind: 'check_in' }), 'INVALID_STATE_TRANSITION');
    });

    test('late, distant check-in and early check-out are recorded and need acknowledgement', async () => {
      await seedAssignment('a1', 'confirmed', -40 * 60000);
      const inCode = await call<{ code: string }>(issueAttendanceCode, 'staff1', { assignmentId: 'a1', kind: 'check_in' });
      const scan = await call<{ discrepancies: string[] }>(scanAttendanceCode, 'doc1', {
        code: inCode.code, location: { latitude: 13.08, longitude: 80.2496 },
      });
      expect(scan.discrepancies).toEqual(['LATE_CHECK_IN', 'OUTSIDE_RADIUS']);
      let attendance = (await db().doc('attendance/a1').get()).data()!;
      expect(attendance.needsAcknowledgement).toBe(true);
      expect(attendance.pendingDiscrepancies).toHaveLength(2);
      const alert = await db().collection('notificationOutbox').where('eventType', '==', 'attendance.flagged').get();
      expect(alert.docs[0].data().targetOrganizationId).toBe('o1');

      await expectDomainError(call(acknowledgeAttendance, 'doc1', { assignmentId: 'a1' }), 'PERMISSION_DENIED');
      await call(acknowledgeAttendance, 'staff1', { assignmentId: 'a1', note: 'Traffic on OMR' });
      attendance = (await db().doc('attendance/a1').get()).data()!;
      expect(attendance).toMatchObject({ needsAcknowledgement: false, pendingDiscrepancies: [] });
      expect(attendance.acknowledgements[0].note).toBe('Traffic on OMR');

      const outCode = await call<{ code: string }>(issueAttendanceCode, 'staff1', { assignmentId: 'a1', kind: 'check_out' });
      const out = await call<{ discrepancies: string[] }>(scanAttendanceCode, 'doc1', { code: outCode.code, location: HOSPITAL });
      expect(out.discrepancies).toEqual(['EARLY_CHECK_OUT']);
      await expectDomainError(call(issueAttendanceCode, 'staff1', { assignmentId: 'a1', kind: 'check_out' }), 'INVALID_STATE_TRANSITION');
    });

    test('check-out needs a check-in first', async () => {
      await seedAssignment('a1', 'confirmed', 5 * 60000);
      await expectDomainError(call(issueAttendanceCode, 'staff1', { assignmentId: 'a1', kind: 'check_out' }), 'INVALID_STATE_TRANSITION');
    });
  });

  describe('payments', () => {
    test('duty booking: order on confirmation, payout after completion', async () => {
      await flag('payments_enabled');
      await db().doc('configuration/payment_policy').set({ platformFeeInr: 100, gstRatePercent: 18, manualInstructions: 'UPI: healthforce@bank' });
      const after = { status: 'confirmed', organizationId: 'o1', doctorId: 'doc1', dutyId: 'd1', termsSnapshot: { amount: 5000 }, specialtyName: 'EM', facilityName: 'Main' };
      await runTrigger(syncDutyBookingOrder, changeEvent('a1', { ...after, status: 'selected' }, after));
      const order = (await db().doc('paymentOrders/duty_a1').get()).data()!;
      expect(order).toMatchObject({ status: 'awaiting_payment', totalPaise: 511800, provider: 'manual', instructions: 'UPI: healthforce@bank' });

      await expectDomainError(call(recordPaymentAction, 'staff1', { orderId: 'duty_a1', action: 'payment_received', reference: 'UPI123' }), 'PERMISSION_DENIED');
      await call(recordPaymentAction, 'admin1', { orderId: 'duty_a1', action: 'payment_received', reference: 'UPI123' }, staffToken());
      await runTrigger(syncDutyBookingOrder, changeEvent('a1', after, { ...after, status: 'completed' }));
      expect((await db().doc('paymentOrders/duty_a1').get()).data()!.status).toBe('payout_due');
      await call(recordPaymentAction, 'admin1', { orderId: 'duty_a1', action: 'payout_sent', reference: 'NEFT9' }, staffToken());
      const done = (await db().doc('paymentOrders/duty_a1').get()).data()!;
      expect(done.status).toBe('paid_out');
      expect(done.payout.amountPaise).toBe(500000);

      const ledger = await db().collection('ledgerEntries').where('orderId', '==', 'duty_a1').get();
      expect(ledger.docs.map(d => d.data().kind).sort()).toEqual(['order_created', 'payment_received', 'payout_due', 'payout_sent']);
      const list = await call<{ totals: { platformRevenuePaise: number } }>(listPaymentOrders, 'admin1', {}, staffToken());
      expect(list.totals.platformRevenuePaise).toBe(10000);
    });

    test('no order is created while payments are off; a cancelled paid booking is refunded', async () => {
      const after = { status: 'confirmed', organizationId: 'o1', doctorId: 'doc1', dutyId: 'd1', termsSnapshot: { amount: 5000 } };
      await runTrigger(syncDutyBookingOrder, changeEvent('a2', { ...after, status: 'selected' }, after));
      expect((await db().doc('paymentOrders/duty_a2').get()).exists).toBe(false);

      await flag('payments_enabled');
      await runTrigger(syncDutyBookingOrder, changeEvent('a2', { ...after, status: 'selected' }, after));
      await call(recordPaymentAction, 'admin1', { orderId: 'duty_a2', action: 'payment_received', reference: 'UPI1' }, staffToken());
      await runTrigger(syncDutyBookingOrder, changeEvent('a2', after, { ...after, status: 'cancelled' }));
      expect((await db().doc('paymentOrders/duty_a2').get()).data()!.status).toBe('refund_due');
      await call(recordPaymentAction, 'admin1', { orderId: 'duty_a2', action: 'refund_sent', reference: 'RF1' }, staffToken());
      expect((await db().doc('paymentOrders/duty_a2').get()).data()!.refund.amountPaise).toBe(501180);
    });
  });

  describe('premium plans and early access', () => {
    beforeEach(async () => {
      await seedDoctor('doc1');
      await seedDoctor('doc2');
    });

    test('a paid plan activates premium when staff record the payment', async () => {
      await expectDomainError(call(requestSubscription, 'doc1', { planId: 'premium_6m' }), 'FEATURE_DISABLED');
      await flag('premium_enabled');
      const req = await call<{ orderId: string; status: string; breakdown: { totalPaise: number } }>(requestSubscription, 'doc1', { planId: 'premium_6m' });
      expect(req).toMatchObject({ status: 'awaiting_payment', breakdown: { totalPaise: 118000 } });
      await call(recordPaymentAction, 'admin1', { orderId: req.orderId, action: 'payment_received', reference: 'UPI42' }, staffToken());
      const sub = (await db().doc('subscriptions/doc1').get()).data()!;
      expect(new Date(sub.premiumUntil).getTime()).toBeGreaterThan(Date.now() + 170 * 24 * HOUR);
      expect(sub.premiumUntilMs).toBe(new Date(sub.premiumUntil).getTime());
    });

    test('new duties open to premium doctors first, then to everyone', async () => {
      await flag('premium_enabled');
      await call(grantSubscription, 'admin1', { uid: 'doc1', kind: 'premium', months: 6, reason: 'Pilot partner' }, staffToken());
      await db().doc('duties/d1').set({
        organizationId: 'o1', status: 'draft', version: 1, remainingHeadcount: 1, headcount: 1, specialtyName: 'Emergency Medicine',
        facilityName: 'Main', schedule: { startAt: isoIn(24 * HOUR), endAt: isoIn(32 * HOUR) },
      });
      const published = await call<{ status: string }>(publishDuty, 'staff1', { dutyId: 'd1' });
      expect(published.status).toBe('early_access');
      const alerts = await db().collection('notificationOutbox').where('eventType', '==', 'duty.early_access').get();
      expect(alerts.docs.map(d => d.data().targetUserId)).toEqual(['doc1']);

      await expectDomainError(call(applyToDuty, 'doc2', { dutyId: 'd1', idempotencyKey: 'apply-key-2' }), 'PREMIUM_REQUIRED');
      await call(applyToDuty, 'doc1', { dutyId: 'd1', idempotencyKey: 'apply-key-1' });

      await db().doc('duties/d1').update({ earlyAccessEndsAt: isoIn(-60000) });
      await runTrigger(releaseEarlyAccessDuties, {});
      expect((await db().doc('duties/d1').get()).data()!.status).toBe('published');
      await call(applyToDuty, 'doc2', { dutyId: 'd1', idempotencyKey: 'apply-key-3' });
    });
  });

  describe('last-minute confirmation', () => {
    beforeEach(async () => {
      await seedDoctor('doc1');
      await seedDoctor('doc2');
      await db().doc('duties/d1').set({
        organizationId: 'o1', status: 'published', version: 1, remainingHeadcount: 1, headcount: 1,
        specialtyName: 'Emergency Medicine', facilityName: 'Main', facilityId: 'f1', department: 'Casualty',
        paymentTerms: { amount: 5000, currency: 'INR', basis: 'per_shift' },
        schedule: { startAt: isoIn(10 * HOUR), endAt: isoIn(18 * HOUR) },
      });
    });

    test('paid request → standby search → first doctor confirmed with contacts shared', async () => {
      await flag('last_minute_enabled');
      const date = indiaDateOf(isoIn(10 * HOUR));
      await call(setStandbyAvailability, 'doc1', { dates: [date] });
      await call(setStandbyAvailability, 'doc2', { dates: [date] });

      const req = await call<{ orderId: string; status: string; breakdown: { totalPaise: number } }>(requestLastMinuteConfirmation, 'staff1', { dutyId: 'd1' });
      expect(req).toMatchObject({ status: 'awaiting_payment', breakdown: { totalPaise: 11800 } });
      await expectDomainError(call(acceptLastMinuteDuty, 'doc1', { dutyId: 'd1' }), 'INVALID_STATE_TRANSITION');

      await call(recordPaymentAction, 'admin1', { orderId: req.orderId, action: 'payment_received', reference: 'UPI7' }, staffToken());
      expect((await db().doc('duties/d1').get()).data()!.lastMinute.status).toBe('searching');

      await expectDomainError(call(acceptLastMinuteDuty, 'doc3', { dutyId: 'd1' }), 'DOCTOR_NOT_VERIFIED');
      const accepted = await call<{ assignmentId: string }>(acceptLastMinuteDuty, 'doc1', { dutyId: 'd1' });
      const asg = (await db().doc(`assignments/${accepted.assignmentId}`).get()).data()!;
      expect(asg).toMatchObject({ status: 'confirmed', source: 'last_minute', doctorId: 'doc1' });
      expect((await db().doc(`contactGrants/asg_${accepted.assignmentId}`).get()).data()!.status).toBe('active');
      const duty = (await db().doc('duties/d1').get()).data()!;
      expect(duty).toMatchObject({ status: 'filled', remainingHeadcount: 0, lastMinute: { status: 'matched', matchedDoctorIds: ['doc1'] } });
      await expectDomainError(call(acceptLastMinuteDuty, 'doc2', { dutyId: 'd1' }), 'INVALID_STATE_TRANSITION');
    });

    test('nobody accepts: the search closes and the charge is marked for full refund', async () => {
      await flag('last_minute_enabled');
      const req = await call<{ orderId: string }>(requestLastMinuteConfirmation, 'staff1', { dutyId: 'd1' });
      await call(recordPaymentAction, 'admin1', { orderId: req.orderId, action: 'payment_received', reference: 'UPI8' }, staffToken());
      await db().doc('duties/d1').update({ 'lastMinute.deadlineAt': isoIn(-60000) });
      expect(await closeSearch('d1')).toBe('refund_due');
      expect((await db().doc(`paymentOrders/${req.orderId}`).get()).data()!.status).toBe('refund_due');
      await call(recordPaymentAction, 'admin1', { orderId: req.orderId, action: 'refund_sent', reference: 'RF8' }, staffToken());
      expect((await db().doc(`paymentOrders/${req.orderId}`).get()).data()!.refund.amountPaise).toBe(11800);
      expect((await db().doc('duties/d1').get()).data()!.lastMinute.status).toBe('refunded');
    });

    test('a doctor not on standby for the date cannot accept; far-off duties do not qualify', async () => {
      await flag('last_minute_enabled');
      await db().doc('configuration/last_minute_policy').set({ confirmationChargeInr: 0 });
      await call(requestLastMinuteConfirmation, 'staff1', { dutyId: 'd1' });
      await expectDomainError(call(acceptLastMinuteDuty, 'doc2', { dutyId: 'd1' }), 'PERMISSION_DENIED');

      await db().doc('duties/d2').set({ organizationId: 'o1', status: 'published', remainingHeadcount: 1, schedule: { startAt: isoIn(40 * HOUR), endAt: isoIn(48 * HOUR) } });
      await expectDomainError(call(requestLastMinuteConfirmation, 'staff1', { dutyId: 'd2' }), 'INVALID_STATE_TRANSITION');
    });
  });

  describe('community channels', () => {
    beforeEach(async () => {
      await flag('channels_enabled');
      await seedDoctor('doc1', { specialties: ['Dental Surgery'], primarySpecialty: 'Dentistry' });
      await seedDoctor('doc2');
      await db().doc('doctors/doc3').set({ fullName: 'Unverified', isVerified: false });
    });

    test('members post; outsiders and unverified doctors cannot; owners can remove', async () => {
      const { channelId } = await call<{ channelId: string }>(createChannel, 'doc2', { name: 'Emergency Cases', tags: ['Emergency'], description: 'Night casualty discussions' });
      await expectDomainError(call(sendChannelMessage, 'doc1', { channelId, text: 'hello' }), 'PERMISSION_DENIED');
      await call(joinChannel, 'doc1', { channelId });
      await call(sendChannelMessage, 'doc1', { channelId, text: 'Anyone seen dengue shock this week?' });
      await call(joinChannel, 'doc3', { channelId });
      await expectDomainError(call(sendChannelMessage, 'doc3', { channelId, text: 'hi' }), 'DOCTOR_NOT_VERIFIED');

      const messages = await db().collection(`channels/${channelId}/messages`).get();
      expect(messages.size).toBe(1);
      await call(reportChannelMessage, 'doc2', { channelId, messageId: messages.docs[0].id, reason: 'spam' });
      expect((await db().collection('channelReports').get()).size).toBe(1);

      await call(removeChannelMember, 'doc2', { channelId, memberUid: 'doc1', ban: true });
      await expectDomainError(call(joinChannel, 'doc1', { channelId }), 'PERMISSION_DENIED');
      expect((await db().doc(`channels/${channelId}`).get()).data()!.memberCount).toBe(2);
    });

    test('private channels need the invite code; media waits for its switch', async () => {
      const { channelId, inviteCode } = await call<{ channelId: string; inviteCode: string }>(createChannel, 'doc2', { name: 'Batch 2019', visibility: 'private' });
      await expectDomainError(call(joinChannel, 'doc1', { channelId }), 'PERMISSION_DENIED');
      await call(joinChannelByCode, 'doc1', { inviteCode });
      expect((await db().doc(`channels/${channelId}/members/doc1`).get()).exists).toBe(true);
      await expectDomainError(call(sendChannelMessage, 'doc1', { channelId, type: 'voice', mediaPath: `channels/${channelId}/doc1/a.m4a` }), 'FEATURE_DISABLED');
    });

    test('a dentist is recommended dental channels first', async () => {
      await call(createChannel, 'doc2', { name: 'Cardiology Rounds', tags: ['cardiology'] });
      await call(createChannel, 'doc2', { name: 'Dental Cases', tags: ['dental'] });
      const { channels } = await call<{ channels: { name: string }[] }>(listRecommendedChannels, 'doc1', {});
      expect(channels[0].name).toBe('Dental Cases');
    });
  });

  describe('AI assistant', () => {
    beforeEach(async () => {
      await flag('ai_assistant_enabled');
      await seedDoctor('doc1');
    });
    afterEach(() => { delete process.env.OPENAI_API_KEY; });

    test('refuses until configured; one free question, then the plan is needed', async () => {
      await expectDomainError(call(askAssistant, 'doc1', { question: 'Fever with rash in a child?' }), 'AI_NOT_CONFIGURED');
      process.env.OPENAI_API_KEY = 'test-key';
      const sent: Record<string, unknown>[] = [];
      setOpenAiTransportForTests(async body => { sent.push(body); return 'Consider measles, dengue, Kawasaki disease.'; });

      const first = await call<{ answer: string; freeQuestionsRemaining: number }>(askAssistant, 'doc1', { question: 'Fever with rash in a child?' });
      expect(first).toMatchObject({ answer: 'Consider measles, dengue, Kawasaki disease.', freeQuestionsRemaining: 0 });
      expect(sent[0]).toMatchObject({ model: 'gpt-4o-mini' });
      await expectDomainError(call(askAssistant, 'doc1', { question: 'And in an adult?' }), 'AI_QUOTA_EXCEEDED');

      await call(grantSubscription, 'admin1', { uid: 'doc1', kind: 'ai', months: 1, reason: 'Trial' }, staffToken());
      await call(askAssistant, 'doc1', { question: 'And in an adult?' });
      const thread = await db().collection('aiThreads/doc1/messages').get();
      expect(thread.size).toBe(4);
    });

    test('an image needs patient consent and must be in the doctor\'s folder', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      await expectDomainError(call(askAssistant, 'doc1', { question: 'What is this lesion?', imagePath: 'ai/doc1/x.jpg' }), 'VALIDATION_FAILED');
      await expectDomainError(call(askAssistant, 'doc1', { question: 'What is this lesion?', imagePath: 'ai/doc2/x.jpg', patientConsentConfirmed: true }), 'FILE_NOT_ALLOWED');
    });
  });

  test('the app sees only switched-on modules and their plans', async () => {
    let features = await call<{ plans: { planId: string }[]; flags: Record<string, boolean> }>(getBusinessFeatures, 'doc1', {});
    expect(features.plans).toEqual([]);
    await flag('premium_enabled');
    features = await call(getBusinessFeatures, 'doc1', {});
    expect(features.plans.map(p => p.planId)).toEqual(['premium_6m']);
    expect(features.flags.premium_enabled).toBe(true);
  });

  test('completing a confirmed shift still works after check-in', async () => {
    await seedDoctor('doc1');
    await seedAssignment('a9', 'confirmed', -10 * 60000);
    const code = await call<{ code: string }>(issueAttendanceCode, 'staff1', { assignmentId: 'a9', kind: 'check_in' });
    await call(scanAttendanceCode, 'doc1', { code: code.code, location: HOSPITAL });
    await call(completeAssignment, 'staff1', { assignmentId: 'a9' });
    expect((await db().doc('assignments/a9').get()).data()!.status).toBe('completed');
  });
});
