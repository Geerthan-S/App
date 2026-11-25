/**
 * Internal support tickets for issues staff receive by phone or email.
 * There is no in-app "contact support" yet; staff open a case on the user's
 * behalf and track it to resolution here. Every change is audited.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp, type DocumentSnapshot, type Query } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAdmin, staffRoleOf } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';
import { CorrelationField, parseOrThrow, toIso } from './adminShared';

const CATEGORIES = ['account', 'verification', 'duty', 'payment', 'safety', 'privacy', 'other'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
const STATUSES = ['open', 'pending', 'resolved'] as const;
const MAX_NOTES = 100;

const CreateSchema = z.object({
  subject: z.string().trim().min(3).max(140),
  description: z.string().trim().min(3).max(4000),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES).default('normal'),
  requesterUid: DocIdSchema.optional(),
  requesterContact: z.string().trim().max(200).optional(),
  relatedType: z.enum(['doctor', 'organization', 'duty', 'case']).optional(),
  relatedId: DocIdSchema.optional(),
  ...CorrelationField,
}).strict().refine(v => !v.relatedId || v.relatedType, { message: 'relatedType is required with relatedId' });

const ListSchema = z.object({
  status: z.enum([...STATUSES, 'all']).default('open'),
  mine: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(30),
  ...CorrelationField,
}).strict();

const UpdateSchema = z.object({
  caseId: DocIdSchema,
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignToMe: z.boolean().optional(),
  unassign: z.boolean().optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  ...CorrelationField,
}).strict().refine(v => v.status || v.priority || v.assignToMe || v.unassign || v.note, { message: 'Nothing to update' });

const caseRow = (doc: DocumentSnapshot, withNotes = false) => {
  const c = doc.data() ?? {};
  return {
    caseId: doc.id,
    subject: c.subject,
    description: withNotes ? c.description : undefined,
    category: c.category,
    priority: c.priority,
    status: c.status,
    requesterUid: c.requesterUid ?? null,
    requesterContact: c.requesterContact ?? null,
    relatedType: c.relatedType ?? null,
    relatedId: c.relatedId ?? null,
    assigneeId: c.assigneeId ?? null,
    assigneeName: c.assigneeName ?? null,
    createdBy: c.createdBy ?? null,
    createdAt: toIso(c.createdAt),
    updatedAt: toIso(c.updatedAt),
    resolvedAt: toIso(c.resolvedAt),
    noteCount: Array.isArray(c.notes) ? c.notes.length : 0,
    notes: withNotes && Array.isArray(c.notes) ?
      c.notes.map((n: Record<string, unknown>) => ({ ...n, at: toIso(n.at) })) : undefined,
  };
};

const staffName = (request: CallableRequest): string =>
  String(request.auth?.token?.name ?? request.auth?.token?.email ?? request.auth?.uid ?? 'staff');

export const createSupportCase = domainCall('createSupportCase', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireAdmin(request, correlationId);
  const input = parseOrThrow(CreateSchema, request.data, correlationId, 'Invalid support case');

  const ref = db().collection('supportCases').doc();
  const batch = db().batch();
  batch.set(ref, {
    caseId: ref.id,
    subject: input.subject,
    description: input.description,
    category: input.category,
    priority: input.priority,
    status: 'open',
    requesterUid: input.requesterUid ?? null,
    requesterContact: input.requesterContact ?? null,
    relatedType: input.relatedType ?? null,
    relatedId: input.relatedId ?? null,
    assigneeId: uid,
    assigneeName: staffName(request),
    notes: [],
    createdBy: uid,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
    resolvedAt: null,
  });
  stageAudit(batch, {
    actorId: uid,
    actorRole: staffRoleOf(request),
    action: 'SUPPORT_CASE_OPENED',
    targetType: 'supportCases',
    targetId: ref.id,
    reasonCode: `SUPPORT_${input.category.toUpperCase()}`,
    correlationId,
    result: 'SUCCESS',
    afterSummary: { category: input.category, priority: input.priority, requesterUid: input.requesterUid ?? null },
  });
  await batch.commit();
  return { success: true, caseId: ref.id };
}, { audience: 'staff' });

export const listSupportCases = domainCall('listSupportCases', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireAdmin(request, correlationId);
  const { status, mine, limit } = parseOrThrow(ListSchema, request.data, correlationId, 'Invalid support case query');

  let query: Query = db().collection('supportCases');
  if (mine) query = query.where('assigneeId', '==', uid);
  if (status !== 'all') query = query.where('status', '==', status);
  const snap = await query.orderBy('updatedAt', 'desc').limit(limit).get();

  const counts = Object.fromEntries(await Promise.all(STATUSES.map(async s =>
    [s, (await db().collection('supportCases').where('status', '==', s).count().get()).data().count])));
  return { cases: snap.docs.map(doc => caseRow(doc)), counts };
}, { audience: 'staff' });

export const getSupportCase = domainCall('getSupportCase', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);
  const { caseId } = parseOrThrow(z.object({ caseId: DocIdSchema, ...CorrelationField }).strict(),
    request.data, correlationId, 'caseId is required');
  const snap = await db().collection('supportCases').doc(caseId).get();
  if (!snap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Support case not found', correlationId);
  return { case: caseRow(snap, true) };
}, { audience: 'staff' });

export const updateSupportCase = domainCall('updateSupportCase', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const uid = requireAdmin(request, correlationId);
  const input = parseOrThrow(UpdateSchema, request.data, correlationId, 'Invalid support case update');
  const ref = db().collection('supportCases').doc(input.caseId);

  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Support case not found', correlationId);
    const current = snap.data()!;
    const notes: unknown[] = Array.isArray(current.notes) ? current.notes : [];
    if (input.note && notes.length >= MAX_NOTES) {
      throw new DomainError('VALIDATION_FAILED', `A case holds at most ${MAX_NOTES} notes; open a follow-up case`, correlationId);
    }

    const changes: Record<string, unknown> = { updatedAt: nowTimestamp() };
    if (input.status && input.status !== current.status) {
      changes.status = input.status;
      changes.resolvedAt = input.status === 'resolved' ? nowTimestamp() : null;
    }
    if (input.priority) changes.priority = input.priority;
    if (input.assignToMe) Object.assign(changes, { assigneeId: uid, assigneeName: staffName(request) });
    if (input.unassign) Object.assign(changes, { assigneeId: null, assigneeName: null });
    if (input.note) {
      changes.notes = [...notes, { authorId: uid, authorName: staffName(request), text: input.note, at: Timestamp.now() }];
    }
    tx.update(ref, changes);
    stageAudit(tx, {
      actorId: uid,
      actorRole: staffRoleOf(request),
      action: 'SUPPORT_CASE_UPDATED',
      targetType: 'supportCases',
      targetId: input.caseId,
      reasonCode: input.status === 'resolved' ? 'SUPPORT_RESOLVED' : 'SUPPORT_UPDATE',
      correlationId,
      result: 'SUCCESS',
      beforeSummary: { status: current.status, priority: current.priority, assigneeId: current.assigneeId ?? null },
      afterSummary: {
        status: changes.status ?? current.status,
        priority: changes.priority ?? current.priority,
        assigneeId: 'assigneeId' in changes ? changes.assigneeId : current.assigneeId ?? null,
        noteAdded: Boolean(input.note),
      },
    });
  });
  return { success: true, caseId: input.caseId };
}, { audience: 'staff' });
