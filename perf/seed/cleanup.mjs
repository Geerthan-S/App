/**
 * Removes every load-test user and document, in the emulator or the cloud
 * project. Seeded documents have `loadtest_` IDs; documents the backend
 * created during a test run (auto IDs) are found through the load-test user,
 * organization or duty they reference.
 *
 *   node seed/cleanup.mjs                                     (emulator)
 *   node seed/cleanup.mjs --target cloud --confirm doctor-c7c29
 */

import { pathToFileURL } from 'node:url';
import { FieldPath } from 'firebase-admin/firestore';
import { PREFIX, RESERVATION_PREFIX, resolveTarget, db, auth } from './target.mjs';

/** Top-level collections whose seeded documents carry a prefixed ID. Subcollections go with them. */
const ID_PREFIXED = [
  ['users', PREFIX],
  ['doctors', PREFIX],
  ['organizations', PREFIX],
  ['duties', PREFIX],
  ['registrationReservations', RESERVATION_PREFIX],
];

/** Backend-generated documents, matched on the field that references a load-test entity. */
const FIELD_PREFIXED = [
  ['applicationSnapshots', 'doctorId'],
  ['assignments', 'doctorId'],
  ['assignmentEvents', 'doctorId'],
  ['doctorSchedules', 'doctorId'],
  ['contactGrants', 'doctorId'],
  ['completionRecords', 'doctorId'],
  ['auditLogs', 'actorId'],
  ['inboxNotifications', 'userId'],
  ['deviceTokens', 'uid'],
  ['feedback', 'authorId'],
  ['notificationOutbox', 'targetUserId'],
  ['notificationOutbox', 'targetOrganizationId'],
];

/** Upper bound for a prefix range: the character after the prefix's last one. */
const prefixEnd = (prefix) => prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);

const PAGE = 400;

const deleteByQuery = async (buildQuery, onDoc) => {
  let deleted = 0;
  for (;;) {
    const snap = await buildQuery().limit(PAGE).get();
    if (snap.empty) return deleted;
    const writer = db().bulkWriter();
    snap.docs.forEach(doc => onDoc?.(doc));
    await Promise.all(snap.docs.map(doc => db().recursiveDelete(doc.ref, writer)));
    await writer.close();
    deleted += snap.size;
  }
};

const cleanFirestore = async () => {
  const counts = {};
  const outboxIds = [];

  for (const [collection, prefix] of ID_PREFIXED) {
    const n = await deleteByQuery(() => db().collection(collection)
      .where(FieldPath.documentId(), '>=', prefix)
      .where(FieldPath.documentId(), '<', prefixEnd(prefix)));
    counts[collection] = (counts[collection] ?? 0) + n;
  }

  for (const [collection, field] of FIELD_PREFIXED) {
    const n = await deleteByQuery(
      () => db().collection(collection).where(field, '>=', PREFIX).where(field, '<', prefixEnd(PREFIX)),
      collection === 'notificationOutbox' ? doc => outboxIds.push(doc.id) : undefined
    );
    counts[collection] = (counts[collection] ?? 0) + n;
  }

  // Delivery attempts only reference their outbox event.
  let attempts = 0;
  for (let i = 0; i < outboxIds.length; i += 30) {
    const chunk = outboxIds.slice(i, i + 30);
    attempts += await deleteByQuery(() => db().collection('deliveryAttempts').where('outboxId', 'in', chunk));
  }
  counts.deliveryAttempts = attempts;
  return counts;
};

const cleanAuth = async () => {
  let removed = 0;
  let pageToken;
  const uids = [];
  do {
    const page = await auth().listUsers(1000, pageToken);
    uids.push(...page.users.map(u => u.uid).filter(uid => uid.startsWith(PREFIX)));
    pageToken = page.pageToken;
  } while (pageToken);
  for (let i = 0; i < uids.length; i += 1000) {
    const result = await auth().deleteUsers(uids.slice(i, i + 1000));
    removed += result.successCount;
    if (result.failureCount) console.warn(`  ${result.failureCount} auth deletions failed`);
  }
  return removed;
};

export const cleanup = async () => {
  const firestore = await cleanFirestore();
  const authUsers = await cleanAuth();
  return { authUsers, firestore };
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { target, projectId } = await resolveTarget();
  console.log(`Cleaning load-test data from ${target} (${projectId})...`);
  const { authUsers, firestore } = await cleanup();
  console.log(`  auth users deleted: ${authUsers}`);
  for (const [collection, n] of Object.entries(firestore)) {
    if (n) console.log(`  ${collection}: ${n}`);
  }
  console.log('Done.');
}
