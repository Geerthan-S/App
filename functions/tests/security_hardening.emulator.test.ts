/**
 * Regression tests for rule gaps found in the Firebase security-rules audit.
 * Each hole is refused, and the legitimate path next to it still works.
 * Run with: npm run test:emulator
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { emulatorAddress } from './helpers/emulator';

const runWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const bucket = 'demo-healthforce.appspot.com';
const evidenceName = '123e4567-e89b-42d3-a456-426614174000.pdf';

runWithEmulator('security hardening', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-healthforce',
      firestore: { ...emulatorAddress('FIRESTORE_EMULATOR_HOST', 8080), rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
      storage: { ...emulatorAddress('FIREBASE_STORAGE_EMULATOR_HOST', 9199), rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8') },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.clearStorage();
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc('organizations/orgA/members/activeOwner').set({ role: 'owner', status: 'active' });
      await db.doc('organizations/orgA/members/removedOwner').set({ role: 'owner', status: 'removed' });
      await db.doc('verificationCases/caseOrg').set({ subjectType: 'organization', subjectId: 'orgA', status: 'draft' });
      await db.doc('reliabilitySnapshots/doctorA').set({ doctorId: 'doctorA', score: 0.42 });
      await db.doc('inboxNotifications/n1').set({ userId: 'doctorA', isRead: false, readAt: null });
      await db.doc('moderationReports/r1').set({ reporterId: 'doctorA', status: 'open', targetType: 'duty', targetId: 'dutyA' });
    });
  });

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  const fs = (uid: string, token: Record<string, unknown> = {}) => env.authenticatedContext(uid, token).firestore();
  const now = () => firebase.firestore.FieldValue.serverTimestamp();

  describe('moderation reports', () => {
    const report = (overrides: Record<string, unknown> = {}) => ({
      reporterId: 'doctorA',
      targetType: 'duty',
      targetId: 'dutyA',
      reason: 'Misleading pay',
      status: 'open',
      createdAt: now(),
      ...overrides,
    });

    test('even a well-formed report cannot be written directly (it must go through the rate-limited callable)', async () => {
      await assertFails(fs('doctorA').doc('moderationReports/new').set(report({ details: 'Pay listed twice' })));
    });

    test('the reporter can still read their own report', async () => {
      await assertSucceeds(fs('doctorA').doc('moderationReports/r1').get());
      await assertFails(fs('doctorB').doc('moderationReports/r1').get());
    });

    test('server-only operational collections are closed to every client', async () => {
      const support = fs('supportA', { isSupportAdmin: true, isSuperAdmin: true });
      for (const path of ['rateLimits/x', 'moderationReportLocks/x', 'staffDirectory/x', 'supportCases/x']) {
        await assertFails(support.doc(path).get());
        await assertFails(support.doc(path).set({ forged: true }));
      }
    });

    test('forged status, admin fields, oversized text and bad targets are refused', async () => {
      const db = fs('doctorA');
      await assertFails(db.doc('moderationReports/a').set(report({ status: 'resolved' })));
      await assertFails(db.doc('moderationReports/b').set(report({ resolvedBy: 'admin', actionTaken: 'suspend_user' })));
      await assertFails(db.doc('moderationReports/c').set(report({ reason: 'x'.repeat(201) })));
      await assertFails(db.doc('moderationReports/d').set(report({ details: 'x'.repeat(2001) })));
      await assertFails(db.doc('moderationReports/e').set(report({ targetType: 'organization' })));
      await assertFails(db.doc('moderationReports/f').set(report({ targetType: 'user', targetId: 'doctorA' })));
      await assertFails(db.doc('moderationReports/g').set(report({ reporterId: 'doctorB' })));
      await assertFails(db.doc('moderationReports/h').set(report({ createdAt: new Date(0) })));
    });

    test('nobody resolves or deletes reports outside the audited callable', async () => {
      const support = fs('supportA', { isSupportAdmin: true });
      await assertFails(support.doc('moderationReports/r1').update({ status: 'resolved' }));
      await assertFails(support.doc('moderationReports/r1').delete());
      await assertFails(fs('doctorA').doc('moderationReports/r1').update({ status: 'resolved' }));
    });
  });

  test('platform settings cannot be written directly, even by a super admin', async () => {
    const admin = fs('superA', { isSuperAdmin: true });
    await assertFails(admin.doc('configuration/offer_policy').set({ offerExpiryHours: 'never' }));
    await assertFails(admin.doc('configuration/approved_registry_domains').set({ value: ['evil.example'] }));
    await assertFails(admin.doc('featureFlags/phase2_disputes_enabled').set({ enabled: true }));
    await assertFails(admin.doc('appVersions/v9').set({ minimum: true }));
    await assertSucceeds(fs('doctorA').doc('configuration/offer_policy').get());
  });

  test('reliability snapshots are private to the doctor and support staff', async () => {
    await assertSucceeds(fs('doctorA').doc('reliabilitySnapshots/doctorA').get());
    await assertSucceeds(fs('supportA', { isSupportAdmin: true }).doc('reliabilitySnapshots/doctorA').get());
    await assertFails(fs('doctorB').doc('reliabilitySnapshots/doctorA').get());
  });

  test('notifications can only be marked read, with the server time', async () => {
    const db = fs('doctorA');
    await assertFails(db.doc('inboxNotifications/n1').update({ isRead: 'x'.repeat(10_000) }));
    await assertFails(db.doc('inboxNotifications/n1').update({ isRead: true, readAt: new Date(0) }));
    await assertFails(fs('doctorB').doc('inboxNotifications/n1').update({ isRead: true, readAt: now() }));
    await assertSucceeds(db.doc('inboxNotifications/n1').update({ isRead: true, readAt: now() }));
  });

  test('removed organization owners lose upload access; active owners keep it', async () => {
    const upload = (uid: string, path: string, contentType: string) => Promise.resolve(
      env.authenticatedContext(uid).storage(`gs://${bucket}`).ref(path)
        .put(new Uint8Array([1, 2, 3]), { contentType, customMetadata: { uploadedBy: uid } }));

    await assertFails(upload('removedOwner', `verification/organization/orgA/caseOrg/${evidenceName}`, 'application/pdf'));
    await assertFails(upload('removedOwner', 'public/branding/orgA/logo.png', 'image/png'));
    await assertSucceeds(upload('activeOwner', `verification/organization/orgA/caseOrg/${evidenceName}`, 'application/pdf'));
    await assertSucceeds(upload('activeOwner', 'public/branding/orgA/logo.png', 'image/png'));
  });
});
