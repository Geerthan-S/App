/**
 * Notification preferences (blueprint §3.9): muted categories and quiet hours.
 * Preferences only ever suppress the push; the in-app inbox always receives
 * the message, and critical events (an offer with a deadline, a cancelled or
 * expired shift) ignore both mutes and quiet hours.
 */

import type { DocumentData } from 'firebase-admin/firestore';

export const NOTIFICATION_CATEGORIES = ['applications', 'duty_alerts', 'verification', 'team', 'messages'] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number] | 'general';

/** Time-critical: the person must act or their shift changed. */
export const CRITICAL_EVENT_TYPES = new Set(['application.selected', 'assignment.cancelled', 'assignment.expired']);

/** Platform operates in India; quiet hours are interpreted in IST. */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

export const categoryOf = (eventType: string): NotificationCategory => {
  if (eventType === 'duty.saved_search_match') return 'duty_alerts';
  if (/^(application|assignment)\./.test(eventType) || eventType === 'duty.updated') return 'applications';
  if (eventType.startsWith('verification.')) return 'verification';
  if (eventType.startsWith('organization.')) return 'team';
  if (eventType.startsWith('chat.')) return 'messages';
  return 'general';
};

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** True when `nowMs` falls inside the quiet window (which may cross midnight). */
export const inQuietHours = (quiet: { enabled?: boolean; start?: string; end?: string } | undefined, nowMs: number): boolean => {
  if (!quiet?.enabled || !quiet.start || !quiet.end) return false;
  const istMinutes = (Math.floor(nowMs / 60000) + IST_OFFSET_MINUTES) % (24 * 60);
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? istMinutes >= start && istMinutes < end : istMinutes >= start || istMinutes < end;
};

/** Whether a push for this event should go to a user with these preferences. */
export const shouldPush = (eventType: string, preferences: DocumentData | undefined, nowMs = Date.now()): boolean => {
  if (CRITICAL_EVENT_TYPES.has(eventType)) return true;
  const muted: unknown = preferences?.mutedCategories;
  if (Array.isArray(muted) && muted.includes(categoryOf(eventType))) return false;
  return !inQuietHours(preferences?.quietHours, nowMs);
};
