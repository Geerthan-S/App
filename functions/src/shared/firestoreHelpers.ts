/**
 * Firestore Helper Utilities & Normalizers
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const db = () => getFirestore();

export const nowTimestamp = () => FieldValue.serverTimestamp();

export const normalizeRegistrationNo = (council: string, regNo: string): string => {
  const cleanCouncil = council.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const cleanReg = regNo.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${cleanCouncil}_${cleanReg}`;
};

/**
 * Returns all YYYY-MM-DD UTC date strings between startAt and endAt
 */
export const getDateIntervals = (startAtIso: string, endAtIso: string): string[] => {
  const startDate = new Date(startAtIso);
  const endDate = new Date(endAtIso);

  const dates: string[] = [];
  const curr = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));

  while (curr <= end) {
    const yyyy = curr.getUTCFullYear();
    const mm = String(curr.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(curr.getUTCDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return dates;
};

/**
 * Checks if two intervals [s1, e1] and [s2, e2] overlap
 */
export const intervalsOverlap = (s1: string, e1: string, s2: string, e2: string): boolean => {
  const start1 = new Date(s1).getTime();
  const end1 = new Date(e1).getTime();
  const start2 = new Date(s2).getTime();
  const end2 = new Date(e2).getTime();

  return start1 < end2 && start2 < end1;
};

export const sanitizeCorrelationId = (id?: string): string => {
  if (id && typeof id === 'string' && id.length > 0 && id.length <= 64) {
    return id.replace(/[^a-zA-Z0-9-_]/g, '');
  }
  return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};
