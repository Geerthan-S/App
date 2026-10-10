/**
 * Looks for any load-test data left after clean-up: scans every document in
 * every top-level collection for a `loadtest_` / `LOADTEST_` ID or top-level
 * string field, plus delivery attempts whose outbox event is gone.
 * Independent of cleanup.mjs's collection list, so it also catches
 * collections clean-up does not know about. Exits 1 if anything is found.
 *
 *   node seed/leftovers.mjs                                     (emulator)
 *   node seed/leftovers.mjs --target cloud --confirm doctor-c7c29
 */

import { PREFIX, RESERVATION_PREFIX, resolveTarget, db } from './target.mjs';

const isTest = (value) => typeof value === 'string' && (value.startsWith(PREFIX) || value.startsWith(RESERVATION_PREFIX));
const PAGE = 1000;

const { target, projectId } = await resolveTarget();
console.log(`Scanning ${target} (${projectId}) for load-test leftovers...`);

let scanned = 0;
const found = {};
for (const collection of await db().listCollections()) {
  let last;
  for (;;) {
    let query = collection.orderBy('__name__').limit(PAGE);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data();
      // Delivery attempts carry no load-test ID, only their outbox event; one whose event is gone is an orphan.
      const orphan = collection.id === 'deliveryAttempts' && data.outboxId
        && !(await db().collection('notificationOutbox').doc(data.outboxId).get()).exists;
      if (orphan || isTest(doc.id) || Object.values(data).some(isTest)) {
        (found[collection.id] ??= []).push(doc.id);
      }
    }
    last = snap.docs[snap.docs.length - 1];
  }
}

console.log(`  documents scanned: ${scanned}`);
const collections = Object.keys(found);
if (collections.length) {
  console.log('FAIL: load-test data remains');
  for (const c of collections) console.log(`  ${c}: ${found[c].length} (e.g. ${found[c].slice(0, 3).join(', ')})`);
  process.exit(1);
}
console.log('PASS: no load-test data left');
