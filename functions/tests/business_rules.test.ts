/** Pure rules behind attendance, charges, plans, last-minute eligibility and channel ranking. */
import { evaluateScan, haversineMeters } from '../src/attendance/attendanceRules';
import { confirmationCharges, dutyBookingCharges, subscriptionCharges } from '../src/payments/charges';
import { addMonths, extendedUntil } from '../src/subscriptions/subscriptionCore';
import { indiaDateOf, lastMinuteEligibility } from '../src/lastMinute/lastMinuteCore';
import { interestsOf, normaliseTags, scoreChannel } from '../src/channels/channelRules';
import { BUSINESS_DEFAULTS, mergeWithDefaults } from '../src/shared/businessConfig';
import { specialtyMatches } from '../src/subscriptions/earlyAccess';

const policy = BUSINESS_DEFAULTS.attendance_policy;
const hospital = { latitude: 13.0604, longitude: 80.2496 };

describe('attendance rules', () => {
  test('distance is measured in metres', () => {
    // About 0.009 degrees of latitude is 1 km.
    expect(Math.round(haversineMeters(hospital, { latitude: 13.0694, longitude: 80.2496 }) / 10) * 10).toBe(1000);
  });

  test('an on-time check-in on site raises nothing', () => {
    const start = '2026-12-01T08:00:00.000Z';
    const result = evaluateScan({
      kind: 'check_in', scannedAtMs: Date.parse(start) + 5 * 60000, shiftStartIso: start, shiftEndIso: '2026-12-01T16:00:00.000Z',
      location: { latitude: 13.0606, longitude: 80.2497 }, facility: hospital, policy,
    });
    expect(result.discrepancies).toEqual([]);
    expect(result.withinRadius).toBe(true);
    expect(result.deviationMinutes).toBe(5);
  });

  test('late, far away and mocked check-ins are all flagged', () => {
    const start = '2026-12-01T08:00:00.000Z';
    const result = evaluateScan({
      kind: 'check_in', scannedAtMs: Date.parse(start) + 40 * 60000, shiftStartIso: start, shiftEndIso: '2026-12-01T16:00:00.000Z',
      location: { latitude: 13.08, longitude: 80.2496, isMocked: true }, facility: hospital, policy,
    });
    expect(result.discrepancies).toEqual(['LATE_CHECK_IN', 'MOCK_LOCATION', 'OUTSIDE_RADIUS']);
    expect(result.deviationMinutes).toBe(40);
  });

  test('early check-out and a missing location are flagged', () => {
    const end = '2026-12-01T16:00:00.000Z';
    const result = evaluateScan({
      kind: 'check_out', scannedAtMs: Date.parse(end) - 60 * 60000, shiftStartIso: '2026-12-01T08:00:00.000Z', shiftEndIso: end,
      location: null, facility: hospital, policy,
    });
    expect(result.discrepancies).toEqual(['EARLY_CHECK_OUT', 'LOCATION_MISSING']);
  });
});

describe('charges', () => {
  test('GST applies to the platform fee only, not the duty amount', () => {
    const b = dutyBookingCharges(5000, 100, 18);
    expect(b.totalPaise).toBe(511800);
    expect(b.passThroughPaise).toBe(500000);
    expect(b.platformRevenuePaise).toBe(10000);
    expect(b.gstPaise).toBe(1800);
    expect(b.lines.map(l => l.code)).toEqual(['duty_amount', 'platform_fee', 'gst']);
  });

  test('a ₹10 platform fee adds ₹1.80 GST', () => {
    expect(dutyBookingCharges(5000, 10, 18).totalPaise).toBe(501180);
  });

  test('confirmation charge and subscriptions are fully taxable', () => {
    expect(confirmationCharges(100, 18).totalPaise).toBe(11800);
    expect(subscriptionCharges('Premium', 1000, 18).totalPaise).toBe(118000);
    expect(subscriptionCharges('Free', 0, 18).lines).toEqual([]);
  });
});

describe('subscription periods', () => {
  test('months are calendar months, clamped to short months', () => {
    expect(addMonths(Date.parse('2026-01-31T10:00:00.000Z'), 1)).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(Date.parse('2026-08-15T00:00:00.000Z'), 6)).toBe('2027-02-15T00:00:00.000Z');
  });

  test('renewing early extends from the current end date', () => {
    const now = Date.parse('2026-11-01T00:00:00.000Z');
    expect(extendedUntil('2026-12-01T00:00:00.000Z', 6, now)).toBe('2027-06-01T00:00:00.000Z');
    expect(extendedUntil('2026-10-01T00:00:00.000Z', 6, now)).toBe('2027-05-01T00:00:00.000Z');
    expect(extendedUntil(undefined, 1, now)).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('last-minute eligibility', () => {
  const lmPolicy = BUSINESS_DEFAULTS.last_minute_policy;
  const now = Date.parse('2026-11-22T16:30:00.000Z'); // 10 pm in India
  const duty = (startOffsetH: number, extra: Record<string, unknown> = {}) => ({
    status: 'published', remainingHeadcount: 1, schedule: { startAt: new Date(now + startOffsetH * 3600000).toISOString() }, ...extra,
  });

  test('a duty tomorrow morning qualifies', () => {
    expect(lastMinuteEligibility(duty(10), lmPolicy, now)).toEqual({ ok: true });
  });

  test('too far out, too close, filled or already requested does not', () => {
    expect(lastMinuteEligibility(duty(30), lmPolicy, now).ok).toBe(false);
    expect(lastMinuteEligibility(duty(0.5), lmPolicy, now).ok).toBe(false);
    expect(lastMinuteEligibility(duty(10, { remainingHeadcount: 0 }), lmPolicy, now).ok).toBe(false);
    expect(lastMinuteEligibility(duty(10, { lastMinute: { status: 'searching' } }), lmPolicy, now).ok).toBe(false);
    expect(lastMinuteEligibility(duty(10, { lastMinute: { status: 'refunded' } }), lmPolicy, now)).toEqual({ ok: true });
  });

  test('service dates are India dates', () => {
    expect(indiaDateOf('2026-11-22T20:00:00.000Z')).toBe('2026-11-23');
  });
});

describe('channel recommendations', () => {
  test('tags are cleaned and de-duplicated', () => {
    expect(normaliseTags([' Dental ', 'dental', 'Oral Surgery!!', 'x'])).toEqual(['dental', 'oral surgery']);
  });

  test('a dentist sees dental channels before busier unrelated ones', () => {
    const interests = interestsOf({ specialties: ['Dental Surgery'], primarySpecialty: 'Dentistry', qualification: 'BDS' });
    const dental = scoreChannel({ tags: ['dental'], keywords: ['dental', 'cases'], memberCount: 20 }, interests);
    const cardio = scoreChannel({ tags: ['cardiology'], keywords: ['cardiology'], memberCount: 2000 }, interests);
    expect(dental).toBeGreaterThan(cardio);
  });

  test('recent activity lifts a channel', () => {
    const now = Date.now();
    const quiet = scoreChannel({ tags: [], keywords: [], memberCount: 10, lastMessageAtMs: now - 30 * 86400000 }, { terms: [] }, now);
    const active = scoreChannel({ tags: [], keywords: [], memberCount: 10, lastMessageAtMs: now - 3600000 }, { terms: [] }, now);
    expect(active).toBeGreaterThan(quiet);
  });
});

describe('business config', () => {
  test('invalid stored fields fall back to defaults field by field', () => {
    const merged = mergeWithDefaults('attendance_policy', { radiusMeters: 200, codeTtlSeconds: 5, unknown: true });
    expect(merged.radiusMeters).toBe(200);
    expect(merged.codeTtlSeconds).toBe(90);
    expect(merged).not.toHaveProperty('unknown');
  });

  test('early-access alerts go to matching specialties or doctors without any listed', () => {
    expect(specialtyMatches({ specialties: ['Emergency Medicine'] }, 'Emergency Medicine')).toBe(true);
    expect(specialtyMatches({ specialties: ['Pediatrics'] }, 'Emergency Medicine')).toBe(false);
    expect(specialtyMatches({}, 'Emergency Medicine')).toBe(true);
  });
});
