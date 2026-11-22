/**
 * Pure attendance rules: distance to the facility and the discrepancies a
 * check-in or check-out raises. Kept free of Firestore so they are unit tested.
 */

import type { AttendancePolicy } from '../shared/businessConfig';

export interface ScanLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  /** Reported by the device when a mock-location app is active. */
  isMocked?: boolean;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export type AttendanceKind = 'check_in' | 'check_out';

export type DiscrepancyCode =
  | 'LATE_CHECK_IN'
  | 'EARLY_CHECK_OUT'
  | 'OUTSIDE_RADIUS'
  | 'LOCATION_MISSING'
  | 'MOCK_LOCATION'
  | 'FACILITY_LOCATION_UNKNOWN';

export interface ScanEvaluation {
  distanceMeters: number | null;
  withinRadius: boolean | null;
  /** Positive when late (check-in) or early (check-out), in minutes. */
  deviationMinutes: number;
  discrepancies: DiscrepancyCode[];
}

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in metres. */
export const haversineMeters = (a: GeoPoint, b: GeoPoint): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const evaluateScan = (input: {
  kind: AttendanceKind;
  scannedAtMs: number;
  shiftStartIso: string;
  shiftEndIso: string;
  location?: ScanLocation | null;
  facility?: GeoPoint | null;
  policy: AttendancePolicy;
}): ScanEvaluation => {
  const discrepancies: DiscrepancyCode[] = [];
  const { kind, policy } = input;

  let deviationMinutes = 0;
  if (kind === 'check_in') {
    deviationMinutes = Math.round((input.scannedAtMs - new Date(input.shiftStartIso).getTime()) / 60000);
    if (deviationMinutes > policy.lateToleranceMinutes) discrepancies.push('LATE_CHECK_IN');
  } else {
    deviationMinutes = Math.round((new Date(input.shiftEndIso).getTime() - input.scannedAtMs) / 60000);
    if (deviationMinutes > policy.earlyLeaveToleranceMinutes) discrepancies.push('EARLY_CHECK_OUT');
  }

  let distanceMeters: number | null = null;
  let withinRadius: boolean | null = null;
  if (!input.location) {
    discrepancies.push('LOCATION_MISSING');
  } else {
    if (input.location.isMocked) discrepancies.push('MOCK_LOCATION');
    if (!input.facility) {
      discrepancies.push('FACILITY_LOCATION_UNKNOWN');
    } else {
      distanceMeters = Math.round(haversineMeters(input.location, input.facility));
      withinRadius = distanceMeters <= policy.radiusMeters;
      if (!withinRadius) discrepancies.push('OUTSIDE_RADIUS');
    }
  }

  return { distanceMeters, withinRadius, deviationMinutes: Math.max(0, deviationMinutes), discrepancies };
};

/** One readable line per discrepancy, for the hospital's acknowledgement card. */
export const describeDiscrepancy = (code: DiscrepancyCode, evaluation: ScanEvaluation): string => {
  switch (code) {
    case 'LATE_CHECK_IN': return `Checked in ${evaluation.deviationMinutes} min after the shift start`;
    case 'EARLY_CHECK_OUT': return `Checked out ${evaluation.deviationMinutes} min before the shift end`;
    case 'OUTSIDE_RADIUS': return `Scanned ${evaluation.distanceMeters} m from the hospital`;
    case 'LOCATION_MISSING': return 'No location was shared at the scan';
    case 'MOCK_LOCATION': return 'The phone reported a simulated (mock) location';
    case 'FACILITY_LOCATION_UNKNOWN': return 'The hospital branch has no saved map location';
  }
};

export const ATTENDANCE_CODE_PREFIX = 'HFATT1:';
