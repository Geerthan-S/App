/** Exercises the deployed Storage rules against the local Firebase emulators. */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const runWithEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? describe : describe.skip;
const bucket = 'demo-healthforce.appspot.com';
const proof = '123e4567-e89b-42d3-a456-426614174000.pdf';

runWithEmulator('Storage evidence rules against emulator', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-healthforce',
      firestore: {
        host: '127.0.0.1',
        port: 8080,
        rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      },
      storage: {
        host: '127.0.0.1',
        port: 9199,
        rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.clearStorage();
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('verificationCases/caseA').set({
        subjectType: 'doctor', subjectId: 'doctorA', status: 'draft',
      });
    });
  });

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  const evidenceRef = (uid: string, doctorUid = 'doctorA', caseId = 'caseA', fileName = proof) =>
    env.authenticatedContext(uid).storage(`gs://${bucket}`)
      .ref(`verification/doctor/${doctorUid}/${caseId}/${fileName}`);

  test('owner can create valid case evidence, but cannot read it through the client SDK', async () => {
    const ref = evidenceRef('doctorA');
    await assertSucceeds(Promise.resolve(ref.put(new Uint8Array([1, 2, 3]), { contentType: 'application/pdf' })));
    await assertFails(ref.getMetadata());
    await assertFails(evidenceRef('verifier').getMetadata());
  });

  test('another doctor, missing case, and unsupported content are denied', async () => {
    await assertFails(Promise.resolve(evidenceRef('doctorB').put(new Uint8Array([1]), { contentType: 'application/pdf' })));
    await assertFails(Promise.resolve(evidenceRef('doctorA', 'doctorA', 'missing').put(new Uint8Array([1]), { contentType: 'application/pdf' })));
    await assertFails(Promise.resolve(evidenceRef('doctorA', 'doctorA', 'caseA', '123e4567-e89b-42d3-a456-426614174001.exe')
      .put(new Uint8Array([1]), { contentType: 'application/octet-stream' })));
    await assertFails(Promise.resolve(evidenceRef('doctorA', 'doctorA', 'caseA', 'certificate.pdf')
      .put(new Uint8Array([1]), { contentType: 'application/pdf' })));
  });

  test('approved cases cannot receive new evidence', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('verificationCases/caseA').update({ status: 'approved' });
    });
    await assertFails(Promise.resolve(evidenceRef('doctorA')
      .put(new Uint8Array([1]), { contentType: 'application/pdf' })));
  });

  test('organization evidence requires a matching case, admin role, and uploader metadata', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('verificationCases/orgCase').set({
        subjectType: 'organization', subjectId: 'orgA', status: 'draft',
      });
      await context.firestore().doc('organizations/orgA/members/doctorA').set({ role: 'owner' });
    });
    const path = `verification/organization/orgA/orgCase/${proof}`;
    const owner = env.authenticatedContext('doctorA').storage(`gs://${bucket}`).ref(path);
    await assertFails(Promise.resolve(owner.put(new Uint8Array([1]), { contentType: 'application/pdf' })));
    await assertFails(Promise.resolve(env.authenticatedContext('doctorB').storage(`gs://${bucket}`).ref(path)
      .put(new Uint8Array([1]), { contentType: 'application/pdf', customMetadata: { uploadedBy: 'doctorB' } })));
    await assertSucceeds(Promise.resolve(owner.put(new Uint8Array([1]), {
      contentType: 'application/pdf', customMetadata: { uploadedBy: 'doctorA' },
    })));
    await assertFails(owner.getMetadata());
  });

  test('dispute evidence remains disabled', async () => {
    const storage = env.authenticatedContext('doctorA').storage(`gs://${bucket}`);
    await assertFails(Promise.resolve(storage.ref('disputes/disputeA/proof.pdf')
      .put(new Uint8Array([1]), { contentType: 'application/pdf' })));
  });

  test('doctor credentials and user roles cannot be edited through Firestore client', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('doctors/doctorA').set({
        userId: 'doctorA', registrationNo: 'TN123', isVerified: true,
      });
      await context.firestore().doc('users/doctorA').set({ uid: 'doctorA', activeRole: 'doctor' });
    });
    const doctor = env.authenticatedContext('doctorA').firestore();
    await assertSucceeds(doctor.doc('doctors/doctorA').get());
    await assertFails(doctor.doc('doctors/doctorA').update({ registrationNo: 'TN999' }));
    await assertFails(doctor.doc('users/doctorA').update({ activeRole: 'hospital_staff' }));
    await assertFails(env.authenticatedContext('doctorB').firestore().doc('doctors/doctorA').get());
  });

  test('organization data and memberships remain server-owned and tenant-scoped', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('organizations/orgA').set({ organizationId: 'orgA', verificationState: 'draft' });
      await context.firestore().doc('organizations/orgA/members/doctorA').set({ role: 'owner' });
    });
    const owner = env.authenticatedContext('doctorA').firestore();
    await assertSucceeds(owner.doc('organizations/orgA').get());
    await assertFails(owner.doc('organizations/orgA').update({ verificationState: 'approved' }));
    await assertFails(owner.doc('organizations/orgA/members/doctorB').set({ role: 'owner' }));
    await assertFails(env.authenticatedContext('doctorB').firestore().doc('organizations/orgA').get());
  });
});
