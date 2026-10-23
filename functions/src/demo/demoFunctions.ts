/**
 * Demo workspace for the client review.
 *
 * A super admin turns it on from the admin portal (seedDemoWorkspace). That
 * writes sample hospitals, doctors, open duties and reviews, and from then on
 * every user who opens the app gets their own sample content once
 * (ensureDemoContent): four chat threads, inbox notifications, a pending offer
 * and a completed duty with a review; a hospital also gets sample applicants.
 * Everything is marked `isDemo` and removed by clearDemoWorkspace.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type WriteBatch } from 'firebase-admin/firestore';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, requireStepUpAuth, requireSuperAdmin, requireAdmin, staffRoleOf } from '../security/guards';
import { logAudit } from '../audit/auditLogger';
import { DAY_MS } from '../admin/adminShared';
import { conversationRef, newConversation } from '../chat/chatFunctions';
import {
  DEMO_DOCTORS, DEMO_DUTIES, DEMO_ORGS, DEMO_ORG_REVIEWS, DOCTOR_SIDE_THREADS, HOSPITAL_SIDE_THREADS,
  demoScheduleOf, isDemoId, type DemoDutyTemplate, type ScriptLine,
} from './demoData';

const CONFIG = () => db().collection('configuration').doc('demo_workspace');
const MINUTE_MS = 60_000;

export const demoWorkspaceEnabled = async (): Promise<boolean> => (await CONFIG().get()).data()?.enabled === true;

const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);
const doctorById = new Map(DEMO_DOCTORS.map(d => [d.id, d]));
const orgById = new Map(DEMO_ORGS.map(o => [o.id, o]));
const dutyByKey = new Map(DEMO_DUTIES.map(d => [d.key, d]));
const dutyIdOf = (key: string) => `demo_duty_${key}`;
const dutyTitleOf = (t: { specialtyName: string; department: string }) => `${t.specialtyName} · ${t.department}`;

/** Writes in chunks: a single batch holds at most 500 writes. */
class ChunkedWriter {
  private batch: WriteBatch = db().batch();
  private count = 0;
  private readonly pending: Promise<unknown>[] = [];
  set(ref: DocumentReference, data: DocumentData, merge = false) {
    if (merge) this.batch.set(ref, data, { merge: true }); else this.batch.set(ref, data);
    this.bump();
  }
  update(ref: DocumentReference, data: DocumentData) { this.batch.update(ref, data); this.bump(); }
  delete(ref: DocumentReference) { this.batch.delete(ref); this.bump(); }
  private bump() {
    if (++this.count >= 450) { this.pending.push(this.batch.commit()); this.batch = db().batch(); this.count = 0; }
  }
  async commit() { if (this.count) this.pending.push(this.batch.commit()); await Promise.all(this.pending); }
}

const dutyDoc = (template: DemoDutyTemplate, id: string, organizationId: string, status: string, extra: DocumentData = {}) => {
  const org = orgById.get(template.orgId)!;
  return {
    dutyId: id,
    organizationId,
    facilityId: org.facility.id,
    facilityName: org.facility.name,
    city: org.city,
    department: template.department,
    specialtyId: template.specialtyId,
    specialtyName: template.specialtyName,
    qualificationRequired: template.qualificationRequired,
    experienceMinYears: template.experienceMinYears,
    schedule: { ...demoScheduleOf(template), shiftType: template.shiftType },
    headcount: template.headcount,
    remainingHeadcount: template.headcount,
    paymentTerms: { amount: template.amount, currency: 'INR', basis: template.basis, expectedPaymentTiming: 'end_of_shift' },
    notes: `${template.notes} (Sample duty for the client review.)`,
    status,
    version: 1,
    isDemo: true,
    createdBy: 'demo_seed',
    createdAt: nowTimestamp(),
    publishedAt: status === 'draft' ? null : nowTimestamp(),
    updatedAt: nowTimestamp(),
    ...extra,
  };
};

const snapshotOf = (doctorId: string, dutyId: string) => {
  const d = doctorById.get(doctorId)!;
  return {
    snapshotId: `demo_snap_${dutyId}_${doctorId}`,
    dutyId,
    doctorId,
    doctorProfileSnapshot: {
      fullName: d.fullName, council: d.council, registrationNo: d.registrationNo,
      qualification: d.qualification, specialties: [d.primarySpecialty], primarySpecialty: d.primarySpecialty,
      yearsOfExperience: d.yearsOfExperience, isVerified: true, profileRevision: 1,
    },
    isDemo: true,
    capturedAt: nowTimestamp(),
  };
};

const inboxItem = (uid: string, key: string, title: string, body: string, minutesAgo: number, payload: DocumentData = {}) => ({
  ref: db().collection('inboxNotifications').doc(`demo_${key}_${uid}`),
  data: {
    notificationId: `demo_${key}_${uid}`, outboxId: null, userId: uid, eventType: `demo.${key}`,
    title, body, payload, isRead: false, readAt: null, isDemo: true, createdAt: ago(minutesAgo * MINUTE_MS),
  },
});

const writeThread = (w: ChunkedWriter, conversation: ReturnType<typeof newConversation>, lines: ScriptLine[], unreadFor: 'doctor' | 'organization', unread: number) => {
  const ref = conversationRef(conversation.conversationId);
  const last = lines[lines.length - 1];
  const nameOf = (side: 'doctor' | 'organization') => (side === 'doctor' ? conversation.doctorName : conversation.organizationName);
  const senderOf = (side: 'doctor' | 'organization') => (side === 'doctor' ? conversation.doctorId : conversation.organizationId);
  w.set(ref, {
    ...conversation,
    lastMessage: { text: last[1], senderSide: last[0], senderName: nameOf(last[0]), at: ago(last[2] * MINUTE_MS) },
    unread: { doctor: unreadFor === 'doctor' ? unread : 0, organization: unreadFor === 'organization' ? unread : 0 },
    messageCount: lines.length,
    createdAt: ago(lines[0][2] * MINUTE_MS),
    updatedAt: ago(last[2] * MINUTE_MS),
  });
  lines.forEach(([side, text, minutesAgo], i) => {
    w.set(ref.collection('messages').doc(`demo_${String(i).padStart(2, '0')}`), {
      messageId: `demo_${String(i).padStart(2, '0')}`, senderId: senderOf(side), senderSide: side, senderName: nameOf(side),
      text, isDemo: true, createdAt: ago(minutesAgo * MINUTE_MS),
    });
  });
};

// ── Shared sample data ────────────────────────────────────

/** Writes (or refreshes) the shared sample hospitals, doctors, duties and reviews. */
export const writeSharedDemoData = async (): Promise<Record<string, number>> => {
  const w = new ChunkedWriter();
  for (const org of DEMO_ORGS) {
    const ref = db().collection('organizations').doc(org.id);
    w.set(ref, {
      organizationId: org.id, legalName: org.legalName, displayName: org.displayName, organizationType: org.organizationType,
      registrationNumber: org.registrationNumber, address: org.address, city: org.city,
      verificationState: 'approved', verificationCaseId: null, verifiedAt: nowTimestamp(),
      isDemo: true, createdBy: 'demo_seed', createdAt: nowTimestamp(), updatedAt: nowTimestamp(),
    }, true);
    w.set(ref.collection('facilities').doc(org.facility.id), {
      facilityId: org.facility.id, organizationId: org.id, name: org.facility.name, address: org.facility.address,
      city: org.city, isDemo: true, createdAt: nowTimestamp(),
    }, true);
  }
  for (const d of DEMO_DOCTORS) {
    w.set(db().collection('doctors').doc(d.id), {
      doctorId: d.id, userId: d.id, fullName: d.fullName, council: d.council, registrationNo: d.registrationNo,
      registrationNoNorm: `DEMO_${d.registrationNo}`, qualification: d.qualification, specialties: [d.primarySpecialty],
      primarySpecialty: d.primarySpecialty, yearsOfExperience: d.yearsOfExperience, preferredCities: [d.city], bio: d.bio,
      isVerified: true, verificationStatus: 'approved', verificationCaseId: null, profileRevision: 1,
      isDemo: true, createdAt: nowTimestamp(), updatedAt: nowTimestamp(),
    }, true);
  }
  // Open duties keep fresh dates; any filled or completed state is left alone.
  const existing = await db().getAll(...DEMO_DUTIES.map(t => db().collection('duties').doc(dutyIdOf(t.key))));
  DEMO_DUTIES.forEach((t, i) => {
    const current = existing[i].data();
    const ref = db().collection('duties').doc(dutyIdOf(t.key));
    if (!current) w.set(ref, dutyDoc(t, ref.id, t.orgId, 'published'));
    else if (current.status === 'published') {
      w.update(ref, { schedule: { ...demoScheduleOf(t), shiftType: t.shiftType }, updatedAt: nowTimestamp() });
    }
  });
  for (const r of DEMO_ORG_REVIEWS) {
    const id = `demo_review_${r.orgId}_${r.doctorId}`;
    w.set(db().collection('feedback').doc(id), {
      feedbackId: id, authorId: r.doctorId, targetId: r.orgId, targetType: 'organization', organizationId: r.orgId,
      assignmentId: null, rating: r.rating, comment: r.comment, reviewerName: doctorById.get(r.doctorId)!.fullName,
      isDemo: true, createdAt: ago(r.daysAgo * DAY_MS),
    });
  }
  await w.commit();
  return { hospitals: DEMO_ORGS.length, doctors: DEMO_DOCTORS.length, duties: DEMO_DUTIES.length, reviews: DEMO_ORG_REVIEWS.length };
};

export const seedDemoWorkspace = domainCall('seedDemoWorkspace', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireSuperAdmin(request, correlationId);
  const counts = await writeSharedDemoData();
  await CONFIG().set({ enabled: true, seededAt: nowTimestamp(), seededBy: uid, updatedAt: nowTimestamp() }, { merge: true });
  await logAudit({
    actorId: uid, actorRole: staffRoleOf(request), action: 'DEMO_WORKSPACE_SEEDED', targetType: 'configuration',
    targetId: 'demo_workspace', reasonCode: 'CLIENT_REVIEW', correlationId, result: 'SUCCESS', afterSummary: counts,
  });
  return { success: true, enabled: true, ...counts };
}, { audience: 'staff' });

/** Keeps sample duties in the future while the demo workspace is on. */
export const refreshDemoWorkspace = onSchedule({ schedule: 'every day 01:00', timeZone: 'Asia/Kolkata' }, async () => {
  if (await demoWorkspaceEnabled()) await writeSharedDemoData();
});

// ── Per-user sample content ───────────────────────────────

const seedDoctorSide = async (uid: string, displayName: string) => {
  const w = new ChunkedWriter();
  for (const thread of DOCTOR_SIDE_THREADS) {
    const org = orgById.get(thread.orgId)!;
    const t = dutyByKey.get(thread.dutyKey)!;
    writeThread(w, newConversation({
      organizationId: org.id, organizationName: org.displayName, doctorId: uid, doctorName: displayName,
      dutyId: dutyIdOf(t.key), dutyTitle: dutyTitleOf(t), isDemo: true,
    }), thread.lines, 'doctor', thread.unread);
  }

  // A pending offer (on its own filled duty, so shared seats are untouched).
  const offerTemplate = dutyByKey.get('meridian_icu_day')!;
  const offerDutyRef = db().collection('duties').doc(`demo_duty_offer_${uid}`);
  const offerSchedule = demoScheduleOf({ ...offerTemplate, dayOffset: 2 });
  w.set(offerDutyRef, dutyDoc(offerTemplate, offerDutyRef.id, offerTemplate.orgId, 'filled',
    { headcount: 1, remainingHeadcount: 0, schedule: { ...offerSchedule, shiftType: offerTemplate.shiftType } }));
  w.set(offerDutyRef.collection('applications').doc(uid), {
    applicationId: `demo_app_offer_${uid}`, dutyId: offerDutyRef.id, doctorId: uid, organizationId: offerTemplate.orgId,
    doctorName: displayName, status: 'selected', assignmentId: `demo_asg_offer_${uid}`, isDemo: true,
    version: 2, appliedAt: ago(DAY_MS), updatedAt: nowTimestamp(),
  });
  const org = orgById.get(offerTemplate.orgId)!;
  const terms = (startAt: string, endAt: string) => ({
    amount: offerTemplate.amount, currency: 'INR', basis: offerTemplate.basis, expectedPaymentTiming: 'end_of_shift', startAt, endAt,
  });
  w.set(db().collection('assignments').doc(`demo_asg_offer_${uid}`), {
    assignmentId: `demo_asg_offer_${uid}`, dutyId: offerDutyRef.id, doctorId: uid, doctorName: displayName,
    organizationId: org.id, facilityId: org.facility.id, facilityName: org.facility.name,
    department: offerTemplate.department, specialtyName: offerTemplate.specialtyName,
    termsSnapshot: terms(offerSchedule.startAt, offerSchedule.endAt),
    status: 'selected', expiresAt: Timestamp.fromMillis(Date.now() + 2 * DAY_MS),
    confirmedAt: null, startedAt: null, completedAt: null, isDemo: true,
    createdAt: ago(3 * 3_600_000), updatedAt: ago(3 * 3_600_000), version: 1,
  });

  // A completed duty, with the hospital's review of the doctor.
  const pastTemplate = dutyByKey.get('lakeview_gm_ward')!;
  const pastOrg = orgById.get(pastTemplate.orgId)!;
  const pastDutyRef = db().collection('duties').doc(`demo_duty_past_${uid}`);
  const pastSchedule = demoScheduleOf({ ...pastTemplate, dayOffset: -6 });
  w.set(pastDutyRef, dutyDoc(pastTemplate, pastDutyRef.id, pastTemplate.orgId, 'completed',
    { headcount: 1, remainingHeadcount: 0, schedule: { ...pastSchedule, shiftType: pastTemplate.shiftType } }));
  w.set(db().collection('assignments').doc(`demo_asg_past_${uid}`), {
    assignmentId: `demo_asg_past_${uid}`, dutyId: pastDutyRef.id, doctorId: uid, doctorName: displayName,
    organizationId: pastOrg.id, facilityId: pastOrg.facility.id, facilityName: pastOrg.facility.name,
    department: pastTemplate.department, specialtyName: pastTemplate.specialtyName,
    termsSnapshot: terms(pastSchedule.startAt, pastSchedule.endAt),
    status: 'completed', expiresAt: null, confirmedAt: ago(8 * DAY_MS), startedAt: ago(6 * DAY_MS), completedAt: ago(6 * DAY_MS - 8 * 3_600_000),
    isDemo: true, createdAt: ago(9 * DAY_MS), updatedAt: ago(6 * DAY_MS), version: 4,
  });
  const reviewId = `demo_review_${pastOrg.id}_${uid}`;
  w.set(db().collection('feedback').doc(reviewId), {
    feedbackId: reviewId, authorId: pastOrg.id, targetId: uid, targetType: 'doctor', assignmentId: `demo_asg_past_${uid}`,
    organizationId: pastOrg.id, rating: 5, comment: 'Punctual, thorough handover notes and great with patients. Would book again.',
    reviewerName: pastOrg.displayName, isDemo: true, createdAt: ago(5 * DAY_MS),
  });

  const meridian = dutyByKey.get('meridian_er_night')!;
  for (const item of [
    inboxItem(uid, 'welcome', 'Welcome to HealthForce', 'Sample data has been added so you can explore chats, duties and offers. It is marked as sample and will be removed after the review.', 240),
    inboxItem(uid, 'match', 'New duty matches your search', `${meridian.specialtyName} night shift at ${orgById.get(meridian.orgId)!.displayName}, ₹${meridian.amount} per shift.`, 90, { dutyId: dutyIdOf(meridian.key) }),
    inboxItem(uid, 'offer', 'You have been selected', `${org.displayName} selected you for ${dutyTitleOf(offerTemplate)}. Confirm within 48 hours.`, 180, { assignmentId: `demo_asg_offer_${uid}` }),
    inboxItem(uid, 'verify', 'Complete your verification', 'Upload your registration certificate so hospitals can select you.', 600),
  ]) w.set(item.ref, item.data);

  w.set(db().collection('users').doc(uid), { demoSeededAt: nowTimestamp() }, true);
  await w.commit();
  return { threads: DOCTOR_SIDE_THREADS.length, offers: 1, completed: 1, notifications: 4 };
};

const seedOrganizationSide = async (uid: string, orgId: string, org: DocumentData) => {
  const w = new ChunkedWriter();
  const orgName = org.displayName ?? org.legalName ?? 'Your hospital';
  const result: Record<string, number> = {};
  if (!org.demoSeededAt) {
    for (const thread of HOSPITAL_SIDE_THREADS) {
      const doctor = doctorById.get(thread.doctorId)!;
      writeThread(w, newConversation({
        organizationId: orgId, organizationName: orgName, doctorId: doctor.id, doctorName: doctor.fullName, isDemo: true,
      }), thread.lines, 'organization', thread.unread);
    }
    for (const item of [
      inboxItem(uid, `org_welcome_${orgId}`, `Welcome, ${orgName}`, 'Sample doctors, chats and applicants have been added for the client review.', 120),
    ]) w.set(item.ref, item.data);
    w.update(db().collection('organizations').doc(orgId), { demoSeededAt: nowTimestamp() });
    result.threads = HOSPITAL_SIDE_THREADS.length;
  }

  // Sample duties with applicants, once the hospital can publish (approved).
  if (!org.demoDutiesSeededAt && org.verificationState === 'approved') {
    const facilities = await db().collection('organizations').doc(orgId).collection('facilities').limit(1).get();
    const facility = facilities.docs[0]?.data();
    const place = {
      facilityId: facilities.docs[0]?.id ?? null,
      facilityName: facility?.name ?? orgName,
      city: facility?.city ?? org.city ?? '',
    };
    const open = dutyByKey.get('meridian_er_night')!;
    const draft = dutyByKey.get('stanne_opd_morning')!;
    const openRef = db().collection('duties').doc(`demo_duty_${orgId}_open`);
    w.set(openRef, { ...dutyDoc(open, openRef.id, orgId, 'published', { createdBy: uid }), ...place, headcount: 2, remainingHeadcount: 2 });
    w.set(db().collection('duties').doc(`demo_duty_${orgId}_draft`),
      { ...dutyDoc(draft, `demo_duty_${orgId}_draft`, orgId, 'draft', { createdBy: uid }), ...place });
    DEMO_DOCTORS.slice(0, 3).forEach((d, i) => {
      const snapshot = snapshotOf(d.id, openRef.id);
      w.set(db().collection('applicationSnapshots').doc(snapshot.snapshotId), snapshot);
      w.set(openRef.collection('applications').doc(d.id), {
        applicationId: `demo_app_${openRef.id}_${d.id}`, dutyId: openRef.id, doctorId: d.id, organizationId: orgId,
        doctorName: d.fullName, primarySpecialty: d.primarySpecialty, yearsOfExperience: d.yearsOfExperience,
        status: i === 0 ? 'shortlisted' : 'submitted', snapshotRef: snapshot.snapshotId,
        note: i === 0 ? 'Available for the full shift and can extend if needed.' : '', isDemo: true,
        version: 1, appliedAt: ago((i + 1) * 3_600_000), updatedAt: ago((i + 1) * 3_600_000),
      });
    });
    const item = inboxItem(uid, `org_applicants_${orgId}`, '3 new applicants',
      `${DEMO_DOCTORS[0].fullName} and 2 others applied to ${dutyTitleOf(open)}.`, 30, { dutyId: openRef.id });
    w.set(item.ref, item.data);
    w.update(db().collection('organizations').doc(orgId), { demoDutiesSeededAt: nowTimestamp() });
    result.duties = 2;
    result.applicants = 3;
  }
  await w.commit();
  return result;
};

/**
 * Called by the app after sign-in. Adds the caller's sample content once, and
 * a hospital's once per hospital, while the demo workspace is on.
 */
export const ensureDemoContent = domainCall('ensureDemoContent', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  if (!(await demoWorkspaceEnabled())) return { enabled: false };
  const userRef = db().collection('users').doc(uid);
  const [user, doctor] = await Promise.all([userRef.get(), db().collection('doctors').doc(uid).get()]);
  const seeded: Record<string, unknown> = {};

  if (!user.data()?.demoSeededAt) {
    const name = String(doctor.data()?.fullName ?? user.data()?.displayName ?? '').trim() || 'You';
    seeded.doctor = await seedDoctorSide(uid, name);
  }
  const orgIds: string[] = Array.isArray(user.data()?.organizationIds) ? user.data()!.organizationIds : [];
  for (const orgId of orgIds.slice(0, 5)) {
    if (isDemoId(orgId)) continue;
    const orgRef = db().collection('organizations').doc(orgId);
    const [org, member] = await Promise.all([orgRef.get(), orgRef.collection('members').doc(uid).get()]);
    if (!org.exists || !member.exists || (member.data()?.status ?? 'active') !== 'active') continue;
    const result = await seedOrganizationSide(uid, orgId, org.data()!);
    if (Object.keys(result).length) seeded[orgId] = result;
  }
  return { enabled: true, seeded };
}, { rateLimit: { limit: 60, windowSeconds: 3600 } });

// ── Status and removal ────────────────────────────────────

const DEMO_COLLECTIONS = ['conversations', 'duties', 'assignments', 'feedback', 'inboxNotifications', 'applicationSnapshots', 'doctors', 'organizations'];

export const getDemoWorkspaceStatus = domainCall('getDemoWorkspaceStatus', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);
  const [config, ...counts] = await Promise.all([
    CONFIG().get(),
    ...DEMO_COLLECTIONS.map(c => db().collection(c).where('isDemo', '==', true).count().get()),
  ]);
  return {
    enabled: config.data()?.enabled === true,
    seededAt: config.data()?.seededAt?.toDate?.().toISOString() ?? null,
    counts: Object.fromEntries(DEMO_COLLECTIONS.map((c, i) => [c, counts[i].data().count])),
  };
}, { audience: 'staff' });

export const clearDemoWorkspace = domainCall('clearDemoWorkspace', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireSuperAdmin(request, correlationId);
  requireStepUpAuth(request, correlationId, 600);
  // Stop new seeding first, so nothing is added while removal runs.
  await CONFIG().set({ enabled: false, clearedAt: nowTimestamp(), clearedBy: uid, updatedAt: nowTimestamp() }, { merge: true });

  const removed: Record<string, number> = {};
  for (const name of DEMO_COLLECTIONS) {
    const snap = await db().collection(name).where('isDemo', '==', true).get();
    removed[name] = snap.size;
    // recursiveDelete also removes messages, applications and facilities beneath.
    for (const doc of snap.docs) await db().recursiveDelete(doc.ref);
  }
  // Sample applicants on real hospitals' duties live under non-demo parents too.
  const apps = await db().collectionGroup('applications').where('isDemo', '==', true).get();
  const w = new ChunkedWriter();
  apps.docs.forEach(doc => w.delete(doc.ref));
  removed.applications = apps.size;
  // A hospital may have selected a sample doctor during the review: those
  // assignments and the sample doctor's inbox items were created by the normal
  // flows, so they are found by the sample doctor's id rather than isDemo.
  for (const doctor of DEMO_DOCTORS) {
    const [assignments, inbox] = await Promise.all([
      db().collection('assignments').where('doctorId', '==', doctor.id).get(),
      db().collection('inboxNotifications').where('userId', '==', doctor.id).get(),
    ]);
    assignments.docs.forEach(doc => w.delete(doc.ref));
    inbox.docs.forEach(doc => w.delete(doc.ref));
    removed.assignments = (removed.assignments ?? 0) + assignments.size;
  }
  // Reset the "already seeded" markers so a later demo starts fresh.
  const [users, orgs] = await Promise.all([
    db().collection('users').orderBy('demoSeededAt').get(),
    db().collection('organizations').orderBy('demoSeededAt').get(),
  ]);
  users.docs.forEach(doc => w.update(doc.ref, { demoSeededAt: FieldValue.delete() }));
  orgs.docs.forEach(doc => w.update(doc.ref, { demoSeededAt: FieldValue.delete(), demoDutiesSeededAt: FieldValue.delete() }));
  await w.commit();

  await logAudit({
    actorId: uid, actorRole: staffRoleOf(request), action: 'DEMO_WORKSPACE_CLEARED', targetType: 'configuration',
    targetId: 'demo_workspace', reasonCode: 'CLIENT_REVIEW_DONE', correlationId, result: 'SUCCESS', afterSummary: removed,
  });
  return { success: true, removed };
}, { audience: 'staff' });

