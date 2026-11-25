/**
 * Community channels: doctors create public or private (invite code) channels,
 * join, and talk in text, and in voice notes and images when media is turned on.
 * Messages are read live by members (Firestore rules); every write goes through
 * these callables so membership, limits and moderation are enforced in one place.
 */

import { randomBytes } from 'crypto';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { domainCall } from '../shared/callable';
import { DomainError } from '../shared/errors';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { DocIdSchema } from '../shared/schemas';
import { getBusinessConfig, isFlagEnabled } from '../shared/businessConfig';
import { requireAuth, requireAdmin } from '../security/guards';
import { stageAudit } from '../audit/auditLogger';
import { interestsOf, keywordsOf, normaliseTags, scoreChannel } from './channelRules';

const channelRef = (id: string) => db().collection('channels').doc(id);
const memberRef = (channelId: string, uid: string) => channelRef(channelId).collection('members').doc(uid);
const membershipRef = (uid: string, channelId: string) => db().collection('channelMemberships').doc(`${uid}_${channelId}`);
const inviteRef = (channelId: string) => channelRef(channelId).collection('private').doc('invite');

const VOICE_TYPES = ['audio/aac', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/wav'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_VOICE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const requireChannelsOn = async (correlationId: string) => {
  if (!(await isFlagEnabled('channels_enabled'))) {
    throw new DomainError('FEATURE_DISABLED', 'Community channels are not available yet', correlationId);
  }
};

const requireDoctor = async (uid: string, correlationId: string, verified = true) => {
  const doctor = (await db().collection('doctors').doc(uid).get()).data();
  if (!doctor) throw new DomainError('PERMISSION_DENIED', 'Channels are for doctor accounts', correlationId);
  if (verified && doctor.isVerified !== true) {
    throw new DomainError('DOCTOR_NOT_VERIFIED', 'Get verified to post in channels', correlationId);
  }
  return doctor;
};

const CreateSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(300).default(''),
  tags: z.array(z.string().max(30)).max(8).default([]),
  visibility: z.enum(['public', 'private']).default('public'),
});

export const createChannel = domainCall('createChannel', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  await requireChannelsOn(correlationId);
  const parsed = CreateSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Check the channel name and tags', correlationId, parsed.error.flatten().fieldErrors);
  const doctor = await requireDoctor(uid, correlationId);
  const policy = await getBusinessConfig('channel_policy');
  const owned = await db().collection('channels').where('ownerId', '==', uid).where('status', '==', 'active').count().get();
  if (owned.data().count >= policy.maxOwnedChannels) {
    throw new DomainError('VALIDATION_FAILED', `You can own up to ${policy.maxOwnedChannels} channels`, correlationId);
  }

  const { name, description, visibility } = parsed.data;
  const tags = normaliseTags(parsed.data.tags);
  const ref = db().collection('channels').doc();
  const inviteCode = visibility === 'private' ? randomBytes(6).toString('base64url').toUpperCase() : null;
  const batch = db().batch();
  batch.set(ref, {
    channelId: ref.id, name, description, tags, keywords: keywordsOf(name, description, ...tags), visibility,
    ownerId: uid, ownerName: doctor.fullName ?? null, memberCount: 1, messageCount: 0, lastMessageAt: null,
    lastMessageAtMs: null, status: 'active', createdAt: nowTimestamp(), updatedAt: nowTimestamp(),
  });
  batch.set(memberRef(ref.id, uid), { uid, role: 'owner', displayName: doctor.fullName ?? 'Doctor', joinedAt: nowTimestamp() });
  batch.set(membershipRef(uid, ref.id), { uid, channelId: ref.id, role: 'owner', joinedAt: nowTimestamp() });
  if (inviteCode) batch.set(inviteRef(ref.id), { code: inviteCode, createdAt: nowTimestamp() });
  stageAudit(batch, {
    actorId: uid, actorRole: 'doctor', action: 'CHANNEL_CREATED', targetType: 'channels', targetId: ref.id,
    reasonCode: visibility.toUpperCase(), correlationId, result: 'SUCCESS', afterSummary: { name, tags },
  });
  await batch.commit();
  return { success: true, channelId: ref.id, inviteCode };
});

const JoinSchema = z.object({ channelId: DocIdSchema, inviteCode: z.string().trim().max(20).optional() });

export const joinChannel = domainCall('joinChannel', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  await requireChannelsOn(correlationId);
  const parsed = JoinSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'channelId is required', correlationId);
  const { channelId, inviteCode } = parsed.data;
  const doctor = await requireDoctor(uid, correlationId, false);

  await db().runTransaction(async tx => {
    const [channelSnap, memberSnap, inviteSnap, banSnap] = await Promise.all([
      tx.get(channelRef(channelId)), tx.get(memberRef(channelId, uid)), tx.get(inviteRef(channelId)),
      tx.get(channelRef(channelId).collection('bans').doc(uid)),
    ]);
    const channel = channelSnap.data();
    if (!channel || channel.status !== 'active') throw new DomainError('RESOURCE_NOT_FOUND', 'Channel not found', correlationId);
    if (memberSnap.exists) return;
    if (banSnap.exists) throw new DomainError('PERMISSION_DENIED', 'You were removed from this channel', correlationId);
    if (channel.visibility === 'private' && (!inviteCode || inviteCode.toUpperCase() !== inviteSnap.data()?.code)) {
      throw new DomainError('PERMISSION_DENIED', 'This private channel needs a valid invite code', correlationId);
    }
    tx.set(memberRef(channelId, uid), { uid, role: 'member', displayName: doctor.fullName ?? 'Doctor', joinedAt: nowTimestamp() });
    tx.set(membershipRef(uid, channelId), { uid, channelId, role: 'member', joinedAt: nowTimestamp() });
    tx.update(channelRef(channelId), { memberCount: FieldValue.increment(1), updatedAt: nowTimestamp() });
  });
  return { success: true, channelId };
});

/** Joins a private channel from its invite code alone. */
export const joinChannelByCode = domainCall('joinChannelByCode', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  await requireChannelsOn(correlationId);
  const code = z.string().trim().min(4).max(20).safeParse(request.data?.inviteCode);
  if (!code.success) throw new DomainError('VALIDATION_FAILED', 'Enter the invite code', correlationId);
  const match = await db().collectionGroup('private').where('code', '==', code.data.toUpperCase()).limit(1).get();
  const channelId = match.docs[0]?.ref.parent.parent?.id;
  if (!channelId) throw new DomainError('RESOURCE_NOT_FOUND', 'No channel has this invite code', correlationId);
  await requireDoctor(uid, correlationId, false);
  return joinChannelInternal(uid, channelId, code.data, correlationId);
});

const joinChannelInternal = async (uid: string, channelId: string, inviteCode: string, correlationId: string) => {
  const doctor = (await db().collection('doctors').doc(uid).get()).data();
  await db().runTransaction(async tx => {
    const [channelSnap, memberSnap, banSnap] = await Promise.all([
      tx.get(channelRef(channelId)), tx.get(memberRef(channelId, uid)), tx.get(channelRef(channelId).collection('bans').doc(uid)),
    ]);
    if (channelSnap.data()?.status !== 'active') throw new DomainError('RESOURCE_NOT_FOUND', 'Channel not found', correlationId);
    if (memberSnap.exists) return;
    if (banSnap.exists) throw new DomainError('PERMISSION_DENIED', 'You were removed from this channel', correlationId);
    tx.set(memberRef(channelId, uid), { uid, role: 'member', displayName: doctor?.fullName ?? 'Doctor', joinedAt: nowTimestamp(), via: 'invite' });
    tx.set(membershipRef(uid, channelId), { uid, channelId, role: 'member', joinedAt: nowTimestamp() });
    tx.update(channelRef(channelId), { memberCount: FieldValue.increment(1), updatedAt: nowTimestamp() });
  });
  return { success: true, channelId, inviteCode };
};

export const leaveChannel = domainCall('leaveChannel', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const channelId = DocIdSchema.safeParse(request.data?.channelId);
  if (!channelId.success) throw new DomainError('VALIDATION_FAILED', 'channelId is required', correlationId);
  await db().runTransaction(async tx => {
    const memberSnap = await tx.get(memberRef(channelId.data, uid));
    if (!memberSnap.exists) return;
    if (memberSnap.data()?.role === 'owner') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'The owner cannot leave; close the channel instead', correlationId);
    }
    tx.delete(memberSnap.ref);
    tx.delete(membershipRef(uid, channelId.data));
    tx.update(channelRef(channelId.data), { memberCount: FieldValue.increment(-1), updatedAt: nowTimestamp() });
  });
  return { success: true };
});

const SendSchema = z.object({
  channelId: DocIdSchema,
  type: z.enum(['text', 'voice', 'image']).default('text'),
  text: z.string().trim().max(4000).default(''),
  mediaPath: z.string().max(300).optional(),
  durationSeconds: z.number().min(0).max(600).optional(),
});

export const sendChannelMessage = domainCall('sendChannelMessage', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  await requireChannelsOn(correlationId);
  const parsed = SendSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid message', correlationId);
  const { channelId, type, text, mediaPath, durationSeconds } = parsed.data;
  const policy = await getBusinessConfig('channel_policy');
  if (text.length > policy.maxMessageLength) {
    throw new DomainError('VALIDATION_FAILED', `Messages can be up to ${policy.maxMessageLength} characters`, correlationId);
  }
  if (type === 'text' && !text) throw new DomainError('VALIDATION_FAILED', 'Message is empty', correlationId);
  const doctor = await requireDoctor(uid, correlationId);

  let media: Record<string, unknown> | null = null;
  if (type !== 'text') {
    if (!(await isFlagEnabled('channels_media_enabled'))) {
      throw new DomainError('FEATURE_DISABLED', 'Voice notes and images are not available yet', correlationId);
    }
    if (!mediaPath || !mediaPath.startsWith(`channels/${channelId}/${uid}/`) || mediaPath.includes('..')) {
      throw new DomainError('FILE_NOT_ALLOWED', 'Upload the file to your channel folder first', correlationId);
    }
    if (type === 'voice' && (durationSeconds ?? 0) > policy.maxVoiceSeconds) {
      throw new DomainError('VALIDATION_FAILED', `Voice notes can be up to ${policy.maxVoiceSeconds} seconds`, correlationId);
    }
    const [exists] = await getStorage().bucket().file(mediaPath).exists();
    if (!exists) throw new DomainError('FILE_NOT_ALLOWED', 'The uploaded file was not found', correlationId);
    const [meta] = await getStorage().bucket().file(mediaPath).getMetadata();
    const contentType = String(meta.contentType ?? '');
    const size = Number(meta.size ?? 0);
    const allowed = type === 'voice' ? VOICE_TYPES.includes(contentType) && size <= MAX_VOICE_BYTES :
      IMAGE_TYPES.includes(contentType) && size <= MAX_IMAGE_BYTES;
    if (!allowed) throw new DomainError('FILE_NOT_ALLOWED', 'File type or size is not allowed', correlationId);
    media = { path: mediaPath, contentType, sizeBytes: size, durationSeconds: durationSeconds ?? null };
  }

  const messageRef = channelRef(channelId).collection('messages').doc();
  await db().runTransaction(async tx => {
    const [channelSnap, memberSnap] = await Promise.all([tx.get(channelRef(channelId)), tx.get(memberRef(channelId, uid))]);
    if (channelSnap.data()?.status !== 'active') throw new DomainError('RESOURCE_NOT_FOUND', 'Channel not found', correlationId);
    if (!memberSnap.exists) throw new DomainError('PERMISSION_DENIED', 'Join the channel to post', correlationId);
    if (memberSnap.data()?.mutedUntil && new Date(memberSnap.data()!.mutedUntil).getTime() > Date.now()) {
      throw new DomainError('PERMISSION_DENIED', 'You are muted in this channel for now', correlationId);
    }
    tx.set(messageRef, {
      messageId: messageRef.id, channelId, senderId: uid, senderName: doctor.fullName ?? 'Doctor',
      senderSpecialty: doctor.primarySpecialty ?? null, type, text, media, deleted: false, createdAt: nowTimestamp(),
    });
    tx.update(channelRef(channelId), {
      messageCount: FieldValue.increment(1), lastMessageAt: nowTimestamp(), lastMessageAtMs: Date.now(),
      lastMessagePreview: type === 'text' ? text.slice(0, 120) : type === 'voice' ? '🎤 Voice note' : '🖼 Image',
      updatedAt: nowTimestamp(),
    });
  });
  return { success: true, messageId: messageRef.id };
}, { rateLimit: { limit: 60, windowSeconds: 60 } });

const MessageRefSchema = z.object({ channelId: DocIdSchema, messageId: DocIdSchema });

/** The sender, the channel owner or a moderator removes a message. */
export const deleteChannelMessage = domainCall('deleteChannelMessage', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = MessageRefSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid message', correlationId);
  const { channelId, messageId } = parsed.data;
  await db().runTransaction(async tx => {
    const msgRef = channelRef(channelId).collection('messages').doc(messageId);
    const [msgSnap, memberSnap] = await Promise.all([tx.get(msgRef), tx.get(memberRef(channelId, uid))]);
    if (!msgSnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Message not found', correlationId);
    const role = memberSnap.data()?.role;
    if (msgSnap.data()?.senderId !== uid && role !== 'owner' && role !== 'moderator') {
      throw new DomainError('PERMISSION_DENIED', 'Only the sender or the channel owner can remove this', correlationId);
    }
    tx.update(msgRef, { deleted: true, text: '', media: null, deletedBy: uid, deletedAt: nowTimestamp() });
  });
  return { success: true };
});

const RemoveSchema = z.object({ channelId: DocIdSchema, memberUid: DocIdSchema, ban: z.boolean().default(false) });

/** The owner or a moderator removes (and optionally bans) a member. */
export const removeChannelMember = domainCall('removeChannelMember', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = RemoveSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid request', correlationId);
  const { channelId, memberUid, ban } = parsed.data;
  await db().runTransaction(async tx => {
    const [actor, target] = await Promise.all([tx.get(memberRef(channelId, uid)), tx.get(memberRef(channelId, memberUid))]);
    const role = actor.data()?.role;
    if (role !== 'owner' && role !== 'moderator') throw new DomainError('PERMISSION_DENIED', 'Only the owner or a moderator can remove members', correlationId);
    if (!target.exists) return;
    if (target.data()?.role === 'owner') throw new DomainError('PERMISSION_DENIED', 'The owner cannot be removed', correlationId);
    tx.delete(target.ref);
    tx.delete(membershipRef(memberUid, channelId));
    tx.update(channelRef(channelId), { memberCount: FieldValue.increment(-1), updatedAt: nowTimestamp() });
    if (ban) tx.set(channelRef(channelId).collection('bans').doc(memberUid), { bannedBy: uid, at: nowTimestamp() });
    stageAudit(tx, {
      actorId: uid, actorRole: 'doctor', action: ban ? 'CHANNEL_MEMBER_BANNED' : 'CHANNEL_MEMBER_REMOVED',
      targetType: 'channels', targetId: channelId, reasonCode: 'OWNER_MODERATION', correlationId, result: 'SUCCESS',
      afterSummary: { memberUid },
    });
  });
  return { success: true };
});

const ReportSchema = z.object({
  channelId: DocIdSchema,
  messageId: DocIdSchema,
  reason: z.enum(['spam', 'abuse', 'patient_privacy', 'misinformation', 'other']),
  details: z.string().trim().max(500).optional(),
});

/** Any member reports a message to the platform moderators. */
export const reportChannelMessage = domainCall('reportChannelMessage', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const parsed = ReportSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid report', correlationId);
  const { channelId, messageId, reason, details } = parsed.data;
  const reportRef = db().collection('channelReports').doc(`${uid}_${channelId}_${messageId}`);
  await db().runTransaction(async tx => {
    const [msgSnap, memberSnap, existing] = await Promise.all([
      tx.get(channelRef(channelId).collection('messages').doc(messageId)), tx.get(memberRef(channelId, uid)), tx.get(reportRef),
    ]);
    if (!msgSnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Message not found', correlationId);
    if (!memberSnap.exists) throw new DomainError('PERMISSION_DENIED', 'Only members can report messages', correlationId);
    if (existing.exists) return;
    tx.set(reportRef, {
      reportId: reportRef.id, channelId, messageId, reporterId: uid, reason, details: details ?? null,
      messageText: (msgSnap.data()?.text ?? '').slice(0, 500), messageType: msgSnap.data()?.type ?? 'text',
      senderId: msgSnap.data()?.senderId ?? null, status: 'open', createdAt: nowTimestamp(),
    });
  });
  return { success: true, reportId: reportRef.id };
}, { rateLimit: { limit: 20, windowSeconds: 3600 } });

/** Channels ranked for the signed-in doctor: specialty matches first, then activity. */
export const listRecommendedChannels = domainCall('listRecommendedChannels', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  await requireChannelsOn(correlationId);
  const search = z.string().trim().max(60).catch('').parse(request.data?.search ?? '');
  const [doctorSnap, channelsSnap, mine] = await Promise.all([
    db().collection('doctors').doc(uid).get(),
    db().collection('channels').where('visibility', '==', 'public').where('status', '==', 'active')
      .orderBy('memberCount', 'desc').limit(300).get(),
    db().collection('channelMemberships').where('uid', '==', uid).limit(300).get(),
  ]);
  const joined = new Set(mine.docs.map(d => d.data().channelId));
  const interests = interestsOf(doctorSnap.data());
  const searchWords = keywordsOf(search);
  const ranked = channelsSnap.docs
    .map(d => ({ id: d.id, data: d.data() }))
    .filter(c => !searchWords.length || searchWords.every(w => (c.data.keywords ?? []).some((k: string) => k.startsWith(w))))
    .map(c => ({
      channelId: c.id, name: c.data.name, description: c.data.description, tags: c.data.tags ?? [],
      memberCount: c.data.memberCount ?? 0, lastMessagePreview: c.data.lastMessagePreview ?? null,
      joined: joined.has(c.id),
      score: scoreChannel({ tags: c.data.tags ?? [], keywords: c.data.keywords ?? [], memberCount: c.data.memberCount ?? 0, lastMessageAtMs: c.data.lastMessageAtMs ?? null }, interests),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
  return { channels: ranked, interests: interests.terms };
});

/** Platform moderators: open channel reports. */
export const listChannelReports = domainCall('listChannelReports', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  requireAdmin(request, correlationId);
  const snap = await db().collection('channelReports').where('status', '==', 'open').orderBy('createdAt', 'desc').limit(100).get();
  const channelNames = new Map<string, string>();
  await Promise.all([...new Set(snap.docs.map(d => d.data().channelId as string))].map(async id => {
    channelNames.set(id, (await channelRef(id).get()).data()?.name ?? id);
  }));
  return {
    reports: snap.docs.map(d => ({
      ...d.data(), channelName: channelNames.get(d.data().channelId), createdAt: d.data().createdAt?.toDate?.().toISOString() ?? null,
    })),
  };
}, { audience: 'staff' });

const ModerateSchema = z.object({
  reportId: z.string().regex(/^[A-Za-z0-9_-]{1,400}$/),
  action: z.enum(['remove_message', 'remove_and_ban_sender', 'close_channel', 'dismiss']),
});

export const moderateChannelReport = domainCall('moderateChannelReport', async (request: CallableRequest) => {
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const staffUid = requireAdmin(request, correlationId);
  const parsed = ModerateSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid moderation action', correlationId);
  const { reportId, action } = parsed.data;
  await db().runTransaction(async tx => {
    const reportSnap = await tx.get(db().collection('channelReports').doc(reportId));
    if (!reportSnap.exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Report not found', correlationId);
    const report = reportSnap.data()!;
    const senderMember = report.senderId ? await tx.get(memberRef(report.channelId, report.senderId)) : null;
    const msgRef = channelRef(report.channelId).collection('messages').doc(report.messageId);
    if (action === 'remove_message' || action === 'remove_and_ban_sender') {
      tx.update(msgRef, { deleted: true, text: '', media: null, deletedBy: staffUid, deletedAt: nowTimestamp() });
    }
    if (action === 'remove_and_ban_sender' && report.senderId && senderMember?.exists && senderMember.data()?.role !== 'owner') {
      tx.delete(senderMember.ref);
      tx.delete(membershipRef(report.senderId, report.channelId));
      tx.set(channelRef(report.channelId).collection('bans').doc(report.senderId), { bannedBy: staffUid, at: nowTimestamp() });
      tx.update(channelRef(report.channelId), { memberCount: FieldValue.increment(-1) });
    }
    if (action === 'close_channel') tx.update(channelRef(report.channelId), { status: 'closed', closedBy: staffUid, updatedAt: nowTimestamp() });
    tx.update(reportSnap.ref, { status: 'resolved', action, resolvedBy: staffUid, resolvedAt: nowTimestamp() });
    stageAudit(tx, {
      actorId: staffUid, actorRole: 'admin', action: `CHANNEL_${action.toUpperCase()}`, targetType: 'channels',
      targetId: report.channelId, reasonCode: report.reason, correlationId, result: 'SUCCESS', afterSummary: { reportId },
    });
  });
  return { success: true };
}, { audience: 'staff' });

/** The owner closes their channel. */
export const closeChannel = domainCall('closeChannel', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const channelId = DocIdSchema.safeParse(request.data?.channelId);
  if (!channelId.success) throw new DomainError('VALIDATION_FAILED', 'channelId is required', correlationId);
  await db().runTransaction(async tx => {
    const snap = await tx.get(channelRef(channelId.data));
    if (snap.data()?.ownerId !== uid) throw new DomainError('PERMISSION_DENIED', 'Only the owner can close this channel', correlationId);
    tx.update(snap.ref, { status: 'closed', closedBy: uid, updatedAt: nowTimestamp() });
  });
  return { success: true };
});

/** The owner reads the invite code of a private channel. */
export const getChannelInvite = domainCall('getChannelInvite', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  const channelId = DocIdSchema.safeParse(request.data?.channelId);
  if (!channelId.success) throw new DomainError('VALIDATION_FAILED', 'channelId is required', correlationId);
  const [member, invite] = await Promise.all([memberRef(channelId.data, uid).get(), inviteRef(channelId.data).get()]);
  if (!['owner', 'moderator'].includes(member.data()?.role)) throw new DomainError('PERMISSION_DENIED', 'Only the owner can share the invite code', correlationId);
  return { channelId: channelId.data, inviteCode: invite.data()?.code ?? null };
});
