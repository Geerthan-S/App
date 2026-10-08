/** Shared setup for tests that run production handlers against the Firestore emulator. */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { HttpsError } from 'firebase-functions/v2/https';

export const PROJECT_ID = 'demo-healthforce';

export const hasFirestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
export const describeWithEmulator = hasFirestoreEmulator ? describe : describe.skip;

export const adminDb = (): Firestore => {
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  return getFirestore();
};

export const clearFirestore = async (): Promise<void> => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!response.ok) throw new Error(`Could not clear emulator: ${response.status}`);
};

interface Runnable { run: (request: unknown) => unknown }

/** Invokes a callable exactly as the transport does: through the shared boundary wrapper. */
export const call = async <T = Record<string, unknown>>(
  fn: unknown,
  uid: string | null,
  data: Record<string, unknown>,
  token: Record<string, unknown> = {}
): Promise<T> => {
  const request = { data, auth: uid ? { uid, token: { uid, ...token } } : undefined, rawRequest: {} };
  return (await (fn as Runnable).run(request)) as T;
};

/** Asserts a callable failed with the given domain code, as a client would see it. */
export const expectDomainError = async (promise: Promise<unknown>, domainCode: string, transportCode?: string) => {
  let caught: HttpsError | undefined;
  try {
    await promise;
  } catch (error) {
    caught = error as HttpsError;
  }
  expect(caught).toBeDefined();
  expect(caught!.constructor.name).toBe('HttpsError');
  expect((caught!.details as { code?: string })?.code).toBe(domainCode);
  if (transportCode) expect(caught!.code).toBe(transportCode);
};

export const verifierToken = () => ({ isVerifier: true, auth_time: Math.floor(Date.now() / 1000) });

export const CONSENT = { consentVersion: 'v1.0_2026', status: 'active' };

export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();
export const HOUR = 60 * 60 * 1000;
