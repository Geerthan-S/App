/**
 * Charge calculation in paise (integers), so totals never drift by a rupee.
 *
 * GST applies only to the platform's own charges (platform fee, confirmation
 * charge, subscription price). The duty amount passes through to the doctor
 * and is not part of the platform's taxable value.
 */

export type ChargeCode =
  | 'duty_amount'
  | 'platform_fee'
  | 'confirmation_charge'
  | 'subscription_price'
  | 'gst';

export interface ChargeLine {
  code: ChargeCode;
  label: string;
  amountPaise: number;
}

export interface ChargeBreakdown {
  lines: ChargeLine[];
  totalPaise: number;
  /** Money that belongs to the doctor (paid out after the shift). */
  passThroughPaise: number;
  /** The platform's own charges before GST. */
  platformRevenuePaise: number;
  gstPaise: number;
  gstRatePercent: number;
}

export const toPaise = (inr: number): number => Math.round(inr * 100);

/** GST on a paise amount, rounded half up to the nearest paisa. */
export const gstOn = (paise: number, ratePercent: number): number => Math.round((paise * ratePercent) / 100);

const build = (passThrough: ChargeLine[], own: ChargeLine[], gstRatePercent: number): ChargeBreakdown => {
  const platformRevenuePaise = own.reduce((sum, l) => sum + l.amountPaise, 0);
  const passThroughPaise = passThrough.reduce((sum, l) => sum + l.amountPaise, 0);
  const gstPaise = gstOn(platformRevenuePaise, gstRatePercent);
  const lines = [...passThrough, ...own.filter(l => l.amountPaise > 0)];
  if (gstPaise > 0) lines.push({ code: 'gst', label: `GST ${gstRatePercent}% on platform charges`, amountPaise: gstPaise });
  return {
    lines,
    totalPaise: passThroughPaise + platformRevenuePaise + gstPaise,
    passThroughPaise,
    platformRevenuePaise,
    gstPaise,
    gstRatePercent,
  };
};

/** A duty booking: the doctor's pay plus the platform fee and GST on that fee. */
export const dutyBookingCharges = (dutyAmountInr: number, platformFeeInr: number, gstRatePercent: number): ChargeBreakdown =>
  build(
    [{ code: 'duty_amount', label: 'Duty amount (paid to the doctor)', amountPaise: toPaise(dutyAmountInr) }],
    [{ code: 'platform_fee', label: 'Platform fee', amountPaise: toPaise(platformFeeInr) }],
    gstRatePercent
  );

/** Last-minute confirmation service: the confirmation charge plus GST. */
export const confirmationCharges = (chargeInr: number, gstRatePercent: number): ChargeBreakdown =>
  build([], [{ code: 'confirmation_charge', label: 'Last-minute confirmation charge', amountPaise: toPaise(chargeInr) }], gstRatePercent);

/** A subscription plan: the plan price plus GST. */
export const subscriptionCharges = (planName: string, priceInr: number, gstRatePercent: number): ChargeBreakdown =>
  build([], [{ code: 'subscription_price', label: planName, amountPaise: toPaise(priceInr) }], gstRatePercent);

/** "₹5,118.00" */
export const formatInr = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
