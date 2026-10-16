/**
 * Admin portal callables against the Firestore emulator: dashboard counts,
 * audit trail paging, moderation target checks, and validated configuration.
 * Run with: npm run test:emulator
 */
import {
  MFA, adminDb, call, clearFirestore, describeWithEmulator, expectDomainError, verifierToken,
} from './helpers/emulator';
import {
  getAdminDashboard, getAdminQueues, getAuditLogs, getPlatformConfig,
  setFeatureFlag, submitModerationAction, updatePlatformConfig,
} from '../src/admin/adminFunctions';
import { getOfferExpiryHours } from '../src/shared/platformConfig';
import { getVerificationQueue } from '../src/verification/verificationFunctions';

jest.setTimeout(30_000);

const SUPER = 'superA';
const SUPPORT = 'supportA';
const VERIFIER = 'verifierA';
const OUTSIDER = 'doctorA';

const now = () => Math.floor(Date.now() / 1000);
const superToken = () => ({ isSuperAdmin: true, auth_time: now(), ...MFA });
const supportToken = () => ({ isSupportAdmin: true, auth_time: now(), ...MFA });

const db = () => adminDb();

describeWithEmulator('admin portal', () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  describe('dashboard', () => {
    test('counts platform records and open work for any staff role', async () => {
      await db().doc('doctors/d1').set({ isVerified: true });
      await db().doc('doctors/d2').set({ isVerified: false });
      await db().doc('organizations/o1').set({ verificationState: 'approved' });
      await db().doc('duties/u1').set({ status: 'published' });
      await db().doc('duties/u2').set({ status: 'filled' });
      await db().doc('duties/u1/applications/d1').set({ doctorId: 'd1', status: 'submitted' });
      await db().doc('duties/u2/applications/d2').set({ doctorId: 'd2', status: 'selected' });
      await db().doc('assignments/a1').set({ status: 'confirmed' });
      await db().doc('assignments/a2').set({ status: 'cancelled' });
      await db().doc('verificationCases/c1').set({ subjectType: 'doctor', status: 'submitted' });
      await db().doc('verificationCases/c2').set({ subjectType: 'organization', status: 'under_review' });
      await db().doc('verificationCases/c3').set({ subjectType: 'doctor', status: 'approved' });
      await db().doc('moderationReports/r1').set({ status: 'open', targetType: 'duty', targetId: 'u1' });

      const result = await call<Record<string, Record<string, number>>>(getAdminDashboard, VERIFIER, {}, verifierToken());

      expect(result.doctors).toEqual({ total: 2, verified: 1 });
      expect(result.organizations).toEqual({ total: 1, approved: 1 });
      expect(result.duties).toEqual({ published: 1, filled: 1 });
      expect(result.assignments).toEqual({ open: 1 });
      expect(result.applications).toEqual({ total: 2 });
      expect(result.pending).toEqual({ doctorCases: 1, organizationCases: 1, openReports: 1 });
    });

    test('is refused to accounts without a staff claim', async () => {
      await expectDomainError(call(getAdminDashboard, OUTSIDER, {}), 'PERMISSION_DENIED');
    });
  });

  describe('verification queue', () => {
    test('each case carries the subject\'s current display name', async () => {
      await db().doc('doctors/d1').set({ fullName: 'Dr. Queue Test' });
      await db().doc('organizations/o1').set({ legalName: 'Queue Hospital Pvt Ltd', displayName: 'Queue Hospital' });
      await db().doc('verificationCases/c1').set({ caseId: 'c1', subjectType: 'doctor', subjectId: 'd1', status: 'submitted' });
      await db().doc('verificationCases/c2').set({ caseId: 'c2', subjectType: 'organization', subjectId: 'o1', status: 'submitted' });
      await db().doc('verificationCases/c3').set({ caseId: 'c3', subjectType: 'doctor', subjectId: 'gone', status: 'submitted' });

      const { cases } = await call<{ cases: { caseId: string; subjectName: string | null }[] }>(
        getVerificationQueue, VERIFIER, {}, verifierToken());
      const names = Object.fromEntries(cases.map(c => [c.caseId, c.subjectName]));
      expect(names).toEqual({ c1: 'Dr. Queue Test', c2: 'Queue Hospital', c3: null });
    });
  });

  describe('audit trail', () => {
    const seedAudit = async (count: number) => {
      for (let i = 0; i < count; i++) {
        await db().doc(`auditLogs/log${String(i).padStart(2, '0')}`).set({
          action: i % 2 ? 'MODERATION_DISMISS' : 'VERIFICATION_CASE_VIEWED',
          targetId: `t${i}`,
          result: 'SUCCESS',
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
        });
      }
    };

    test('pages newest first with a cursor', async () => {
      await seedAudit(5);
      const first = await call<{ entries: { auditId: string }[]; nextCursor: string | null }>(
        getAuditLogs, SUPPORT, { limit: 3 }, supportToken());
      expect(first.entries.map(e => e.auditId)).toEqual(['log04', 'log03', 'log02']);
      expect(first.nextCursor).toBe('log02');

      const second = await call<{ entries: { auditId: string }[]; nextCursor: string | null }>(
        getAuditLogs, SUPPORT, { limit: 3, cursor: first.nextCursor }, supportToken());
      expect(second.entries.map(e => e.auditId)).toEqual(['log01', 'log00']);
      expect(second.nextCursor).toBeNull();
    });

    test('filters by action', async () => {
      await seedAudit(4);
      const result = await call<{ entries: { action: string }[] }>(
        getAuditLogs, SUPPORT, { action: 'MODERATION_DISMISS' }, supportToken());
      expect(result.entries).toHaveLength(2);
      expect(result.entries.every(e => e.action === 'MODERATION_DISMISS')).toBe(true);
    });

    test('rejects combined filters and is refused to verifiers', async () => {
      await expectDomainError(
        call(getAuditLogs, SUPPORT, { action: 'X_Y', targetId: 't1' }, supportToken()), 'VALIDATION_FAILED');
      await expectDomainError(call(getAuditLogs, VERIFIER, {}, verifierToken()), 'PERMISSION_DENIED');
    });
  });

  describe('moderation', () => {
    test('the queue carries report ids, and actions must fit the target type', async () => {
      await db().doc('moderationReports/r1').set({ status: 'open', targetType: 'user', targetId: 'user1' });

      const queues = await call<{ moderationQueue: { reportId: string }[] }>(getAdminQueues, SUPPORT, {}, supportToken());
      expect(queues.moderationQueue.map(r => r.reportId)).toEqual(['r1']);

      await expectDomainError(
        call(submitModerationAction, SUPPORT, { reportId: 'r1', action: 'hide_duty', reasonCode: 'SPAM' }, supportToken()),
        'VALIDATION_FAILED');
      expect((await db().doc('moderationReports/r1').get()).data()?.status).toBe('open');

      await call(submitModerationAction, SUPPORT, { reportId: 'r1', action: 'warn_user', reasonCode: 'SPAM' }, supportToken());
      expect((await db().doc('moderationReports/r1').get()).data()?.status).toBe('resolved');
    });
  });

  describe('platform configuration', () => {
    test('offer expiry is stored where the offer worker reads it, with an audit entry', async () => {
      await call(updatePlatformConfig, SUPER,
        { configKey: 'offer_policy', configValue: { offerExpiryHours: 24 } }, superToken());

      expect(await getOfferExpiryHours()).toBe(24);
      const config = await call<{ offerPolicy: { offerExpiryHours: number; version: number } }>(
        getPlatformConfig, SUPER, {}, superToken());
      expect(config.offerPolicy).toMatchObject({ offerExpiryHours: 24, version: 1 });

      const audit = await db().collection('auditLogs').where('action', '==', 'PLATFORM_CONFIG_UPDATED').get();
      expect(audit.docs[0].data().afterSummary).toEqual({ configKey: 'offer_policy', offerExpiryHours: 24 });
    });

    test('unknown keys, extra fields and out-of-range values are rejected', async () => {
      const update = (configKey: string, configValue: unknown) =>
        call(updatePlatformConfig, SUPER, { configKey, configValue }, superToken());
      await expectDomainError(update('anything', { offerExpiryHours: 12 }), 'VALIDATION_FAILED');
      await expectDomainError(update('offer_policy', { offerExpiryHours: 0 }), 'VALIDATION_FAILED');
      await expectDomainError(update('offer_policy', { offerExpiryHours: 73 }), 'VALIDATION_FAILED');
      await expectDomainError(update('offer_policy', { offerExpiryHours: 12, extra: true }), 'VALIDATION_FAILED');
      expect((await db().doc('configuration/offer_policy').get()).exists).toBe(false);
    });

    test('trusted registry domains are validated and stored where approvals read them', async () => {
      const update = (value: unknown) => call(updatePlatformConfig, SUPER,
        { configKey: 'approved_registry_domains', configValue: { value } }, superToken());

      for (const bad of [[], ['https://registry.nmc.org.in'], ['*.gov.in'], ['Registry.NMC.org.in'],
        ['registry.nmc.org.in/path'], ['a.gov.in', 'a.gov.in'], 'registry.nmc.org.in']) {
        await expectDomainError(update(bad), 'VALIDATION_FAILED');
      }

      await update(['registry.nmc.org.in', 'tnmc.gov.in']);
      expect((await db().doc('configuration/approved_registry_domains').get()).data()?.value)
        .toEqual(['registry.nmc.org.in', 'tnmc.gov.in']);
      const config = await call<{ registryDomains: { value: string[]; version: number } }>(
        getPlatformConfig, SUPER, {}, superToken());
      expect(config.registryDomains).toMatchObject({ value: ['registry.nmc.org.in', 'tnmc.gov.in'], version: 1 });
    });

    test('only a super admin can change settings', async () => {
      await expectDomainError(
        call(updatePlatformConfig, SUPPORT, { configKey: 'offer_policy', configValue: { offerExpiryHours: 6 } }, supportToken()),
        'PERMISSION_DENIED');
      await expectDomainError(
        call(setFeatureFlag, SUPPORT, { flagKey: 'phase2_disputes_enabled', enabled: true }, supportToken()),
        'PERMISSION_DENIED');
    });

    test('feature flags are allow-listed and audited', async () => {
      await expectDomainError(
        call(setFeatureFlag, SUPER, { flagKey: 'not_a_flag', enabled: true }, superToken()), 'VALIDATION_FAILED');

      await call(setFeatureFlag, SUPER, { flagKey: 'phase2_disputes_enabled', enabled: true }, superToken());
      expect((await db().doc('featureFlags/phase2_disputes_enabled').get()).data()?.enabled).toBe(true);

      const audit = await db().collection('auditLogs').where('action', '==', 'FEATURE_FLAG_UPDATED').get();
      expect(audit.docs[0].data()).toMatchObject({
        targetId: 'phase2_disputes_enabled',
        beforeSummary: { enabled: false },
        afterSummary: { enabled: true },
      });
    });

    test('sensitive changes need a recent sign-in', async () => {
      await expectDomainError(
        call(setFeatureFlag, SUPER, { flagKey: 'phase2_disputes_enabled', enabled: true },
          { isSuperAdmin: true, auth_time: now() - 3600, ...MFA }),
        'STEP_UP_REQUIRED');
    });
  });
});
