/**
 * AI clinical assistant for doctors, backed by the OpenAI API.
 *
 * Each account gets `ai_policy.freeQuestions` free questions; after that an
 * active AI plan (`subscriptions/{uid}.aiUntil`) is required. A question may
 * include one image from the doctor's private `ai/{uid}/` folder, only after the
 * doctor confirms the patient consented and the image carries no identifying
 * details. Answers are decision support, never a diagnosis.
 *
 * BLOCKED_EXTERNAL until an OpenAI key is configured: set OPENAI_API_KEY for the
 * functions runtime (docs/business/ai-assistant.md). Without it the callable
 * answers AI_NOT_CONFIGURED and nothing is charged against the free quota.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { domainCall } from '../shared/callable';
import { DomainError } from '../shared/errors';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { getBusinessConfig, isFlagEnabled } from '../shared/businessConfig';
import { requireAuth } from '../security/guards';
import { hasAiPlan } from '../subscriptions/subscriptionCore';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const AI_DISCLAIMER = 'AI decision support only. Verify against clinical guidelines and your own examination before acting.';

export const SYSTEM_PROMPT = [
  'You are a clinical decision-support assistant for licensed doctors in India using the HealthForce app.',
  'Give a structured, concise answer: likely differentials with reasoning, red flags, suggested investigations, and when to refer.',
  'State uncertainty plainly. Do not claim a definitive diagnosis. Do not identify people in images.',
  'If the question is not clinical, answer briefly and politely.',
].join(' ');

const AskSchema = z.object({
  question: z.string().trim().min(3).max(3000),
  imagePath: z.string().max(300).optional(),
  patientConsentConfirmed: z.boolean().optional(),
});

const usageRef = (uid: string) => db().collection('aiUsage').doc(uid);
const threadRef = (uid: string) => db().collection('aiThreads').doc(uid);

/** Calls OpenAI; separated so tests can replace the transport. */
export let callOpenAi = async (body: Record<string, unknown>, apiKey: string): Promise<string> => {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error('OpenAI request failed', { status: response.status, body: (await response.text()).slice(0, 500) });
    throw new DomainError('INTERNAL_ERROR', 'The AI service is unavailable right now. Please try again.', 'ai');
  }
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new DomainError('INTERNAL_ERROR', 'The AI service returned no answer', 'ai');
  return text;
};
export const setOpenAiTransportForTests = (fn: typeof callOpenAi) => { callOpenAi = fn; };

export const askAssistant = domainCall('askAssistant', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);
  if (!(await isFlagEnabled('ai_assistant_enabled'))) {
    throw new DomainError('FEATURE_DISABLED', 'The AI assistant is not available yet', correlationId);
  }
  const parsed = AskSchema.safeParse(request.data);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Ask a question of 3 to 3000 characters', correlationId);
  const { question, imagePath, patientConsentConfirmed } = parsed.data;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new DomainError('AI_NOT_CONFIGURED', 'The AI assistant is not configured yet', correlationId);

  const doctor = (await db().collection('doctors').doc(uid).get()).data();
  if (!doctor || doctor.isVerified !== true) {
    throw new DomainError('DOCTOR_NOT_VERIFIED', 'The AI assistant is for verified doctors', correlationId);
  }

  const policy = await getBusinessConfig('ai_policy');
  const used = Number((await usageRef(uid).get()).data()?.questionsUsed ?? 0);
  const isFree = used < policy.freeQuestions;
  if (!isFree && !(await hasAiPlan(uid))) {
    throw new DomainError('AI_QUOTA_EXCEEDED', 'You have used your free question. Get the AI plan to continue.', correlationId);
  }

  const content: Record<string, unknown>[] = [{ type: 'text', text: question }];
  if (imagePath) {
    if (patientConsentConfirmed !== true) {
      throw new DomainError('VALIDATION_FAILED', 'Confirm patient consent and that the image has no identifying details', correlationId);
    }
    if (!imagePath.startsWith(`ai/${uid}/`) || imagePath.includes('..')) {
      throw new DomainError('FILE_NOT_ALLOWED', 'Upload the image to your private AI folder first', correlationId);
    }
    const file = getStorage().bucket().file(imagePath);
    const [exists] = await file.exists();
    if (!exists) throw new DomainError('FILE_NOT_ALLOWED', 'The uploaded image was not found', correlationId);
    const [meta] = await file.getMetadata();
    const contentType = String(meta.contentType ?? '');
    if (!IMAGE_TYPES.includes(contentType) || Number(meta.size ?? 0) > MAX_IMAGE_BYTES) {
      throw new DomainError('FILE_NOT_ALLOWED', 'Use a JPEG, PNG or WebP image up to 5 MB', correlationId);
    }
    const [bytes] = await file.download();
    content.push({ type: 'image_url', image_url: { url: `data:${contentType};base64,${bytes.toString('base64')}` } });
  }

  const answer = await callOpenAi({
    model: policy.model,
    max_tokens: policy.maxOutputTokens,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }],
  }, apiKey);

  const batch = db().batch();
  const userMsg = threadRef(uid).collection('messages').doc();
  const aiMsg = threadRef(uid).collection('messages').doc();
  batch.set(userMsg, { role: 'user', text: question, imagePath: imagePath ?? null, createdAt: nowTimestamp(), createdAtMs: Date.now() });
  batch.set(aiMsg, { role: 'assistant', text: answer, model: policy.model, disclaimer: AI_DISCLAIMER, createdAt: nowTimestamp(), createdAtMs: Date.now() + 1 });
  batch.set(usageRef(uid), { questionsUsed: FieldValue.increment(1), lastAskedAt: nowTimestamp() }, { merge: true });
  batch.set(threadRef(uid), { uid, updatedAt: nowTimestamp() }, { merge: true });
  await batch.commit();

  return {
    success: true,
    answer,
    disclaimer: AI_DISCLAIMER,
    freeQuestionsRemaining: Math.max(0, policy.freeQuestions - used - 1),
    usedFreeQuestion: isFree,
  };
}, { rateLimit: { limit: 20, windowSeconds: 3600 } });

/** Quota and plan status for the AI screen. */
export const getAssistantStatus = domainCall('getAssistantStatus', async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const [enabled, policy, usage, plan] = await Promise.all([
    isFlagEnabled('ai_assistant_enabled'), getBusinessConfig('ai_policy'), usageRef(uid).get(), hasAiPlan(uid),
  ]);
  const used = Number(usage.data()?.questionsUsed ?? 0);
  return {
    enabled,
    configured: Boolean(process.env.OPENAI_API_KEY),
    freeQuestions: policy.freeQuestions,
    freeQuestionsRemaining: Math.max(0, policy.freeQuestions - used),
    hasPlan: plan,
    disclaimer: AI_DISCLAIMER,
  };
});
