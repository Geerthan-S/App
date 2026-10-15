/**
 * The open verification queue with everything a reviewer needs to triage it:
 * subject name, SLA due time, assignee, escalation, and integrity flags.
 *
 * Used by the queue callable, the admin dashboard and the attention center so
 * all three agree on what is overdue.
 */

import type { DocumentData } from 'firebase-admin/firestore';
import { db } from '../shared/firestoreHelpers';
import { getVerificationPolicy } from '../shared/platformConfig';
import { HOUR_MS, subjectNameOf, toIso, toMillis } from '../admin/adminShared';
import { REVIEWABLE_CASE_STATUSES } from './verificationStates';

/** Within this window an open case counts as "due soon". */
export const SLA_DUE_SOON_MS = 4 * HOUR_MS;

export type SlaState = 'overdue' | 'due_soon' | 'on_track' | 'waiting_on_applicant';

export interface QueueEntry {
  caseId: string;
  subjectType: 'doctor' | 'organization';
  subjectId: string;
  subjectName: string | null;
  registrationNo: string | null;
  council: string | null;
  status: string;
  submittedAt: string | null;
  updatedAt: string | null;
  slaDueAt: string | null;
  slaState: SlaState;
  assigneeId: string | null;
  assigneeName: string | null;
  escalated: boolean;
  escalationReason: string | null;
  escalatedAt: string | null;
  evidenceCount: number;
  flags: {
    /** The profile changed after the case was opened; it cannot be approved. */
    stale: boolean;
    /** A previous case for this subject exists (resubmission). */
    repeat: boolean;
    /** At least one document has not been scanned clean. */
    evidencePending: boolean;
    noEvidence: boolean;
  };
}

const subjectCollection = (subjectType: string) => (subjectType === 'doctor' ? 'doctors' : 'organizations');
const revisionOf = (data: DocumentData | undefined, field: string): number =>
  typeof data?.[field] === 'number' ? data[field] : 1;

const chunks = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** Waiting-on-applicant cases are paused: the SLA clock belongs to the applicant. */
export const slaStateOf = (status: string, slaDueMs: number | null, nowMs: number): SlaState => {
  if (status === 'needs_information') return 'waiting_on_applicant';
  if (slaDueMs === null) return 'on_track';
  if (slaDueMs <= nowMs) return 'overdue';
  if (slaDueMs - nowMs <= SLA_DUE_SOON_MS) return 'due_soon';
  return 'on_track';
};

export const loadReviewQueue = async (nowMs = Date.now()): Promise<QueueEntry[]> => {
  const [snap, policy] = await Promise.all([
    db().collection('verificationCases').where('status', 'in', REVIEWABLE_CASE_STATUSES).limit(300).get(),
    getVerificationPolicy(),
  ]);
  const cases = snap.docs.map(doc => ({ ...doc.data(), caseId: doc.id }) as DocumentData & { caseId: string });
  if (!cases.length) return [];

  const subjectRefs = cases.map(c => db().collection(subjectCollection(c.subjectType)).doc(String(c.subjectId)));
  const assigneeIds = [...new Set(cases.map(c => c.assigneeId).filter((id): id is string => typeof id === 'string'))];
  const [subjects, assignees, evidenceSnaps] = await Promise.all([
    db().getAll(...subjectRefs),
    assigneeIds.length ? db().getAll(...assigneeIds.map(id => db().collection('staffDirectory').doc(id))) : [],
    Promise.all(chunks(cases.map(c => c.caseId), 30).map(ids =>
      db().collection('verificationDocuments').where('caseId', 'in', ids).select('caseId', 'scanStatus').get())),
  ]);

  const assigneeNames = new Map(assignees.map(a => [a.id, a.data()?.displayName ?? a.data()?.email ?? null]));
  const evidence = new Map<string, { total: number; pending: number }>();
  for (const doc of evidenceSnaps.flatMap(s => s.docs)) {
    const entry = evidence.get(doc.data().caseId) ?? { total: 0, pending: 0 };
    entry.total += 1;
    if (doc.data().scanStatus !== 'clean') entry.pending += 1;
    evidence.set(doc.data().caseId, entry);
  }

  return cases.map((c, i): QueueEntry => {
    const subject = subjects[i]?.data();
    const submittedMs = toMillis(c.submittedAt);
    const slaDueMs = submittedMs === null ? null : submittedMs + policy.slaHours * HOUR_MS;
    const ev = evidence.get(c.caseId) ?? { total: 0, pending: 0 };
    return {
      caseId: c.caseId,
      subjectType: c.subjectType === 'organization' ? 'organization' : 'doctor',
      subjectId: String(c.subjectId),
      subjectName: subjectNameOf(subject),
      registrationNo: subject?.registrationNo ?? subject?.registrationNumber ?? null,
      council: subject?.council ?? null,
      status: c.status,
      submittedAt: toIso(c.submittedAt),
      updatedAt: toIso(c.updatedAt),
      slaDueAt: slaDueMs === null ? null : new Date(slaDueMs).toISOString(),
      slaState: slaStateOf(c.status, slaDueMs, nowMs),
      assigneeId: c.assigneeId ?? null,
      assigneeName: c.assigneeId ? assigneeNames.get(c.assigneeId) ?? null : null,
      escalated: c.escalated === true,
      escalationReason: c.escalationReason ?? null,
      escalatedAt: toIso(c.escalatedAt),
      evidenceCount: ev.total,
      flags: {
        stale: !subject || subject.verificationCaseId !== c.caseId ||
          revisionOf(subject, 'profileRevision') !== revisionOf(c, 'subjectRevision'),
        repeat: Boolean(c.previousCaseId),
        evidencePending: ev.pending > 0,
        noEvidence: ev.total === 0,
      },
    };
  }).sort((a, b) =>
    Number(b.escalated) - Number(a.escalated) ||
    (a.slaDueAt ?? '9999').localeCompare(b.slaDueAt ?? '9999'));
};
