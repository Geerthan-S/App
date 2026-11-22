# Business modules

Six modules added on top of Phase 1. Each is switched on separately in
**Admin › Configuration › Feature Flags** (all start off), and its settings live
in **Admin › Configuration › Business Settings** (`configuration/{key}`,
validated by `updatePlatformConfig`, audited). Attendance is always on.

| Module | Flag | Settings key | Server code | App |
| --- | --- | --- | --- | --- |
| QR attendance | — (always on) | `attendance_policy` | `functions/src/attendance/` | My Duties › Check in / Check out; Hospital dashboard › Active Shifts |
| Payments | `payments_enabled` (duty bookings) | `payment_policy` | `functions/src/payments/` | Hospital › Active Shifts › Payments; plan payments in Premium |
| Premium plans & early access | `premium_enabled` | `subscription_policy` | `functions/src/subscriptions/` | Settings › Premium & standby |
| Last-minute confirmation | `last_minute_enabled` | `last_minute_policy` | `functions/src/lastMinute/` | Hospital duty card › Need a doctor fast?; Premium & standby › standby dates and offers |
| Community channels | `channels_enabled`, `channels_media_enabled` | `channel_policy` | `functions/src/channels/` | Settings › Community |
| AI assistant | `ai_assistant_enabled` | `ai_policy` | `functions/src/ai/` | Settings › Community › HealthForce AI |

Admin pages: Business › Payments, Premium & AI Plans, Last-Minute Service,
Channel Reports; Configuration › Business Settings.

## QR attendance

1. The doctor arrives. Hospital staff open **Active Shifts** and tap **Show check-in code**.
2. The app shows a one-time QR code (`HFATT1:…`) that expires after `codeTtlSeconds` (default 90 s) and renews itself.
3. The doctor taps **Check in (scan QR)** in My Duties. The phone reads its location at that moment and sends it with the code.
4. The server records time, location and distance to the branch (`organizations/{org}/facilities/{id}.geo`), moves the assignment to `in_progress`, and flags: late check-in, early check-out, outside the radius, mock location, no location, or a branch with no map location.
5. Flagged scans are still recorded. The hospital sees **Needs your acknowledgement** and taps **Acknowledge** (optional note). Check-out works the same way.

Location is asked for at the moment of scanning (Play policy friendly), not at app launch.

## Payments

Charges are computed in paise. GST applies only to the platform's own charges
(platform fee, confirmation charge, plan price), never to the doctor's pay:
a ₹5,000 duty with a ₹100 fee costs ₹5,000 + ₹100 + ₹18 = **₹5,118**.

Orders (`paymentOrders`) move `awaiting_payment → paid → payout_due → paid_out`
(or `refund_due → refunded`, or `cancelled`). Every money movement is an
append-only `ledgerEntries` document.

**Provider `manual` (default).** Payers pay by UPI or bank transfer using
`payment_policy.manualInstructions` (e.g. your UPI ID) and quote the order
reference. Staff record each payment, payout and refund in Admin › Payments.
Recording a payment also activates a plan or starts a last-minute search.

**Provider `gateway`: `BLOCKED_EXTERNAL`.** Collecting a hospital's money and
paying it to a doctor is payment aggregation, which in India needs an
RBI-authorised payment aggregator or bank escrow; the platform cannot pool it
in its own account. Open-source orchestration (e.g. Juspay Hyperswitch) still
needs a licensed provider underneath. Choose a provider's marketplace / split
settlement product, then implement it behind `payment_policy.provider`.

Confirm with a CA before going live: whether the platform acts as an
intermediary (turnover = fees) or supplies the doctor (GST may apply to the full
duty value), and GST/TCS obligations.

## Premium plans and early access

Plans (price, months, on sale) are edited in Business Settings. A doctor taps
**Get**, sees the amount with GST and the payment instructions, and the plan
starts when staff record the payment. Staff can also **Grant plan** without
payment (audited). With early access on, a newly published duty is
`early_access` for `earlyAccessMinutes` (default 60): only premium doctors can
read it (Firestore rules) or apply (server), and matching premium doctors get a
push alert. `releaseEarlyAccessDuties` opens it to everyone each minute.

## Last-minute confirmation

Doctors choose dates in **Premium & standby › Last-minute standby**. The list is
private (`standbyPool/{uid}`: only the doctor and staff, through callables).
For a duty starting within `windowHours`, the hospital taps **Need a doctor
fast?** and pays the confirmation charge + GST. Once paid, standby doctors for
that date are alerted; the first to accept is confirmed directly with contacts
shared. If nobody accepts before `searchCloseMinutesBeforeStart`, the order
moves to `refund_due` and the full charge is refunded (staff record the refund
in manual mode). Terms shown to hospitals: best effort, full refund if unfilled.

## Community channels

Verified doctors create public channels or private ones (invite code). Members
read messages live; posting goes through `sendChannelMessage`. Owners remove or
ban members and remove messages; anyone can report a message to Admin ›
Channel Reports (remove, remove and ban, close channel, dismiss).
Recommendations score tag and keyword matches with the doctor's specialties and
qualification, then activity. Voice notes (≤ 3 MB) and images (≤ 5 MB) need
`channels_media_enabled`; they are stored under `channels/{id}/{uid}/` and read
only by members (no public links). Cost is Storage plus download traffic.

## AI assistant

See [ai-assistant.md](ai-assistant.md).
