/**
 * QR attendance: the hospital shows a short-lived QR code when the doctor
 * arrives (and again when they leave); the doctor scans it in the app.
 *
 *  - issueAttendanceCode (hospital member): one-time code for one assignment.
 *  - scanAttendanceCode (the assigned doctor): records the time and location,
 *    compares them with the agreed shift and the branch's map position, and
 *    moves the assignment to in_progress on check-in.
 *  - acknowledgeAttendance (hospital member): clears flagged discrepancies.
 *
 * Every scan is recorded even when it raises discrepancies; the hospital is
 * asked to acknowledge instead of the scan being refused.
 */

import { randomBytes } from 'crypto';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { domainCall } from '../shared/callable';
import { DomainError } from '../shared/errors';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { DocIdSchema } from '../shared/schemas';
import { getBusinessConfig } from '../shared/businessConfig';
import { requireAuth, isActiveOrgMemberInTx } from '../security/guards';
import { stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';
import { assignmentEvent, scheduleRefsFor, setScheduleIntervalStatus } from '../assignments/assignmentLifecycle';
import { ATTENDANCE_CODE_PREFIX, AttendanceKind, describeDiscrepancy, evaluateScan } from './attendanceRules';

const KindSchema = z.enum(['check_in', 'check_out']);

const IssueSchema = z.object({ assignmentId: DocIdSchema, kind: KindSchema });

const ScanSchema = z.object({
  code: z.string().min(10).max(120),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().min(0).max(100000).optional(),
    isMocked: z.boolean().optional(),
  }).nullable().optional(),
});

const AcknowledgeSchema = z.object({
  assignmentId: DocIdSchema,
  note: z.string().trim().max(500).optional(),
});

const attendanceRef = (assignmentId: string) => db().collection('attendance').doc(assignmentId);

const codeIdFrom = (code: string): string | null => {
  if (!code.startsWith(ATTENDANCE_CODE_PREFIX)) return null;
  const id = code.slice(ATTENDANCE_CODE_PREFIX.length);
  return /^[A-Za-z0-9_-]{20,64}$/.test(id) ? id : null;
};

export const issueAttendanceCode = domainCall('issueAttendanceCode', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = IssueSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid attendance request', correlationId);
  const { assignmentId, kind } = parsed.data;
  const policy = await getBusinessConfig('attendance_policy');

  const codeId = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + policy.codeTtlSeconds * 1000).toISOString();

  await db().runTransaction(async tx => {
    const asgSnap = await tx.get(db().collection('assignments').doc(assignmentId));
    if (!asgSnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
    const asg = asgSnap.data()!;
    const [isMember, attendanceSnap] = await Promise.all([
      isActiveOrgMemberInTx(tx, uid, asg.organizationId),
      tx.get(attendanceRef(assignmentId)),
    ]);
    if (!isMember) {
      throw new DomainError('PERMISSION_DENIED', 'Only this hospital\'s team can show attendance codes', correlationId);
    }
    const attendance = attendanceSnap.data();
    const nowMs = Date.now();
    if (kind === 'check_in') {
      if (asg.status !== 'confirmed') {
        throw new DomainError('INVALID_STATE_TRANSITION',
          asg.status === 'in_progress' ? 'The doctor has already checked in' : `Cannot check in an assignment in status ${asg.status}`,
          correlationId);
      }
      const opensAt = new Date(asg.termsSnapshot.startAt).getTime() - policy.checkInOpensMinutesBefore * 60000;
      if (nowMs < opensAt) {
        throw new DomainError('INVALID_STATE_TRANSITION',
          `Check-in opens ${policy.checkInOpensMinutesBefore} minutes before the shift starts`, correlationId);
      }
      if (nowMs > new Date(asg.termsSnapshot.endAt).getTime()) {
        throw new DomainError('INVALID_STATE_TRANSITION', 'This shift has already ended', correlationId);
      }
    } else {
      if (asg.status !== 'in_progress' || !attendance?.checkIn) {
        throw new DomainError('INVALID_STATE_TRANSITION', 'The doctor must check in before checking out', correlationId);
      }
      if (attendance.checkOut) {
        throw new DomainError('INVALID_STATE_TRANSITION', 'The doctor has already checked out', correlationId);
      }
    }

    tx.set(db().collection('attendanceCodes').doc(codeId), {
      assignmentId,
      kind,
      organizationId: asg.organizationId,
      doctorId: asg.doctorId,
      issuedBy: uid,
      expiresAt,
      usedAt: null,
      createdAt: nowTimestamp(),
    });
  });

  return { success: true, code: `${ATTENDANCE_CODE_PREFIX}${codeId}`, kind, expiresAt, ttlSeconds: policy.codeTtlSeconds };
});

export const scanAttendanceCode = domainCall('scanAttendanceCode', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = ScanSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid scan', correlationId);
  const codeId = codeIdFrom(parsed.data.code);
  if (!codeId) throw new DomainError('ATTENDANCE_CODE_INVALID', 'This is not a HealthForce attendance code', correlationId);
  const location = parsed.data.location ?? null;
  const policy = await getBusinessConfig('attendance_policy');

  const outcome = await db().runTransaction(async tx => {
    const codeRef = db().collection('attendanceCodes').doc(codeId);
    const codeSnap = await tx.get(codeRef);
    if (!codeSnap.exists) throw new DomainError('ATTENDANCE_CODE_INVALID', 'Code not recognised. Ask the hospital to show a new one.', correlationId);
    const code = codeSnap.data()!;
    if (code.doctorId !== uid) {
      throw new DomainError('PERMISSION_DENIED', 'This code is for a different doctor\'s shift', correlationId);
    }
    if (code.usedAt) throw new DomainError('ATTENDANCE_CODE_INVALID', 'This code was already used. Ask for a new one.', correlationId);
    const nowMs = Date.now();
    if (new Date(code.expiresAt).getTime() < nowMs) {
      throw new DomainError('ATTENDANCE_CODE_INVALID', 'This code has expired. Ask the hospital to show a new one.', correlationId);
    }

    const asgRef = db().collection('assignments').doc(code.assignmentId);
    const asgSnap = await tx.get(asgRef);
    if (!asgSnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Assignment not found', correlationId);
    const asg = asgSnap.data()!;
    const kind = code.kind as AttendanceKind;
    const facilityRef = asg.facilityId ?
      db().collection('organizations').doc(asg.organizationId).collection('facilities').doc(asg.facilityId) : null;
    const [attendanceSnap, facilitySnap, scheduleSnaps] = await Promise.all([
      tx.get(attendanceRef(code.assignmentId)),
      facilityRef ? tx.get(facilityRef) : Promise.resolve(null),
      kind === 'check_in' ? Promise.all(scheduleRefsFor(asg).map(ref => tx.get(ref))) : Promise.resolve([]),
    ]);
    const attendance = attendanceSnap.data();

    if (kind === 'check_in' && (asg.status !== 'confirmed' || attendance?.checkIn)) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Check-in is no longer possible for this shift', correlationId);
    }
    if (kind === 'check_out' && (asg.status !== 'in_progress' || !attendance?.checkIn || attendance?.checkOut)) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Check-out is not possible for this shift', correlationId);
    }

    const geo = facilitySnap?.data()?.geo;
    const facility = geo && typeof geo.latitude === 'number' && typeof geo.longitude === 'number' ?
      { latitude: geo.latitude, longitude: geo.longitude } : null;
    const evaluation = evaluateScan({
      kind, scannedAtMs: nowMs, shiftStartIso: asg.termsSnapshot.startAt, shiftEndIso: asg.termsSnapshot.endAt,
      location, facility, policy,
    });
    const record = {
      atIso: new Date(nowMs).toISOString(),
      at: nowTimestamp(),
      location,
      distanceMeters: evaluation.distanceMeters,
      withinRadius: evaluation.withinRadius,
      deviationMinutes: evaluation.deviationMinutes,
      discrepancies: evaluation.discrepancies,
      codeIssuedBy: code.issuedBy,
      radiusMeters: policy.radiusMeters,
    };
    const notes = evaluation.discrepancies.map(d => describeDiscrepancy(d, evaluation));
    const flagged = notes.length > 0;
    const pending = [
      ...((attendance?.pendingDiscrepancies as unknown[]) ?? []),
      ...notes.map(text => ({ kind, text })),
    ];

    tx.set(attendanceRef(code.assignmentId), {
      assignmentId: code.assignmentId,
      dutyId: asg.dutyId,
      doctorId: asg.doctorId,
      organizationId: asg.organizationId,
      [kind === 'check_in' ? 'checkIn' : 'checkOut']: record,
      pendingDiscrepancies: pending,
      needsAcknowledgement: pending.length > 0,
      shift: { startAt: asg.termsSnapshot.startAt, endAt: asg.termsSnapshot.endAt },
      updatedAt: nowTimestamp(),
      ...(attendance ? {} : { createdAt: nowTimestamp() }),
    }, { merge: true });
    tx.update(codeRef, { usedAt: nowTimestamp() });

    if (kind === 'check_in') {
      tx.update(asgRef, { status: 'in_progress', startedAt: nowTimestamp(), version: (asg.version ?? 0) + 1, updatedAt: nowTimestamp() });
      setScheduleIntervalStatus(tx, scheduleSnaps, code.assignmentId, 'in_progress');
      const event = assignmentEvent(asg, code.assignmentId, 'confirmed', 'in_progress', uid, 'doctor', 'QR_CHECK_IN');
      tx.set(event.ref, event.data);
    }

    const who = asg.doctorName ?? 'The doctor';
    const verb = kind === 'check_in' ? 'checked in' : 'checked out';
    enqueueNotification(tx, {
      dedupeKey: `attendance_${kind}_${code.assignmentId}`,
      eventType: flagged ? 'attendance.flagged' : `attendance.${kind}`,
      targetOrganizationId: asg.organizationId,
      title: flagged ? `Attendance needs your acknowledgement` : `Doctor ${verb}`,
      body: flagged ? `${who} ${verb}: ${notes.join('; ')}` : `${who} ${verb} for ${asg.specialtyName ?? 'the'} shift`,
      payload: { assignmentId: code.assignmentId, dutyId: asg.dutyId, kind },
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: 'doctor',
      action: kind === 'check_in' ? 'ATTENDANCE_CHECK_IN' : 'ATTENDANCE_CHECK_OUT',
      targetType: 'assignments',
      targetId: code.assignmentId,
      reasonCode: flagged ? 'DISCREPANCY_FLAGGED' : 'ON_TIME_ON_SITE',
      correlationId,
      result: 'SUCCESS',
      afterSummary: { distanceMeters: evaluation.distanceMeters, deviationMinutes: evaluation.deviationMinutes, discrepancies: evaluation.discrepancies },
    });

    return { assignmentId: code.assignmentId as string, kind, evaluation, notes };
  });

  return {
    success: true,
    assignmentId: outcome.assignmentId,
    kind: outcome.kind,
    distanceMeters: outcome.evaluation.distanceMeters,
    withinRadius: outcome.evaluation.withinRadius,
    deviationMinutes: outcome.evaluation.deviationMinutes,
    discrepancies: outcome.evaluation.discrepancies,
    notes: outcome.notes,
  };
});

export const acknowledgeAttendance = domainCall('acknowledgeAttendance', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = AcknowledgeSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid acknowledgement', correlationId);
  const { assignmentId, note } = parsed.data;

  await db().runTransaction(async tx => {
    const snap = await tx.get(attendanceRef(assignmentId));
    if (!snap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'No attendance recorded for this shift', correlationId);
    const attendance = snap.data()!;
    if (!(await isActiveOrgMemberInTx(tx, uid, attendance.organizationId))) {
      throw new DomainError('PERMISSION_DENIED', 'Only this hospital\'s team can acknowledge attendance', correlationId);
    }
    if (!attendance.needsAcknowledgement) return;
    const acknowledged = (attendance.acknowledgements as unknown[] | undefined) ?? [];
    tx.update(snap.ref, {
      acknowledgements: [...acknowledged, {
        by: uid, atIso: new Date().toISOString(), note: note ?? null, items: attendance.pendingDiscrepancies ?? [],
      }],
      pendingDiscrepancies: [],
      needsAcknowledgement: false,
      updatedAt: nowTimestamp(),
    });
    stageAudit(tx, {
      actorId: uid,
      actorRole: 'hospital_staff',
      action: 'ATTENDANCE_ACKNOWLEDGED',
      targetType: 'assignments',
      targetId: assignmentId,
      reasonCode: 'DISCREPANCY_ACKNOWLEDGED',
      correlationId,
      result: 'SUCCESS',
    });
  });
  return { success: true, assignmentId };
});
