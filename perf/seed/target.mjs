/**
 * Resolves which backend a perf script talks to and initializes the Admin SDK.
 *
 *   (default)                              -> local emulator, project demo-healthforce
 *   --target cloud --confirm doctor-c7c29  -> the real Firebase project
 *
 * The emulator uses a `demo-` project ID, which the Firebase tooling guarantees
 * never reaches real Google services. Cloud mode demands the project ID twice so
 * it cannot be selected by accident.
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const PREFIX = 'loadtest_';
/** Registration reservations are keyed by an upper-cased normalized number. */
export const RESERVATION_PREFIX = 'LOADTEST_';

const EMULATOR_PROJECT = 'demo-healthforce';
const CLOUD_PROJECT = 'doctor-c7c29';
const FIRESTORE_EMULATOR = '127.0.0.1:8080';
const AUTH_EMULATOR = '127.0.0.1:9099';

const argValue = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

export const resolveTarget = async () => {
  const target = argValue('--target') ?? 'emulator';

  if (target === 'emulator') {
    process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR;
    try {
      await fetch(`http://${FIRESTORE_EMULATOR}/`);
      await fetch(`http://${AUTH_EMULATOR}/`);
    } catch {
      throw new Error('Emulators are not running. Start them first with: npm run emulators');
    }
    initializeApp({ projectId: EMULATOR_PROJECT });
    return { target, projectId: EMULATOR_PROJECT };
  }

  if (target === 'cloud') {
    if (argValue('--confirm') !== CLOUD_PROJECT) {
      throw new Error(`Cloud mode writes to the real project. Re-run with: --target cloud --confirm ${CLOUD_PROJECT}`);
    }
    if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new Error('Emulator environment variables are set; unset them before targeting the cloud project.');
    }
    // Credentials come from Application Default Credentials
    // (`gcloud auth application-default login`) or GOOGLE_APPLICATION_CREDENTIALS.
    initializeApp({ projectId: CLOUD_PROJECT });
    return { target, projectId: CLOUD_PROJECT };
  }

  throw new Error(`Unknown --target "${target}". Use "emulator" or "cloud".`);
};

export const db = () => getFirestore();
export const auth = () => getAuth();

/** Runs `worker` over `items` with at most `limit` in flight. */
export const pool = async (items, limit, worker) => {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
};
