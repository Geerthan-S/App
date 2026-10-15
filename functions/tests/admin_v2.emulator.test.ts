/**
 * Admin portal v2 against the Auth, Firestore and Storage emulators:
 * the security boundary (MFA, rate limits, denial audit, request metadata),
 * reviewer workflow, directory and account actions, operations, support
 * cases, staff roles and the dashboard figures.
 * Run with: npm run test:emulator
 */
import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import {
  MFA, HOUR, adminDb, call, clearFirestore, describeWithEmulator, expectDomainError, isoIn, verifierToken,
} from './helpers/emulator';
import { getAdminDashboard, getAuditLogs, submitModerationAction, updatePlatformConfig } from '../src/admin/adminFunctions';
import {
  adminSearch, getDoctorProfile, listDoctors, listDuties, setAccountStatus, setDutyVisibility,
} from '../src/admin/directoryFunctions';
import {
  getAttentionItems, getSystemHealth, listRenewalsDue, requeueNotification, sendRenewalReminder,
} from '../src/admin/operationsFunctions';
import { createSupportCase, getSupportCase, listSupportCases, updateSupportCase } from '../src/admin/supportFunctions';
import { createStaffAccount, listStaff, setCustomClaims } from '../src/auth/staffFunctions';
import { assertSignUpAllowed } from '../src/auth/blockingFunctions';
import { submitModerationReport } from '../src/moderation/reportFunctions';
import {
  claimVerificationCase, escalateVerificationCase, releaseVerificationCase,
} from '../src/verification/caseWorkflowFunctions';
import { getVerificationQueue, recordVerificationDecision } from '../src/verification/verificationFunctions';
import { screenBrandingUpload } from '../src/verification/evidenceIngest';
import { enforceRateLimit } from '../src/security/rateLimit';

jest.setTimeout(60_000);

const now = () => Math.floor(Date.now() / 1000);
const superToken = () => ({ isSuperAdmin: true, auth_time: now(), ...MFA });
const supportToken = () => ({ isSupportAdmin: true, auth_time: now(), ...MFA });
const db = () => adminDb();
const ts = (ms: number) => Timestamp.fromMillis(ms);

const clearAuth = async () => {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host) return;
  await fetch(`http://${host}/emulator/v1/projects/demo-healthforce/accounts`, { method: 'DELETE' });
};

interface Runnable { run: (request: unknown) => unknown }

describeWithEmulator('admin portal v2', () => {
  beforeAll(() => {
    adminDb(); // index.ts initializes the Admin SDK in production
  });

  beforeEach(async () => {
    await clearFirestore();
    await clearAuth();
  });

  describe('security boundary', () => {
    test('staff tools refuse a session without a second factor and audit the denial', async () => {
      await expectDomainError(
        call(getAdminDashboard, 'verifier1', {}, { isVerifier: true, auth_time: now() }), 'MFA_REQUIRED', 'permission-denied');
      const denied = await db().collection('auditLogs').where('action', '==', 'ACCESS_DENIED').get();
      expect(denied.size).toBe(1);
      expect(denied.docs[0].data()).toMatchObject({
        actorId: 'verifier1', targetType: 'callable', targetId: 'getAdminDashboard', reasonCode: 'MFA_REQUIRED', result: 'DENIED',
      });
    });

    test('a non-staff caller is denied and audited without leaking anything', async () => {
      await expectDomainError(call(listDoctors, 'doctor1', {}), 'PERMISSION_DENIED');
      const denied = await db().collection('auditLogs').where('targetId', '==', 'listDoctors').get();
      expect(denied.docs[0].data().result).toBe('DENIED');
    });

    test('rate limiting allows the limit and then refuses with a retry hint', async () => {
      const rule = { limit: 2, windowSeconds: 60 };
      await enforceRateLimit('u1', 'bucketA', rule, 'c');
      await enforceRateLimit('u1', 'bucketA', rule, 'c');
      await expect(enforceRateLimit('u1', 'bucketA', rule, 'c')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      // Other users and buckets are independent.
      await enforceRateLimit('u2', 'bucketA', rule, 'c');
      await enforceRateLimit('u1', 'bucketB', rule, 'c');
      const counter = (await db().doc('rateLimits/u1__bucketA').get()).data();
      expect(counter?.count).toBe(2);
      expect(counter?.expireAt).toBeInstanceOf(Timestamp);
    });

    test('audit records carry the caller IP, user agent and callable name', async () => {
      await db().doc('duties/duty1').set({ status: 'published' });
      await (submitModerationReport as unknown as Runnable).run({
        data: { targetType: 'duty', targetId: 'duty1', reason: 'Fake listing' },
        auth: { uid: 'doctor1', token: { uid: 'doctor1' } },
        rawRequest: { ip: '203.0.113.7', headers: { 'user-agent': 'jest-agent' } },
      });
      const filed = await db().collection('auditLogs').where('action', '==', 'MODERATION_REPORT_FILED').get();
      expect(filed.docs[0].data().securityMetadata).toEqual({
        ipAddress: '203.0.113.7', forwardedFor: null, userAgent: 'jest-agent', callable: 'submitModerationReport',
      });
    });

    test('public sign-up is limited to phone and Google outside the emulator', () => {
      expect(() => assertSignUpAllowed('phone', false)).not.toThrow();
      expect(() => assertSignUpAllowed('google.com', false)).not.toThrow();
      expect(() => assertSignUpAllowed('password', false)).toThrow();
      expect(() => assertSignUpAllowed(undefined, false)).toThrow();
      expect(() => assertSignUpAllowed('password', true)).not.toThrow();
    });

    test('a branding upload whose bytes are not the declared image is deleted', async () => {
      const fakeFile = (content: Buffer) => {
        const state = { deleted: false };
        return {
          state,
          download: async () => [content] as [Buffer],
          delete: async () => { state.deleted = true; },
        };
      };
      const html = fakeFile(Buffer.from('<html>not an image</html>'));
      const png = fakeFile(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
      const webp = fakeFile(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]));

      expect(await screenBrandingUpload(html, 'public/branding/org1/fake.png', 'image/png')).toBe(false);
      expect(html.state.deleted).toBe(true);
      expect(await screenBrandingUpload(png, 'public/branding/org1/real.png', 'image/png')).toBe(true);
      expect(png.state.deleted).toBe(false);
      expect(await screenBrandingUpload(webp, 'public/branding/org1/logo.webp', 'image/webp')).toBe(true);
    });
  });

  describe('community reports', () => {
    test('one open report per target; resolved reports stay as history', async () => {
      await db().doc('duties/duty1').set({ status: 'published' });
      const first = await call<{ reportId: string; duplicate: boolean }>(submitModerationReport, 'doctor1',
        { targetType: 'duty', targetId: 'duty1', reason: 'Fake listing' });
      const again = await call<{ reportId: string; duplicate: boolean }>(submitModerationReport, 'doctor1',
        { targetType: 'duty', targetId: 'duty1', reason: 'Fake listing' });
      expect(again).toMatchObject({ reportId: first.reportId, duplicate: true });

      await call(submitModerationAction, 'support1', { reportId: first.reportId, action: 'dismiss', reasonCode: 'NO_ISSUE' }, supportToken());
      const later = await call<{ reportId: string; duplicate: boolean }>(submitModerationReport, 'doctor1',
        { targetType: 'duty', targetId: 'duty1', reason: 'Still fake' });
      expect(later.duplicate).toBe(false);
      expect(later.reportId).not.toBe(first.reportId);
      expect((await db().doc(`moderationReports/${first.reportId}`).get()).data()?.status).toBe('resolved');
    });

    test('missing targets and self-reports are refused', async () => {
      await expectDomainError(call(submitModerationReport, 'doctor1',
        { targetType: 'duty', targetId: 'nope', reason: 'Fake listing' }), 'RESOURCE_NOT_FOUND');
      await db().doc('users/doctor1').set({ status: 'active' });
      await expectDomainError(call(submitModerationReport, 'doctor1',
        { targetType: 'user', targetId: 'doctor1', reason: 'Me' }), 'VALIDATION_FAILED');
    });
  });

  describe('reviewer workflow', () => {
    const seedCase = async (overrides: Record<string, unknown> = {}) => {
      await db().doc('doctors/d1').set({ fullName: 'Dr. Asha', registrationNo: 'TN123', council: 'TNMC', verificationCaseId: 'c1', profileRevision: 1 });
      await db().doc('verificationCases/c1').set({
        caseId: 'c1', subjectType: 'doctor', subjectId: 'd1', subjectRevision: 1, status: 'submitted',
        submittedAt: ts(Date.now() - 50 * HOUR), ...overrides,
      });
    };

    test('the queue reports SLA state, flags and assignee', async () => {
      await seedCase();
      await db().doc('verificationDocuments/e1').set({ caseId: 'c1', scanStatus: 'pending' });
      await db().doc('staffDirectory/verifier1').set({ displayName: 'Vera' });
      await call(claimVerificationCase, 'verifier1', { caseId: 'c1' }, verifierToken());

      const { cases } = await call<{ cases: Record<string, unknown>[] }>(getVerificationQueue, 'verifier1', {}, verifierToken());
      expect(cases[0]).toMatchObject({
        caseId: 'c1', subjectName: 'Dr. Asha', registrationNo: 'TN123', status: 'under_review',
        slaState: 'overdue', assigneeId: 'verifier1', assigneeName: 'Vera', evidenceCount: 1,
        flags: { stale: false, repeat: false, evidencePending: true, noEvidence: false },
      });
    });

    test('a claimed case cannot be taken by another verifier, only released', async () => {
      await seedCase();
      await call(claimVerificationCase, 'verifier1', { caseId: 'c1' }, verifierToken());
      await expectDomainError(call(claimVerificationCase, 'verifier2', { caseId: 'c1' }, verifierToken()), 'INVALID_STATE_TRANSITION');
      await expectDomainError(call(releaseVerificationCase, 'verifier2', { caseId: 'c1' }, verifierToken()), 'PERMISSION_DENIED');
      await call(releaseVerificationCase, 'verifier1', { caseId: 'c1' }, verifierToken());
      await call(claimVerificationCase, 'verifier2', { caseId: 'c1' }, verifierToken());
      expect((await db().doc('verificationCases/c1').get()).data()?.assigneeId).toBe('verifier2');
    });

    test('an escalated case can only be decided by a super admin', async () => {
      await seedCase();
      await call(escalateVerificationCase, 'verifier1', { caseId: 'c1', reasonCode: 'NAME_MISMATCH', notes: 'Spelling differs' }, verifierToken());
      await expectDomainError(call(escalateVerificationCase, 'verifier1', { caseId: 'c1', reasonCode: 'AGAIN' }, verifierToken()),
        'INVALID_STATE_TRANSITION');

      await expectDomainError(call(recordVerificationDecision, 'verifier1',
        { caseId: 'c1', decision: 'rejected', reasonCode: 'NAME_MISMATCH' }, verifierToken()), 'PERMISSION_DENIED');
      await call(recordVerificationDecision, 'super1',
        { caseId: 'c1', decision: 'rejected', reasonCode: 'NAME_MISMATCH' }, superToken());
      expect((await db().doc('verificationCases/c1').get()).data()?.status).toBe('rejected');
    });
  });

  describe('directory and account actions', () => {
    test('lists doctors by verification state with account status', async () => {
      await db().doc('doctors/d1').set({ fullName: 'A', isVerified: true, createdAt: ts(Date.now() - 2000) });
      await db().doc('doctors/d2').set({ fullName: 'B', isVerified: false, createdAt: ts(Date.now() - 1000) });
      await db().doc('users/d2').set({ status: 'suspended', activeRole: 'doctor', suspendedAt: ts(Date.now()) });

      const verified = await call<{ doctors: { doctorId: string }[] }>(listDoctors, 'v1', { filter: 'verified' }, verifierToken());
      expect(verified.doctors.map(d => d.doctorId)).toEqual(['d1']);
      const suspended = await call<{ doctors: { doctorId: string; accountStatus: string }[] }>(
        listDoctors, 'v1', { filter: 'suspended' }, verifierToken());
      expect(suspended.doctors).toMatchObject([{ doctorId: 'd2', accountStatus: 'suspended' }]);
      const all = await call<{ doctors: unknown[]; nextCursor: string | null }>(listDoctors, 'v1', { limit: 1 }, verifierToken());
      expect(all.doctors).toHaveLength(1);
      expect(all.nextCursor).toBe('d2');
    });

    test('viewing a doctor profile is audited; contact details are for support staff only', async () => {
      const user = await getAuth().createUser({ email: 'doc@example.com', phoneNumber: '+919800000001' });
      await db().doc(`doctors/${user.uid}`).set({ fullName: 'Dr. Contact', isVerified: false });

      const asVerifier = await call<{ account: { auth: { email: string | null } } }>(
        getDoctorProfile, 'v1', { doctorId: user.uid }, verifierToken());
      expect(asVerifier.account.auth.email).toBeNull();
      const asSupport = await call<{ account: { auth: { email: string | null; phoneNumber: string | null } } }>(
        getDoctorProfile, 'support1', { doctorId: user.uid }, supportToken());
      expect(asSupport.account.auth).toMatchObject({ email: 'doc@example.com', phoneNumber: '+919800000001' });
      const views = await db().collection('auditLogs').where('action', '==', 'DOCTOR_PROFILE_VIEWED').get();
      expect(views.size).toBe(2);
    });

    test('suspend and reinstate an account; staff accounts need a super admin', async () => {
      const doctor = await getAuth().createUser({ email: 'd@example.com' });
      const staff = await getAuth().createUser({ email: 's@example.com' });
      await getAuth().setCustomUserClaims(staff.uid, { isVerifier: true });

      await call(setAccountStatus, 'support1', { uid: doctor.uid, status: 'suspended', reasonCode: 'FRAUD' }, supportToken());
      expect((await db().doc(`users/${doctor.uid}`).get()).data()?.status).toBe('suspended');
      await expectDomainError(call(setAccountStatus, 'support1',
        { uid: doctor.uid, status: 'suspended', reasonCode: 'FRAUD' }, supportToken()), 'INVALID_STATE_TRANSITION');
      await call(setAccountStatus, 'support1', { uid: doctor.uid, status: 'active', reasonCode: 'APPEAL_UPHELD' }, supportToken());
      expect((await db().doc(`users/${doctor.uid}`).get()).data()).toMatchObject({ status: 'active', suspensionReason: null });

      await expectDomainError(call(setAccountStatus, 'support1',
        { uid: staff.uid, status: 'suspended', reasonCode: 'X_REASON' }, supportToken()), 'PERMISSION_DENIED');
      await expectDomainError(call(setAccountStatus, 'support1',
        { uid: 'support1', status: 'suspended', reasonCode: 'X_REASON' }, supportToken()), 'PERMISSION_DENIED');
      await expectDomainError(call(setAccountStatus, 'support1',
        { uid: doctor.uid, status: 'suspended', reasonCode: 'X_REASON' }, { ...supportToken(), auth_time: now() - 3600 }),
      'STEP_UP_REQUIRED');
    });

    test('hide a published duty, list it as hidden, and restore it', async () => {
      await db().doc('duties/u1').set({ status: 'published', schedule: { startAt: isoIn(48 * HOUR) }, createdAt: ts(Date.now()) });
      await db().doc('duties/u2').set({ status: 'filled', schedule: { startAt: isoIn(48 * HOUR) }, createdAt: ts(Date.now()) });

      await call(setDutyVisibility, 'support1', { dutyId: 'u1', visibility: 'hidden', reasonCode: 'MISLEADING_PAY' }, supportToken());
      await expectDomainError(call(setDutyVisibility, 'support1',
        { dutyId: 'u2', visibility: 'hidden', reasonCode: 'MISLEADING_PAY' }, supportToken()), 'INVALID_STATE_TRANSITION');
      const hidden = await call<{ duties: { dutyId: string; status: string }[] }>(listDuties, 'v1', { filter: 'hidden' }, verifierToken());
      expect(hidden.duties).toMatchObject([{ dutyId: 'u1', status: 'paused' }]);

      await call(setDutyVisibility, 'support1', { dutyId: 'u1', visibility: 'visible', reasonCode: 'FIXED' }, supportToken());
      expect((await db().doc('duties/u1').get()).data()).toMatchObject({ status: 'published', moderationHidden: false });
    });

    test('a duty hidden from a report can be restored, but not once it has started', async () => {
      await db().doc('duties/u1').set({ status: 'published', schedule: { startAt: isoIn(-HOUR) } });
      await db().doc('moderationReports/r1').set({ status: 'open', targetType: 'duty', targetId: 'u1' });
      await call(submitModerationAction, 'support1', { reportId: 'r1', action: 'hide_duty', reasonCode: 'SPAM' }, supportToken());
      expect((await db().doc('duties/u1').get()).data()).toMatchObject({ moderationHidden: true, statusBeforeHide: 'published' });
      await expectDomainError(call(setDutyVisibility, 'support1',
        { dutyId: 'u1', visibility: 'visible', reasonCode: 'FIXED' }, supportToken()), 'INVALID_STATE_TRANSITION');
    });

    test('search finds records by ID, registration number and name prefix', async () => {
      await db().doc('doctors/d1').set({ fullName: 'Ravi Kumar', registrationNo: 'KMC-998', council: 'KMC' });
      await db().doc('organizations/o1').set({ legalName: 'Ravindra Hospital', city: 'Chennai' });
      const byName = await call<{ results: { type: string; id: string }[] }>(adminSearch, 'v1', { query: 'ravi' }, verifierToken());
      expect(byName.results.map(r => `${r.type}:${r.id}`).sort()).toEqual(['doctor:d1', 'organization:o1']);
      const byReg = await call<{ results: { id: string }[] }>(adminSearch, 'v1', { query: 'KMC-998' }, verifierToken());
      expect(byReg.results.map(r => r.id)).toContain('d1');
      const byId = await call<{ results: { type: string }[] }>(adminSearch, 'v1', { query: 'o1' }, verifierToken());
      expect(byId.results[0].type).toBe('organization');
    });
  });

  describe('operations', () => {
    test('attention items surface escalations, overdue cases, reports and dead letters by role', async () => {
      await db().doc('verificationCases/c1').set({ subjectType: 'doctor', subjectId: 'd1', status: 'submitted', escalated: true, submittedAt: ts(Date.now()) });
      await db().doc('verificationCases/c2').set({ subjectType: 'doctor', subjectId: 'd2', status: 'submitted', submittedAt: ts(Date.now() - 100 * HOUR) });
      await db().doc('moderationReports/r1').set({ status: 'open', targetType: 'duty', targetId: 'u1', reason: 'Spam' });
      await db().doc('notificationOutbox/n1').set({ status: 'dead_letter', createdAt: ts(Date.now()) });

      const asVerifier = await call<{ items: { kind: string }[] }>(getAttentionItems, 'v1', {}, verifierToken());
      expect(asVerifier.items.map(i => i.kind)).toEqual(['escalated_case', 'sla_overdue']);
      const asSuper = await call<{ items: { kind: string }[] }>(getAttentionItems, 's1', {}, superToken());
      expect(asSuper.items.map(i => i.kind).sort()).toEqual(['dead_letter', 'escalated_case', 'open_report', 'sla_overdue']);
    });

    test('system health marks scanning as blocked until the scanner reports', async () => {
      await db().doc('verificationDocuments/e1').set({ scanStatus: 'pending', uploadedAt: ts(Date.now() - 2 * HOUR) });
      const health = await call<{ checks: { name: string; status: string }[] }>(getSystemHealth, 'support1', {}, supportToken());
      expect(health.checks.find(c => c.name === 'Malware scanning')?.status).toBe('blocked_external');
      await expectDomainError(call(getSystemHealth, 'v1', {}, verifierToken()), 'PERMISSION_DENIED');
    });

    test('a dead-lettered notification can be requeued with a fresh retry budget', async () => {
      await db().doc('notificationOutbox/n1').set({ status: 'dead_letter', attemptCount: 5 });
      await db().doc('notificationOutbox/n2').set({ status: 'delivered', attemptCount: 1 });
      await call(requeueNotification, 'support1', { eventId: 'n1', reasonCode: 'TOKEN_FIXED' }, supportToken());
      expect((await db().doc('notificationOutbox/n1').get()).data()).toMatchObject({ status: 'pending', attemptCount: 0 });
      await expectDomainError(call(requeueNotification, 'support1', { eventId: 'n2', reasonCode: 'X_X' }, supportToken()),
        'INVALID_STATE_TRANSITION');
    });

    test('renewals list doctors past the re-verification interval and reminders are throttled', async () => {
      await db().doc('doctors/old').set({ fullName: 'Old', isVerified: true, verifiedAt: ts(Date.now() - 400 * 24 * HOUR) });
      await db().doc('doctors/new').set({ fullName: 'New', isVerified: true, verifiedAt: ts(Date.now() - 10 * 24 * HOUR) });
      const due = await call<{ doctors: { doctorId: string; canRemind: boolean }[] }>(listRenewalsDue, 'v1', {}, verifierToken());
      expect(due.doctors).toMatchObject([{ doctorId: 'old', canRemind: true }]);

      await call(sendRenewalReminder, 'v1', { doctorId: 'old' }, verifierToken());
      const outbox = await db().collection('notificationOutbox').where('targetUserId', '==', 'old').get();
      expect(outbox.docs[0].data().eventType).toBe('verification.renewal_due');
      await expectDomainError(call(sendRenewalReminder, 'v1', { doctorId: 'old' }, verifierToken()), 'RATE_LIMITED');
    });
  });

  describe('support cases', () => {
    test('open, note, reassign and resolve a case with an audit trail', async () => {
      const { caseId } = await call<{ caseId: string }>(createSupportCase, 'support1', {
        subject: 'Cannot upload licence', description: 'Upload fails at 90%', category: 'verification', priority: 'high',
      }, supportToken());
      await call(updateSupportCase, 'support1', { caseId, note: 'Asked for a smaller PDF' }, supportToken());
      await call(updateSupportCase, 'support2', { caseId, assignToMe: true, status: 'pending' }, supportToken());

      const mine = await call<{ cases: { caseId: string }[] }>(listSupportCases, 'support2', { status: 'pending', mine: true }, supportToken());
      expect(mine.cases.map(c => c.caseId)).toEqual([caseId]);
      await call(updateSupportCase, 'support2', { caseId, status: 'resolved' }, supportToken());

      const { case: detail } = await call<{ case: { status: string; resolvedAt: string | null; notes: { text: string }[] } }>(
        getSupportCase, 'support1', { caseId }, supportToken());
      expect(detail.status).toBe('resolved');
      expect(detail.resolvedAt).not.toBeNull();
      expect(detail.notes.map(n => n.text)).toEqual(['Asked for a smaller PDF']);
      const trail = await db().collection('auditLogs').where('targetId', '==', caseId).get();
      expect(trail.size).toBe(4);
      await expectDomainError(call(createSupportCase, 'v1', { subject: 'x', description: 'y', category: 'other' }, verifierToken()),
        'PERMISSION_DENIED');
    });
  });

  describe('staff roles', () => {
    test('grant a role by email, list staff, and never edit your own roles', async () => {
      const target = await getAuth().createUser({ email: 'new.verifier@example.com', displayName: 'New Verifier' });
      const roles = { isVerifier: true, isSupportAdmin: false, isSuperAdmin: false };

      await call(setCustomClaims, 'super1', { email: 'new.verifier@example.com', claims: roles, reasonCode: 'NEW_VERIFIER' }, superToken());
      expect((await getAuth().getUser(target.uid)).customClaims).toMatchObject(roles);
      const actions = (await db().collection('auditLogs').where('targetId', '==', target.uid).get()).docs.map(d => d.data().action).sort();
      expect(actions).toEqual(['CUSTOM_CLAIMS_CHANGE_REQUESTED', 'CUSTOM_CLAIMS_SET']);

      const { staff } = await call<{ staff: { uid: string; active: boolean; roles: Record<string, boolean> }[] }>(
        listStaff, 'support1', {}, supportToken());
      expect(staff).toMatchObject([{ uid: target.uid, active: true, roles }]);

      await expectDomainError(call(setCustomClaims, target.uid,
        { targetUid: target.uid, claims: roles, reasonCode: 'SELF' }, superToken()), 'PERMISSION_DENIED');
      await expectDomainError(call(setCustomClaims, 'super1',
        { targetUid: target.uid, claims: roles, reasonCode: 'lowercase' }, superToken()), 'VALIDATION_FAILED');
      await expectDomainError(call(setCustomClaims, 'super1',
        { targetUid: target.uid, claims: roles, reasonCode: 'OLD_SESSION' }, { ...superToken(), auth_time: now() - 3600 }),
      'STEP_UP_REQUIRED');
      await expectDomainError(call(setCustomClaims, 'support1',
        { targetUid: target.uid, claims: roles, reasonCode: 'NOPE' }, supportToken()), 'PERMISSION_DENIED');
    });
  });

  describe('staff account creation', () => {
    test('a super admin creates a staff login; the password is returned once and never audited', async () => {
      const roles = { isVerifier: true, isSupportAdmin: false, isSuperAdmin: false };
      const created = await call<{ uid: string; email: string; temporaryPassword: string }>(createStaffAccount, 'super1',
        { username: 'new.verifier', displayName: 'New Verifier', claims: roles, reasonCode: 'NEW_HIRE' }, superToken());
      expect(created.email).toBe('new.verifier@admin.doctor-c7c29.web.app');
      expect(created.temporaryPassword).toMatch(/^[A-Za-z0-9]{20}$/);
      const user = await getAuth().getUser(created.uid);
      expect(user.customClaims).toMatchObject(roles);
      expect(user.emailVerified).toBe(true);
      expect((await db().doc(`staffDirectory/${created.uid}`).get()).data()).toMatchObject({ active: true, roles });

      const trail = await db().collection('auditLogs').where('targetId', '==', created.uid).get();
      expect(trail.docs.map(d => d.data().action)).toEqual(['STAFF_ACCOUNT_CREATED']);
      expect(JSON.stringify(trail.docs[0].data())).not.toContain(created.temporaryPassword);

      await expectDomainError(call(createStaffAccount, 'super1',
        { username: 'new.verifier', displayName: 'Again', claims: roles, reasonCode: 'NEW_HIRE' }, superToken()), 'APPLICATION_ALREADY_EXISTS');
      await expectDomainError(call(createStaffAccount, 'super1',
        { username: 'x', displayName: 'Bad', claims: roles, reasonCode: 'NEW_HIRE' }, superToken()), 'VALIDATION_FAILED');
      await expectDomainError(call(createStaffAccount, 'super1', { username: 'no.roles', displayName: 'None',
        claims: { isVerifier: false, isSupportAdmin: false, isSuperAdmin: false }, reasonCode: 'NEW_HIRE' }, superToken()), 'VALIDATION_FAILED');
      await expectDomainError(call(createStaffAccount, 'support1',
        { username: 'by.support', displayName: 'X', claims: roles, reasonCode: 'NEW_HIRE' }, supportToken()), 'PERMISSION_DENIED');
    });
  });

  describe('dashboard and audit views', () => {
    test('insights report SLA compliance, 7-day trend and active cities from stored timestamps', async () => {
      const decidedAt = Date.now() - 2 * HOUR;
      await db().doc('verificationCases/fast').set({ status: 'approved', submittedAt: ts(decidedAt - 10 * HOUR), decidedAt: ts(decidedAt) });
      await db().doc('verificationCases/slow').set({ status: 'rejected', submittedAt: ts(decidedAt - 60 * HOUR), decidedAt: ts(decidedAt) });
      await db().doc('duties/u1').set({ status: 'published', city: 'Chennai' });
      await db().doc('duties/u2').set({ status: 'filled', city: 'Chennai' });
      await db().doc('duties/u3').set({ status: 'published', city: 'Madurai' });

      const { insights } = await call<{ insights: {
        sla: { compliancePercent: number; decidedInWindow: number };
        trend: { decided: number; approved: number }[];
        cities: { active: number; top: { city: string; duties: number }[] };
      } }>(getAdminDashboard, 'v1', {}, verifierToken());
      expect(insights.sla).toMatchObject({ compliancePercent: 50, decidedInWindow: 2 });
      expect(insights.trend).toHaveLength(7);
      expect(insights.trend.reduce((n, d) => n + d.decided, 0)).toBe(2);
      expect(insights.cities).toMatchObject({ active: 2, top: [{ city: 'Chennai', duties: 2 }, { city: 'Madurai', duties: 1 }] });
    });

    test('the verification policy is validated and drives the SLA', async () => {
      await expectDomainError(call(updatePlatformConfig, 'super1',
        { configKey: 'verification_policy', configValue: { slaHours: 1, reverifyAfterMonths: 12 } }, superToken()), 'VALIDATION_FAILED');
      await call(updatePlatformConfig, 'super1',
        { configKey: 'verification_policy', configValue: { slaHours: 100, reverifyAfterMonths: 12 } }, superToken());
      await db().doc('verificationCases/c1').set({ subjectType: 'doctor', subjectId: 'd1', status: 'submitted', submittedAt: ts(Date.now() - 60 * HOUR) });
      const { cases } = await call<{ cases: { slaState: string }[] }>(getVerificationQueue, 'v1', {}, verifierToken());
      expect(cases[0].slaState).toBe('on_track');
    });

    test('admin activity shows only staff actions; denied attempts are filterable', async () => {
      await db().doc('auditLogs/a1').set({ actorRole: 'doctor', action: 'X', result: 'SUCCESS', createdAt: ts(Date.now() - 3000) });
      await db().doc('auditLogs/a2').set({ actorRole: 'verifier', action: 'Y', result: 'SUCCESS', createdAt: ts(Date.now() - 2000) });
      await db().doc('auditLogs/a3').set({ actorRole: 'unknown', action: 'ACCESS_DENIED', result: 'DENIED', createdAt: ts(Date.now() - 1000) });

      const staffOnly = await call<{ entries: { auditId: string }[] }>(getAuditLogs, 'support1', { scope: 'staff' }, supportToken());
      expect(staffOnly.entries.map(e => e.auditId)).toEqual(['a2']);
      const denied = await call<{ entries: { auditId: string }[] }>(getAuditLogs, 'support1', { result: 'DENIED' }, supportToken());
      expect(denied.entries.map(e => e.auditId)).toEqual(['a3']);
      await expectDomainError(call(getAuditLogs, 'support1', { result: 'DENIED', scope: 'staff' }, supportToken()), 'VALIDATION_FAILED');
    });
  });
});
