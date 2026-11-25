/**
 * Doctor ↔ hospital messaging.
 *
 * One thread per hospital and doctor: conversations/{organizationId}__{doctorId},
 * with messages in a subcollection. The doctor side is a single user; the
 * hospital side is every active member of the organization. A thread can be
 * opened only around a real application (the doctor applied to one of the
 * hospital's duties), so neither side can cold-message strangers. All writes
 * go through these callables; rules only allow the two sides to read.
 *
 * Sample threads (isDemo) reply automatically from the sample counterpart.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { activeOrgRoleInTx, orgRoleCan, requireAuth } from '../security/guards';
import { DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { enqueueNotification } from '../notifications/outbox';
import { CorrelationField, parseOrThrow, subjectNameOf } from '../admin/adminShared';
import { demoReplyFor, isDemoId } from '../demo/demoData';

export type ChatSide = 'doctor' | 'organization';
export const MAX_MESSAGE_LENGTH = 2000;

export const conversationIdOf = (organizationId: string, doctorId: string): string => `${organizationId}__${doctorId}`;
export const conversationRef = (id: string) => db().collection('conversations').doc(id);

const doctorNameOf = (doctor: DocumentData | undefined): string => {
  const name = String(doctor?.fullName ?? '').trim();
  if (!name) return 'Doctor';
  return /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
};

/** Which side the caller is on, or null when they are not part of the thread. */
const sideOfInTx = async (tx: Transaction, uid: string, conversation: DocumentData): Promise<ChatSide | null> => {
  if (conversation.doctorId === uid) return 'doctor';
  const role = await activeOrgRoleInTx(tx, uid, conversation.organizationId);
  return role ? 'organization' : null;
};

const other = (side: ChatSide): ChatSide => (side === 'doctor' ? 'organization' : 'doctor');

/** New thread document; the caller writes it with tx.create or batch.set. */
export const newConversation = (input: {
  organizationId: string; organizationName: string; doctorId: string; doctorName: string;
  dutyId?: string | null; dutyTitle?: string | null; isDemo?: boolean;
}) => ({
  conversationId: conversationIdOf(input.organizationId, input.doctorId),
  organizationId: input.organizationId,
  organizationName: input.organizationName,
  doctorId: input.doctorId,
  doctorName: input.doctorName,
  dutyId: input.dutyId ?? null,
  dutyTitle: input.dutyTitle ?? null,
  lastMessage: null,
  unread: { doctor: 0, organization: 0 },
  messageCount: 0,
  isDemo: input.isDemo === true,
  createdAt: nowTimestamp(),
  updatedAt: nowTimestamp(),
});

// ── Start ─────────────────────────────────────────────────

const StartSchema = z.object({
  dutyId: DocIdSchema,
  /** Required when a hospital member starts the thread; ignored for doctors. */
  doctorId: DocIdSchema.optional(),
  ...CorrelationField,
}).strict();

export const startConversation = domainCall('startConversation', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { dutyId, doctorId: requestedDoctorId } = parseOrThrow(StartSchema, request.data, correlationId, 'Invalid conversation request');

  return db().runTransaction(async tx => {
    const duty = (await tx.get(db().collection('duties').doc(dutyId))).data();
    if (!duty) throw new DomainError('RESOURCE_NOT_FOUND', 'Duty not found', correlationId);
    const organizationId: string = duty.organizationId;

    // The caller is the doctor, or a hospital member messaging an applicant.
    let doctorId = uid;
    if (requestedDoctorId && requestedDoctorId !== uid) {
      const role = await activeOrgRoleInTx(tx, uid, organizationId);
      if (!role || !orgRoleCan(role, 'manageDuties')) {
        throw new DomainError('PERMISSION_DENIED', 'Only hospital staff who manage duties can message applicants', correlationId);
      }
      doctorId = requestedDoctorId;
    }
    const ref = conversationRef(conversationIdOf(organizationId, doctorId));
    const [application, existing, org, doctor] = await Promise.all([
      tx.get(db().collection('duties').doc(dutyId).collection('applications').doc(doctorId)),
      tx.get(ref),
      tx.get(db().collection('organizations').doc(organizationId)),
      tx.get(db().collection('doctors').doc(doctorId)),
    ]);
    if (!application.exists) {
      throw new DomainError('PERMISSION_DENIED', 'You can message a hospital once you have applied to one of its duties', correlationId);
    }
    const dutyTitle = [duty.specialtyName, duty.department].filter(Boolean).join(' · ') || 'Duty';
    if (existing.exists) {
      tx.update(ref, { dutyId, dutyTitle, updatedAt: nowTimestamp() });
    } else {
      tx.create(ref, newConversation({
        organizationId,
        organizationName: subjectNameOf(org.data()) ?? 'Hospital',
        doctorId,
        doctorName: doctorNameOf(doctor.data()),
        dutyId,
        dutyTitle,
      }));
    }
    return { success: true, conversationId: ref.id };
  });
}, { requireConsent: true, rateLimit: { limit: 60, windowSeconds: 3600 } });

// ── Send ──────────────────────────────────────────────────

const SendSchema = z.object({
  conversationId: z.string().min(3).max(300),
  text: z.string().trim().min(1, 'Type a message').max(MAX_MESSAGE_LENGTH),
  ...CorrelationField,
}).strict();

/** Stages one message and the thread summary it changes. */
export const stageMessage = (
  writer: { set: (ref: DocumentReference, data: DocumentData) => unknown; update: (ref: DocumentReference, data: DocumentData) => unknown },
  conversationId: string,
  message: { senderId: string; senderSide: ChatSide; senderName: string; text: string; isDemo?: boolean; at?: Timestamp },
) => {
  const ref = conversationRef(conversationId).collection('messages').doc();
  // Explicit times keep a message and an automatic reply in order.
  const at = message.at ?? Timestamp.now();
  writer.set(ref, {
    messageId: ref.id,
    senderId: message.senderId,
    senderSide: message.senderSide,
    senderName: message.senderName,
    text: message.text,
    isDemo: message.isDemo === true,
    createdAt: at,
  });
  writer.update(conversationRef(conversationId), {
    lastMessage: { text: message.text.slice(0, 200), senderSide: message.senderSide, senderName: message.senderName, at },
    [`unread.${other(message.senderSide)}`]: FieldValue.increment(1),
    [`unread.${message.senderSide}`]: 0,
    messageCount: FieldValue.increment(1),
    updatedAt: at,
  });
  return ref.id;
};

export const sendChatMessage = domainCall('sendChatMessage', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { conversationId, text } = parseOrThrow(SendSchema, request.data, correlationId, 'Invalid message');
  const ref = conversationRef(conversationId);

  return db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const conversation = snap.data();
    if (!conversation) throw new DomainError('RESOURCE_NOT_FOUND', 'Conversation not found', correlationId);
    const side = await sideOfInTx(tx, uid, conversation);
    if (!side) throw new DomainError('PERMISSION_DENIED', 'You are not part of this conversation', correlationId);

    const senderName = side === 'doctor' ? conversation.doctorName : conversation.organizationName;
    const sentAt = Timestamp.now();
    const messageId = stageMessage(tx, conversationId, { senderId: uid, senderSide: side, senderName, text, at: sentAt });

    const counterpartId = side === 'doctor' ? conversation.organizationId : conversation.doctorId;
    if (conversation.isDemo === true && isDemoId(counterpartId)) {
      // Sample threads answer straight away so a reviewer sees a live exchange.
      const reply = demoReplyFor(other(side), Number(conversation.messageCount ?? 0));
      const replyAt = Timestamp.fromMillis(sentAt.toMillis() + 1500);
      stageMessage(tx, conversationId, {
        senderId: counterpartId,
        senderSide: other(side),
        senderName: side === 'doctor' ? conversation.organizationName : conversation.doctorName,
        text: reply,
        isDemo: true,
        at: replyAt,
      });
    } else {
      enqueueNotification(tx, {
        dedupeKey: `chat_${messageId}`,
        eventType: 'chat.message',
        ...(side === 'doctor' ? { targetOrganizationId: conversation.organizationId } : { targetUserId: conversation.doctorId }),
        title: senderName,
        body: text.length > 120 ? `${text.slice(0, 117)}…` : text,
        payload: { conversationId },
      });
    }
    return { success: true, messageId };
  });
}, { requireConsent: true, rateLimit: { limit: 120, windowSeconds: 3600 } });

// ── Read receipts ─────────────────────────────────────────

const ReadSchema = z.object({ conversationId: z.string().min(3).max(300), ...CorrelationField }).strict();

export const markConversationRead = domainCall('markConversationRead', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const { conversationId } = parseOrThrow(ReadSchema, request.data, correlationId, 'Invalid request');
  const ref = conversationRef(conversationId);
  await db().runTransaction(async tx => {
    const conversation = (await tx.get(ref)).data();
    if (!conversation) throw new DomainError('RESOURCE_NOT_FOUND', 'Conversation not found', correlationId);
    const side = await sideOfInTx(tx, uid, conversation);
    if (!side) throw new DomainError('PERMISSION_DENIED', 'You are not part of this conversation', correlationId);
    if ((conversation.unread?.[side] ?? 0) !== 0) tx.update(ref, { [`unread.${side}`]: 0 });
  });
  return { success: true };
}, { rateLimit: { limit: 600, windowSeconds: 3600 } });
