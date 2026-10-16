/**
 * Helpers shared by the admin portal callables.
 */

import type { DocumentData, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { DomainError } from '../shared/errors';

/** Firestore Timestamp (or ISO string) to ISO string; null for anything else. */
export const toIso = (value: unknown): string | null => {
  if (value && typeof (value as Timestamp).toDate === 'function') return (value as Timestamp).toDate().toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
};

export const toMillis = (value: unknown): number | null => {
  const iso = toIso(value);
  return iso ? Date.parse(iso) : null;
};

/** Upper-case reason codes keep the audit trail filterable. */
export const ReasonCodeSchema = z.string().trim().regex(/^[A-Z0-9_]{2,64}$/, 'Use an upper-case reason code such as POLICY_VIOLATION');
export const NotesSchema = z.string().trim().max(1000).optional();

/** Validates a callable payload, turning schema failures into a VALIDATION_FAILED domain error. */
export const parseOrThrow = <T extends z.ZodTypeAny>(schema: T, data: unknown, correlationId: string, message: string): z.infer<T> => {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', message, correlationId, parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  return parsed.data;
};

/** The correlation ID every callable may carry; schemas below are strict, so it must be allowed. */
export const CorrelationField = { correlationId: z.string().optional() };

/** Display name for a doctor or organization document. */
export const subjectNameOf = (data: DocumentData | undefined): string | null =>
  data?.fullName ?? data?.displayName ?? data?.legalName ?? null;

/** Day key (YYYY-MM-DD) in India time, where the platform operates. */
export const istDayKey = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
