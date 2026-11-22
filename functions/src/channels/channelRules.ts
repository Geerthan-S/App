/**
 * Pure helpers for community channels: tag normalisation and the
 * recommendation score. A doctor sees channels that share their specialty or
 * qualification words first, then the most active ones.
 */

export const normaliseTags = (tags: string[]): string[] =>
  [...new Set(tags.map(t => t.trim().toLowerCase().replace(/[^a-z0-9 &+-]/g, '').replace(/\s+/g, ' ')).filter(t => t.length >= 2))].slice(0, 8);

const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'doctor', 'doctors', 'dr', 'of', 'in', 'to', 'a', 'group', 'channel']);

/** Lower-case words of 3+ letters, without filler words. */
export const keywordsOf = (...texts: (string | undefined | null)[]): string[] =>
  [...new Set(texts.filter(Boolean).join(' ').toLowerCase().split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w)))];

export interface ChannelForScoring {
  tags: string[];
  keywords: string[];
  memberCount: number;
  lastMessageAtMs?: number | null;
}

export interface DoctorInterests {
  /** Specialties, primary specialty and qualification, as free text. */
  terms: string[];
}

export const interestsOf = (doctor: Record<string, unknown> | undefined): DoctorInterests => {
  if (!doctor) return { terms: [] };
  const specialties = Array.isArray(doctor.specialties) ? doctor.specialties.filter(s => typeof s === 'string') : [];
  return {
    terms: keywordsOf(...specialties as string[], doctor.primarySpecialty as string, doctor.qualification as string),
  };
};

/**
 * Score = 10 per tag matching an interest word, 3 per keyword match,
 * plus activity: log2(members + 1) and up to 5 for a message in the last week.
 */
export const scoreChannel = (channel: ChannelForScoring, interests: DoctorInterests, nowMs = Date.now()): number => {
  const terms = new Set(interests.terms);
  const tagWords = channel.tags.flatMap(t => keywordsOf(t));
  const tagHits = new Set(tagWords.filter(w => terms.has(w))).size;
  const keywordHits = channel.keywords.filter(w => terms.has(w) && !tagWords.includes(w)).length;
  const activity = Math.log2((channel.memberCount ?? 0) + 1);
  const ageDays = channel.lastMessageAtMs ? (nowMs - channel.lastMessageAtMs) / 86400000 : Infinity;
  const recency = ageDays <= 7 ? 5 * (1 - ageDays / 7) : 0;
  return Math.round((tagHits * 10 + keywordHits * 3 + activity + recency) * 100) / 100;
};
