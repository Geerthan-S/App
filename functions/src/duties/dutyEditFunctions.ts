/**
 * Duty edits with version history (blueprint §4.3): "material edits are
 * versioned and notified to existing applicants".
 *
 *  - Optimistic concurrency: the caller sends the version it edited.
 *  - Pay and schedule are frozen once any doctor holds a seat on the duty
 *    (selected, confirmed or in progress); those changes need cancellation and
 *    a new duty, so nobody's agreed terms change underneath them.
 *  - Every change writes duties/{id}/versions/{n} and doctors with an open
 *    application are notified of material changes.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, requireOrgPermission } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';
import { enqueueNotification } from '../notifications/outbox';
import { CorrelationField, parseOrThrow } from '../admin/adminShared';
import { MAX_SHIFT_HOURS } from './dutyFunctions';

const EDITABLE_STATUSES = ['draft', 'published', 'paused'];
const SEAT_HOLDING_ASSIGNMENTS = ['selected', 'confirmed', 'in_progress', 'active'];
const OPEN_APPLICATIONS = ['submitted', 'shortlisted'];
/** Changes a doctor would weigh when deciding to apply or stay applied. */
const MATERIAL_FIELDS = ['schedule', 'paymentTerms', 'qualificationRequired', 'experienceMinYears', 'department'];
/** Terms that are frozen once a doctor holds a seat. */
const FROZEN_WITH_SEATS = ['schedule', 'paymentTerms'];

const ChangesSchema = z.object({
  department: z.string().trim().min(2).max(100).optional(),
  qualificationRequired: z.string().trim().min(2).max(200).optional(),
  experienceMinYears: z.number().int().min(0).max(60).optional(),
  schedule: z.object({
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    shiftType: z.enum(['morning', 'evening', 'night', 'full_day']),
  }).strict().optional(),
  headcount: z.number().int().min(1).max(50).optional(),
  paymentTerms: z.object({
    amount: z.number().positive().max(10_000_000),
    currency: z.literal('INR').default('INR'),
    basis: z.enum(['per_shift', 'per_hour']),
    expectedPaymentTiming: z.enum(['end_of_shift', 'within_24_hours', 'weekly']),
  }).strict().optional(),
  notes: z.string().trim().max(1000).optional(),
}).strict().refine(c => Object.keys(c).length > 0, { message: 'Nothing to change' });

const UpdateDutySchema = z.object({
  dutyId: DocIdSchema,
  expectedVersion: z.number().int().min(1),
  changes: ChangesSchema,
  ...CorrelationField,
}).strict();

/** Key-order-independent JSON, so a map read back from Firestore compares equal to the same input. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export const updateDuty = domainCall('updateDuty', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { dutyId, expectedVersion, changes } = parseOrThrow(UpdateDutySchema, request.data, correlationId, 'Invalid duty change');
  const dutyRef = db().collection('duties').doc(dutyId);
  const initial = (await dutyRef.get()).data();
  if (!initial) throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
  const role = await requireOrgPermission(uid, initial.organizationId, 'manageDuties', correlationId);

  if (changes.schedule) {
    const startMs = Date.parse(changes.schedule.startAt);
    const endMs = Date.parse(changes.schedule.endAt);
    if (!(endMs > startMs) || endMs - startMs > MAX_SHIFT_HOURS * 3600_000) {
      throw new DomainError('VALIDATION_FAILED', `Shift must end after it starts and last at most ${MAX_SHIFT_HOURS} hours`, correlationId);
    }
    if (startMs <= Date.now()) throw new DomainError('VALIDATION_FAILED', 'Shift must start in the future', correlationId);
  }

  return db().runTransaction(async tx => {
    // ---- reads ----
    const [dutySnap, seats, openApps] = await Promise.all([
      tx.get(dutyRef),
      tx.get(db().collection('assignments').where('dutyId', '==', dutyId).where('status', 'in', SEAT_HOLDING_ASSIGNMENTS).limit(1)),
      tx.get(dutyRef.collection('applications').where('status', 'in', OPEN_APPLICATIONS).limit(480)), // stays under the 500-write transaction limit
    ]);
    const duty = dutySnap.data()!;

    // ---- validation ----
    const currentVersion = typeof duty.version === 'number' ? duty.version : 1;
    if (currentVersion !== expectedVersion) {
      throw new DomainError('CONCURRENT_UPDATE', 'This duty was changed by someone else. Reload it and try again.', correlationId);
    }
    if (!EDITABLE_STATUSES.includes(duty.status)) {
      throw new DomainError('INVALID_STATE_TRANSITION', `A ${duty.status} duty cannot be edited`, correlationId);
    }
    const changed = Object.keys(changes).filter(key => !same((changes as Record<string, unknown>)[key], duty[key]));
    if (!changed.length) return { success: true, dutyId, version: currentVersion, changedFields: [] };
    if (!seats.empty && changed.some(f => FROZEN_WITH_SEATS.includes(f))) {
      throw new DomainError('INVALID_STATE_TRANSITION',
        'A doctor already holds a seat on this duty, so pay and schedule are locked. Cancel and post a new duty instead.', correlationId);
    }
    const update: Record<string, unknown> = {};
    for (const field of changed) update[field] = (changes as Record<string, unknown>)[field];
    if (changes.headcount !== undefined && changed.includes('headcount')) {
      const filled = (duty.headcount ?? 1) - (duty.remainingHeadcount ?? duty.headcount ?? 1);
      if (changes.headcount < Math.max(1, filled) || (duty.status === 'published' && changes.headcount === filled)) {
        throw new DomainError('VALIDATION_FAILED', `At least ${filled + (duty.status === 'published' ? 1 : 0)} seat(s) are needed: ${filled} already filled`, correlationId);
      }
      update.remainingHeadcount = changes.headcount - filled;
    }
    const material = changed.filter(f => MATERIAL_FIELDS.includes(f));
    const newVersion = currentVersion + 1;

    // ---- writes ----
    tx.update(dutyRef, {
      ...update,
      version: newVersion,
      ...(material.length ? { lastMaterialChangeAt: nowTimestamp(), lastMaterialChangeVersion: newVersion } : {}),
      updatedAt: nowTimestamp(),
    });
    tx.create(dutyRef.collection('versions').doc(String(newVersion)), {
      version: newVersion,
      changedFields: changed,
      materialFields: material,
      before: Object.fromEntries(changed.map(f => [f, duty[f] ?? null])),
      after: Object.fromEntries(changed.map(f => [f, update[f] ?? null])),
      changedBy: uid,
      changedAt: nowTimestamp(),
    });
    if (material.length) {
      for (const app of openApps.docs) {
        enqueueNotification(tx, {
          dedupeKey: `duty_changed_${dutyId}_${newVersion}_${app.id}`,
          eventType: 'duty.updated',
          targetUserId: app.id,
          title: 'A duty you applied to changed',
          body: `${duty.specialtyName ?? 'Duty'} at ${duty.facilityName ?? 'the hospital'}: ${material.map(f => f.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')} updated. Review it before your application is considered.`,
          payload: { dutyId, version: newVersion },
        });
      }
    }
    stageAudit(tx, {
      actorId: uid,
      actorRole: role,
      action: 'DUTY_UPDATED',
      targetType: 'duties',
      targetId: dutyId,
      reasonCode: material.length ? 'DUTY_MATERIAL_EDIT' : 'DUTY_EDIT',
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { version: currentVersion },
      afterSummary: { version: newVersion, changedFields: changed, applicantsNotified: material.length ? openApps.size : 0 },
    });
    return { success: true, dutyId, version: newVersion, changedFields: changed, applicantsNotified: material.length ? openApps.size : 0 };
  });
}, { requireConsent: true });
