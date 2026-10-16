/** Exercises the deployed Firestore rules against the local emulator. */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const runWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

runWithEmulator('Firestore rules against emulator', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-healthforce',
      firestore: {
        host,
        port: Number(port),
        rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc('organizations/orgA').set({ displayName: 'A' });
      await db.doc('organizations/orgA/members/staffA').set({ role: 'owner', status: 'active' });
      await db.doc('organizations/orgA/members/legacyStaff').set({ role: 'admin' });
      await db.doc('organizations/orgA/members/removedStaff').set({ role: 'admin', status: 'removed' });
      await db.doc('duties/dutyA').set({ organizationId: 'orgA', status: 'published' });
      await db.doc('duties/dutyA/applications/doctorA').set({ doctorId: 'doctorA', status: 'submitted', snapshotRef: 'snapA' });
      await db.doc('applicationSnapshots/snapA').set({ dutyId: 'dutyA', doctorId: 'doctorA' });
      await db.doc('assignments/asgA').set({ organizationId: 'orgA', doctorId: 'doctorA', status: 'confirmed' });
      await db.doc('feedback/fbA').set({ authorId: 'doctorA', targetId: 'orgA', targetType: 'organization' });
      await db.doc('deviceTokens/tokA').set({ uid: 'doctorA', token: 't', enabled: true });
    });
  });

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  const as = (uid: string) => env.authenticatedContext(uid).firestore();

  test('active and legacy members read their applicants; removed members and outsiders cannot', async () => {
    const query = (uid: string) => as(uid).collection('duties/dutyA/applications')
      .where('status', 'in', ['submitted', 'shortlisted']).get();
    await assertSucceeds(query('staffA'));
    await assertSucceeds(query('legacyStaff'));
    await assertSucceeds(as('staffA').doc('applicationSnapshots/snapA').get());
    await assertFails(query('removedStaff'));
    await assertFails(query('outsider'));
  });

  test('a removed member loses tenant assignment access', async () => {
    await assertSucceeds(as('staffA').collection('assignments').where('organizationId', '==', 'orgA').get());
    await assertFails(as('removedStaff').collection('assignments').where('organizationId', '==', 'orgA').get());
  });

  test('organization members read reviews of their organization', async () => {
    await assertSucceeds(as('staffA').collection('feedback')
      .where('targetId', '==', 'orgA').where('targetType', '==', 'organization').get());
    await assertFails(as('outsider').doc('feedback/fbA').get());
  });

  test('device tokens and registration reservations are server-owned', async () => {
    await assertSucceeds(as('doctorA').doc('deviceTokens/tokA').get());
    await assertFails(as('doctorA').doc('deviceTokens/tokB').set({ uid: 'doctorA', token: 'x', enabled: true }));
    await assertFails(as('doctorB').doc('deviceTokens/tokA').get());
    await assertFails(as('doctorA').doc('registrationReservations/X').get());
    await assertFails(as('doctorA').doc('users/doctorA').set({ fcmToken: 'x' }, { merge: true }));
  });

  test('phase 2 availability cannot be written directly, bypassing the feature flag', async () => {
    await assertFails(as('doctorA').doc('availabilityRules/r1').set({ doctorId: 'doctorA', recurrence: 'daily' }));
  });
});
