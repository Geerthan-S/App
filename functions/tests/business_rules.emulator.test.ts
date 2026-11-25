/** Firestore rules for the business modules, against the emulator. */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';

const runWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

runWithEmulator('business module rules', () => {
  let env: RulesTestEnvironment;
  const future = Date.now() + 30 * 24 * 3600 * 1000;

  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-healthforce',
      firestore: { host, port: Number(port), rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc('organizations/o1/members/staff1').set({ role: 'owner', status: 'active' });
      await db.doc('duties/early').set({ organizationId: 'o1', status: 'early_access' });
      await db.doc('duties/open').set({ organizationId: 'o1', status: 'published' });
      await db.doc('subscriptions/premiumDoc').set({ premiumUntilMs: future });
      await db.doc('subscriptions/expiredDoc').set({ premiumUntilMs: Date.now() - 1000 });
      await db.doc('standbyPool/premiumDoc').set({ dates: ['2026-12-01'] });
      await db.doc('attendance/a1').set({ doctorId: 'doc1', organizationId: 'o1' });
      await db.doc('paymentOrders/p1').set({ payerUid: null, doctorId: 'doc1', organizationId: 'o1' });
      await db.doc('channels/c1').set({ visibility: 'public', status: 'active' });
      await db.doc('channels/c2').set({ visibility: 'private', status: 'active' });
      await db.doc('channels/c1/members/member1').set({ role: 'member' });
      await db.doc('channels/c1/messages/m1').set({ text: 'hi' });
      await db.doc('channels/c2/private/invite').set({ code: 'ABC123' });
      await db.doc('aiThreads/doc1/messages/q1').set({ text: 'question' });
    });
  });

  afterAll(async () => { await env.cleanup(); });

  const as = (uid: string) => env.authenticatedContext(uid).firestore();

  test('early-access duties are visible to active premium members only', async () => {
    await assertSucceeds(as('premiumDoc').doc('duties/early').get());
    await assertFails(as('expiredDoc').doc('duties/early').get());
    await assertFails(as('plainDoc').doc('duties/early').get());
    await assertSucceeds(as('plainDoc').doc('duties/open').get());
    await assertSucceeds(as('staff1').doc('duties/early').get());
    await assertSucceeds(as('plainDoc').collection('duties').where('status', '==', 'published').get());
    await assertFails(as('plainDoc').collection('duties').where('status', '==', 'early_access').get());
    await assertSucceeds(as('premiumDoc').collection('duties').where('status', 'in', ['early_access', 'published']).get());
  });

  test('the standby pool is private to each doctor; subscriptions cannot be self-granted', async () => {
    await assertSucceeds(as('premiumDoc').doc('standbyPool/premiumDoc').get());
    await assertFails(as('staff1').doc('standbyPool/premiumDoc').get());
    await assertFails(as('plainDoc').collection('standbyPool').get());
    await assertFails(as('plainDoc').doc('subscriptions/plainDoc').set({ premiumUntilMs: future }));
    await assertFails(as('plainDoc').doc('standbyPool/plainDoc').set({ dates: ['2026-12-01'] }));
  });

  test('attendance and payment orders are visible to the two parties only', async () => {
    await assertSucceeds(as('doc1').doc('attendance/a1').get());
    await assertSucceeds(as('staff1').doc('attendance/a1').get());
    await assertFails(as('doc2').doc('attendance/a1').get());
    await assertFails(as('doc1').doc('attendance/a1').update({ needsAcknowledgement: false }));
    await assertSucceeds(as('staff1').doc('paymentOrders/p1').get());
    await assertFails(as('doc2').doc('paymentOrders/p1').get());
    await assertFails(as('doc2').collection('attendanceCodes').get());
    await assertFails(as('staff1').collection('ledgerEntries').get());
  });

  test('channel messages are for members; invite codes are never readable', async () => {
    await assertSucceeds(as('outsider').doc('channels/c1').get());
    await assertFails(as('outsider').doc('channels/c2').get());
    await assertSucceeds(as('member1').doc('channels/c1/messages/m1').get());
    await assertFails(as('outsider').doc('channels/c1/messages/m1').get());
    await assertFails(as('member1').collection('channels/c1/messages').add({ text: 'direct write' }));
    await assertFails(as('member1').doc('channels/c2/private/invite').get());
  });

  test('AI conversations are private to the doctor', async () => {
    await assertSucceeds(as('doc1').doc('aiThreads/doc1/messages/q1').get());
    await assertFails(as('doc2').doc('aiThreads/doc1/messages/q1').get());
  });
});
