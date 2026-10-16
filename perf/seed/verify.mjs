/**
 * Checks booking integrity after a load run: every load-test duty's seats add
 * up, and no load-test doctor holds two live assignments for overlapping
 * shifts. Exits 1 if anything is wrong.
 *
 *   node seed/verify.mjs                                     (emulator)
 *   node seed/verify.mjs --target cloud --confirm doctor-c7c29
 */

import { PREFIX, resolveTarget, db } from './target.mjs';

/** Assignments that hold a seat; cancelled and expired ones give it back. */
const LIVE = new Set(['selected', 'confirmed', 'in_progress', 'completed']);

const prefixEnd = (prefix) => prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
const millis = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : Date.parse(t));

const { target, projectId } = await resolveTarget();
console.log(`Verifying booking integrity on ${target} (${projectId})...`);

const inLoadTest = (collection, field) =>
  db().collection(collection).where(field, '>=', PREFIX).where(field, '<', prefixEnd(PREFIX)).get();

const [dutySnap, assignmentSnap] = await Promise.all([
  inLoadTest('duties', 'organizationId'),
  inLoadTest('assignments', 'doctorId'),
]);

const problems = [];
const liveByDuty = new Map();
const liveByDoctor = new Map();
const statusCounts = {};

for (const doc of assignmentSnap.docs) {
  const a = doc.data();
  statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1;
  if (!LIVE.has(a.status)) continue;
  liveByDuty.set(a.dutyId, (liveByDuty.get(a.dutyId) ?? 0) + 1);
  const list = liveByDoctor.get(a.doctorId) ?? [];
  list.push({ id: doc.id, start: millis(a.termsSnapshot?.startAt), end: millis(a.termsSnapshot?.endAt) });
  liveByDoctor.set(a.doctorId, list);
}

for (const doc of dutySnap.docs) {
  const d = doc.data();
  const live = liveByDuty.get(doc.id) ?? 0;
  if (live > d.headcount) problems.push(`duty ${doc.id}: ${live} live assignments for ${d.headcount} seats`);
  if (d.remainingHeadcount !== d.headcount - live) {
    problems.push(`duty ${doc.id}: remainingHeadcount ${d.remainingHeadcount}, expected ${d.headcount - live}`);
  }
  if (d.remainingHeadcount === 0 && d.status === 'published') problems.push(`duty ${doc.id}: no seats left but still published`);
}

for (const [doctorId, shifts] of liveByDoctor) {
  shifts.sort((x, y) => x.start - y.start);
  for (let i = 1; i < shifts.length; i++) {
    if (shifts[i].start < shifts[i - 1].end) {
      problems.push(`doctor ${doctorId}: overlapping live assignments ${shifts[i - 1].id} and ${shifts[i].id}`);
    }
  }
}

console.log(`  duties checked: ${dutySnap.size}`);
console.log(`  assignments by status: ${JSON.stringify(statusCounts)}`);
console.log(`  doctors with live assignments: ${liveByDoctor.size}`);
if (problems.length) {
  console.log(`FAIL: ${problems.length} problem(s)`);
  problems.slice(0, 50).forEach(p => console.log(`  - ${p}`));
  process.exit(1);
}
console.log('PASS: seats add up and no doctor is double-booked');
