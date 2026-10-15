/**
 * Derived dashboard figures: SLA performance, 7-day verification throughput,
 * active cities and registry coverage. Everything is computed from stored
 * timestamps; nothing is estimated.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../shared/firestoreHelpers';
import { getVerificationPolicy } from '../shared/platformConfig';
import { loadReviewQueue } from '../verification/reviewQueue';
import { DAY_MS, HOUR_MS, istDayKey, toMillis } from './adminShared';

/** Duty states that occupy a city's market right now. */
const LIVE_DUTY_STATUSES = ['published', 'filled', 'in_progress'];
const DECIDED_STATUSES = ['approved', 'rejected', 'needs_information'];
const SLA_WINDOW_DAYS = 30;

export const dashboardInsights = async (nowMs = Date.now()) => {
  const policy = await getVerificationPolicy();
  const windowStart = Timestamp.fromMillis(nowMs - SLA_WINDOW_DAYS * DAY_MS);
  const weekStartMs = nowMs - 6 * DAY_MS;

  const [queue, decided, submitted, liveDuties, registry] = await Promise.all([
    loadReviewQueue(nowMs),
    db().collection('verificationCases').where('decidedAt', '>=', windowStart).limit(2000).get(),
    db().collection('verificationCases').where('submittedAt', '>=', Timestamp.fromMillis(nowMs - 7 * DAY_MS)).limit(2000).get(),
    db().collection('duties').where('status', 'in', LIVE_DUTY_STATUSES).select('city').limit(5000).get(),
    db().collection('configuration').doc('approved_registry_domains').get(),
  ]);

  // SLA compliance: decisions in the window made within the SLA of their submission.
  let decidedWithinSla = 0;
  let decidedTotal = 0;
  for (const doc of decided.docs) {
    const c = doc.data();
    const submittedMs = toMillis(c.submittedAt);
    const decidedMs = toMillis(c.decidedAt);
    if (!DECIDED_STATUSES.includes(c.status) || submittedMs === null || decidedMs === null) continue;
    decidedTotal += 1;
    if (decidedMs - submittedMs <= policy.slaHours * HOUR_MS) decidedWithinSla += 1;
  }

  // 7-day trend in India time, oldest first.
  const days = Array.from({ length: 7 }, (_, i) => istDayKey(weekStartMs + i * DAY_MS));
  const trend = Object.fromEntries(days.map(day => [day, { submitted: 0, decided: 0, approved: 0 }]));
  for (const doc of submitted.docs) {
    const day = istDayKey(toMillis(doc.data().submittedAt) ?? 0);
    if (trend[day]) trend[day].submitted += 1;
  }
  for (const doc of decided.docs) {
    const day = istDayKey(toMillis(doc.data().decidedAt) ?? 0);
    if (!trend[day]) continue;
    trend[day].decided += 1;
    if (doc.data().status === 'approved') trend[day].approved += 1;
  }

  const cityCounts = new Map<string, number>();
  for (const doc of liveDuties.docs) {
    const city = typeof doc.data().city === 'string' ? doc.data().city.trim() : '';
    if (city) cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
  }

  const registryDomains = registry.data()?.value;
  return {
    sla: {
      slaHours: policy.slaHours,
      openCases: queue.length,
      overdue: queue.filter(c => c.slaState === 'overdue').length,
      dueSoon: queue.filter(c => c.slaState === 'due_soon').length,
      waitingOnApplicant: queue.filter(c => c.slaState === 'waiting_on_applicant').length,
      escalated: queue.filter(c => c.escalated).length,
      unassigned: queue.filter(c => !c.assigneeId && c.status !== 'needs_information').length,
      windowDays: SLA_WINDOW_DAYS,
      decidedInWindow: decidedTotal,
      compliancePercent: decidedTotal ? Math.round((decidedWithinSla / decidedTotal) * 1000) / 10 : null,
      upcoming: queue.filter(c => c.slaState === 'due_soon' || c.slaState === 'overdue').slice(0, 6).map(c => ({
        caseId: c.caseId, subjectType: c.subjectType, subjectName: c.subjectName,
        registrationNo: c.registrationNo, slaDueAt: c.slaDueAt, slaState: c.slaState,
      })),
    },
    trend: days.map(day => ({ day, ...trend[day] })),
    cities: {
      active: cityCounts.size,
      liveDuties: liveDuties.size,
      top: [...cityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([city, duties]) => ({ city, duties })),
    },
    registries: { approvedDomains: Array.isArray(registryDomains) ? registryDomains.length : 0 },
  };
};
