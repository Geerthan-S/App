# Implementation brief: cancellations, radius alerts, SOS, WhatsApp-style chat, lending scaffold

You are working in the HealthForce repository (doctor duty marketplace for India).
You have no prior context, so read this whole brief before writing code.

## 0. Ground rules

- Read `AGENTS.md`, `CONSTITUTION.md`, `IMPLEMENTATION_STATUS.md` and `docs/business/README.md` first.
- Start from branch `claude/epic-dirac-dsr4u5`. Create `feature/next-phase-trust-safety` from it unless the user names another branch.
- Stack: Flutter Android app (`lib/`, Riverpod, GoRouter), Firebase Cloud Functions v2 in strict TypeScript (`functions/src/`), Firestore + Storage rules (`firestore.rules`, `storage.rules`, `firestore.indexes.json`), admin portal in vanilla ES modules (`admin/js/`).
- Match the existing code style: single quotes, 2-space indent, the same comment density. If an editor hook reformats files into double quotes, write files through the shell instead.
- Never deploy. Never commit secrets. Every new module stays behind a feature flag that defaults to off.
- One commit per work package (WP below), each with passing checks. Update `IMPLEMENTATION_STATUS.md` (new entry at the top, same format as existing entries) and `docs/business/README.md` at the end.
- If an external dependency is missing (SMS provider, lending partner), build the interface plus a "not configured" implementation that refuses clearly, and mark it `BLOCKED_EXTERNAL`. Never fake success.

### Checks that must pass before each commit

```
cd functions && npm ci && npm run build
firebase emulators:exec --only auth,firestore,storage --project demo-healthforce "npx jest --runInBand"
cd .. && flutter pub get && flutter analyze --no-fatal-infos --no-fatal-warnings   # 0 errors
flutter test
```

- Keep `pubspec.lock` resolvable on Flutter 3.38: its `sdks: flutter` line must stay `">=3.38.0"`. If a new package needs a newer Flutter, pin an older version.
- Expect the 201 existing backend tests and all Flutter tests to keep passing.

## 1. How the codebase works (patterns to reuse)

Backend (`functions/src/`):
- Every callable is `domainCall(name, handler, options)` from `shared/callable.ts`. It handles App Check, rate limits, suspended accounts and consent (`requireConsent: true`). Staff callables use `{ audience: 'staff' }`.
- Errors: `throw new DomainError(code, message, correlationId)` from `shared/errors.ts`. Add new codes to the `DomainErrorCode` union and to the switch in `toHttpsError`.
- Guards (`security/guards.ts`): `requireAuth`, `requireAdmin`, `requireSuperAdmin`, `requireStepUpAuth`, `isActiveOrgMemberInTx`, `requireOrgPermission(uid, orgId, 'manageDuties', cid)`.
- Transactions: all reads before any write. Audit with `stageAudit(tx, {...})`. Notify with `enqueueNotification(tx, { dedupeKey, eventType, targetUserId | targetOrganizationId, title, body, payload })` from `notifications/outbox.ts`.
- Business settings: `shared/businessConfig.ts`. Each setting block has a Zod schema in `BUSINESS_CONFIG_SCHEMAS`, defaults in `BUSINESS_DEFAULTS`, and is read with `getBusinessConfig(key)`. Adding a key there makes it editable through `updatePlatformConfig` and visible in `getPlatformConfig().business`.
- Feature flags: add keys to `FEATURE_FLAG_KEYS` in `shared/platformConfig.ts`. Check with `isFlagEnabled(key)`. Label them in `FLAG_LABELS` in `admin/js/views/config.js`.
- Assignment lifecycle (`assignments/assignmentLifecycle.ts`): `readReservation(tx, asg, id)` then `applyRelease(tx, id, reads, 'withdrawn' | 'rejected' | 'expired')` returns the seat, frees the doctor's calendar and revokes contact grants. Statuses: `selected` (offer) → `confirmed` → `in_progress` (after QR check-in) → `completed`; also `cancelled`, `expired`.
- Payments (`payments/`): `charges.ts` (paise integers; GST only on platform charges), `orders.ts` (`stageOrder`, `transitionOrder`, `stageLedger`; statuses `awaiting_payment → paid → payout_due → paid_out`, `refund_due → refunded`, `cancelled`). Provider `manual` means staff record money in Admin › Payments (`recordPaymentAction`). `syncDutyBookingOrder` keeps a `duty_{assignmentId}` order in step with the assignment.
- Last-minute service (`lastMinute/`): `duties/{id}.lastMinute = { status: awaiting_payment|searching|matched|refund_due|refunded, orderId, deadlineAt, serviceDate, matchedDoctorIds }`, standby pool `standbyPool/{uid}` (private), `acceptLastMinuteDuty`, `closeSearch`.
- Subscriptions (`subscriptions/`): `subscriptions/{uid}.premiumUntil` (ISO) + `premiumUntilMs` (for rules). Early access: published duties start as status `early_access` for `subscription_policy.earlyAccessMinutes`. `earlyAccess.ts › notifyPremiumDoctorsOfDuty` alerts matching premium doctors.
- Channels (`channels/`): `channels/{id}` + `members/{uid}` + `messages/{id}`, membership index `channelMemberships/{uid}_{channelId}`, reports `channelReports`, ranking in `channelRules.ts`. All writes through callables; members read live.
- Attendance (`attendance/`): QR check-in moves an assignment to `in_progress`; `attendance/{assignmentId}` holds check-in/out records.
- Register every new export in `functions/src/index.ts`.
- Tests: emulator tests in `functions/tests/*.emulator.test.ts` use `tests/helpers/emulator.ts` (`call(fn, uid, data, token)`, `expectDomainError`, `clearFirestore`, `isoIn`, `HOUR`, `MFA`). Staff token: `{ isSupportAdmin: true, auth_time: nowSeconds, ...MFA }`. Run triggers and schedules with `(fn as any).run(event)`. Rules tests follow `tests/business_rules.emulator.test.ts`. Pure logic gets unit tests (`tests/business_rules.test.ts` style).

Flutter (`lib/`):
- Callables through `BackendConfig.functions.httpsCallable(name)` (region asia-south1). Live reads with `FirebaseFirestore.instance`. Repositories live in `lib/features/<feature>/data/`. See `lib/features/business/data/business_repository.dart` and `lib/features/channels/data/channel_repository.dart`.
- UI kit: `context.appColors`, `AppTypography.*`, `AppSpacing.*`, `AppButton`, `AppSecondaryButton`, `AppCard`, `RowGroup`, `ListRow`, `GroupLabel`, `SheetHeader`, `StatusBadge`, `EmptyStateView`, `LoadingView`. Domain error code: `e.domainCode` on `FirebaseFunctionsException`.
- Routes in `lib/core/navigation/app_router.dart`. Settings entry points in `lib/features/settings/presentation/settings_screen.dart`. Doctor duties: `lib/features/messages/presentation/messages_screen.dart`. Hospital: `lib/features/hospital/presentation/hospital_dashboard_screen.dart`, `lib/features/business/presentation/hospital_shifts_section.dart`.
- `BusinessFeatures.load()` (callable `getBusinessFeatures` in `subscriptions/subscriptionFunctions.ts`) tells the app which flags are on. Extend it with every new flag.

Admin portal (`admin/js/`):
- Sections are registered in `NAV` in `app.js`. Views take `(root, ctx)` and call `invoke(callableName, data)`. Use `ctx.state` for tab/filter state. Helpers in `core/ui.js` (`pageHead`, `card`, `table`, `tabs`, `dl`, `actionDialog`, `openModal`, `toast`) and `core/dom.js` (`h`, `badge`, `icon`, `fmtDateTime`). Example: `admin/js/views/business.js`.

## 2. Decisions already taken (defaults; all must be editable settings)

| Topic | Default |
| --- | --- |
| Individual doctors posting duties | Allowed behind flag `solo_posting_enabled`, as organization type `solo_practice` |
| Compensation when a poster cancels a confirmed booking | Starts with more than 24 h to go: 0%. 6–24 h: 10% of duty amount. Under 6 h: 25%. Poster may offer more. |
| Doctor response window for a cancellation request | 2 h, or until 1 h before the shift, whichever comes first; then admin decides |
| Premium alert radius | 10 km default; choices 5, 10, 20, 50 km |
| Premium tiers | Optional per-plan `alertLeadMinutes` (default 0 = alert at once) |
| Last-minute withdrawal threshold | 3 withdrawals in 30 days → next requests need admin approval |
| SOS emergency contacts | Up to 3, E.164 numbers |
| Delete-for-everyone window | 60 minutes |
| Forward limit | 5 chats per forward |

## 3. Work packages (do them in this order)

### WP1 — Solo practitioners can post duties

Today only hospitals, clinics and nursing homes can post (`organizationType` enum in `functions/src/shared/schemas.ts`). A doctor also needs to post a relief duty for their own shift.

- Add `solo_practice` to the enum. `createOrganizationDraft` with `solo_practice` requires the caller to be a verified doctor (`doctors/{uid}.isVerified === true`) and flag `solo_posting_enabled`. Mark the org `verificationState: 'approved'` with `verificationBasis: 'verified_doctor'`, recorded in the audit trail.
- The existing conflict-of-interest checks (members cannot apply to their own org's duties) must keep working.
- App: in role selection / hospital onboarding, add "I'm a doctor posting a relief duty for my own shift". It creates the solo practice with one facility (practice address plus map pin).
- Tests: a verified doctor creates a solo practice and publishes a duty; an unverified doctor is refused; the flag off refuses.

### WP2 — Last-minute withdrawal with verified reasons

When a poster has requested the last-minute service (`duties/{id}.lastMinute.status` is `awaiting_payment` or `searching`) and no doctor has matched yet, they can withdraw.

- Setting `withdrawal_policy`:
  - `reasons: [{ code, label, requiresDetails: boolean, verification: 'repost_check' | 'manual' }]`
  - `approvalThreshold: { count: 3, windowDays: 30 }`
  - Default reasons: `found_doctor_elsewhere` (manual, details required: how), `no_longer_needed` (manual), `posted_by_mistake` (repost_check), `management_cancelled` (manual), `other` (manual, details required).
- Callable `withdrawLastMinuteRequest({ dutyId, reasonCode, details? })` (org `manageDuties` permission):
  - In one transaction: refuse if any `matchedDoctorIds`.
  - Set `lastMinute.status = 'withdrawn'` with the reason.
  - Paid order → `refund_due` with the full amount (manual provider: staff record the refund). Unpaid order → `cancelled`.
  - Create `withdrawalReviews/{id}` (status `open`, reason, details, orgId, dutyId, orderId).
  - Increment `posterStats/{orgId}` counters (withdrawals with a 30-day rolling list of timestamps).
  - Notify standby doctors who were alerted that the request was withdrawn.
- **The refund never waits for the review.**
- `repost_check`: a scheduled function marks the review `auto_flag` when the same org publishes a duty with the same specialty and an overlapping time within 48 h.
- Threshold reached: `requestLastMinuteConfirmation` records `lastMinute.status = 'pending_approval'` instead of creating the order. Staff approve or reject in admin (callable `decideLastMinuteApproval`), which then creates the order.
- Admin page "Withdrawals": open reviews with reason, details, auto flags, poster's history. Actions: `verified`, `suspicious` (adds a note on the org), `dismiss`.
- App: "Withdraw request" on the hospital duty card while searching → reason sheet from settings → shows "Full refund on its way".
- Tests: withdraw before match refunds in full; withdraw after a match is refused; the threshold triggers approval; the repost check flags.

### WP3 — Mutual cancellation of a confirmed booking

Today `cancelAssignment` cancels instantly for either side in `selected` or `confirmed`.

- Change it: keep instant cancel for `selected` (offer not yet accepted) and for staff. For `confirmed`, require the new mutual flow (`INVALID_STATE_TRANSITION` with a message pointing to it).
- Setting `cancellation_policy`:
  - `compensationTiers: [{ minHoursBeforeStart: 24, percent: 0 }, { minHoursBeforeStart: 6, percent: 10 }, { minHoursBeforeStart: 0, percent: 25 }]`
  - `responseWindowMinutes: 120`
  - `closeMinutesBeforeStart: 60`
- Collection `cancellationRequests/{id}`: `{ assignmentId, dutyId, organizationId, doctorId, requestedBy: 'poster' | 'doctor', requesterUid, reasonCode, details, policyCompensationPaise, offeredCompensationPaise, status: open|accepted|declined|expired|escalated|resolved, respondBy, decision, createdAt }`. One open request per assignment.
- Callables:
  - `requestAssignmentCancellation({ assignmentId, reasonCode, details?, offeredCompensationInr? })`, by either side. Compute policy compensation from the tiers. A poster's offer must be ≥ policy. Notify the other side.
  - `respondToCancellation({ requestId, accept, note? })`, by the other side only.
  - Accept → in one transaction: assignment `cancelled` with `cancelledBy: 'mutual_agreement'`; use `readReservation` + `applyRelease`. For the payment order (if one exists and is paid), set `refundAmountPaise = total - compensation` and record `compensationPaise`, then move to `refund_due`. Staff record the refund and the compensation payout to the doctor; add a `compensation_due` ledger kind. Notify both.
  - Decline → status `declined`, escalate to admin.
- Scheduled `expireCancellationRequests` (every 10 min): past `respondBy` → `escalated`.
- Staff callable `resolveCancellationRequest({ requestId, decision: 'cancel_with_policy_fee' | 'cancel_without_fee' | 'keep_booking', note })`.
- Disclosure: `posterStats/{orgId}` keeps `cancellationsByPoster` and `confirmedBookings`. Expose `cancellationRate` to doctors on duty details and hospital info (counts only; no reasons), via the existing hospital profile callable.
- App: on a confirmed booking (both sides), "Request cancellation" → reason + compensation preview (the poster can raise it) → status chip. The other side gets a card with Agree / Decline.
- Admin page "Cancellations": escalated and open requests with the timeline and decision actions.
- Tests: mutual accept releases seat, calendar and contacts and splits the refund; decline escalates; expiry escalates; the doctor-initiated variant works; direct cancel of a confirmed booking is refused; the policy tiers compute correctly (unit test).

### WP4 — Premium radius alerts

- Add `geofire-common` to functions. Copy the facility's `geo` into the duty at `createDuty` and `updateDuty`, adding `geohash`.
- Collection `doctorAlertPrefs/{uid}`: `{ location: { latitude, longitude }, geohash, radiusKm, updatedAt }`. Private: owner read only; written via callable `setDutyAlertPreferences({ latitude, longitude, radiusKm })`. Premium only (`PREMIUM_REQUIRED` otherwise); radius must be one of the allowed values.
- Change `notifyPremiumDoctorsOfDuty`:
  - Query `doctorAlertPrefs` with geohash bounds for 50 km around the duty.
  - Keep doctors that have an active premium plan, whose own radius covers the distance, and whose specialty matches (reuse `specialtyMatches`).
  - Order by distance. Include the distance in the push ("4.2 km away").
  - Premium doctors without prefs keep today's behaviour (specialty match only).
- Optional per-plan `alertLeadMinutes`: lower tiers get the notification delayed by the difference. Check whether the outbox worker honours `availableAt`; if not, use a scheduled function that releases delayed alerts.
- App: Premium screen › "Duty alerts near me": map pin or "use my location", radius chips, save.
- Tests: in-radius premium doctor alerted, out-of-radius not, expired premium not, ordering by distance (unit test for the filter).

### WP5 — SOS during a shift

- Emergency contacts on `users/{uid}.emergencyContacts` (max 3; name + E.164 phone) via callable `setEmergencyContacts`.
- Collection `sosIncidents/{id}`: `{ doctorId, assignmentId?, organizationId?, status: active|acknowledged|resolved|cancelled, locations: [{ latitude, longitude, accuracyMeters, atIso }] (cap 200), trackToken, trackExpiresAt, smsResults, timeline: [...], createdAt }`. Rules: the doctor reads their own; support admins read; no client writes.
- Callables:
  - `triggerSos({ location?, assignmentId? })`, any signed-in doctor; attach the active `in_progress` assignment automatically. Alerts the hospital (outbox `targetOrganizationId`, event `sos.triggered`, critical: bypasses quiet hours; check `notifications/preferences.ts`) and sends SMS to the emergency contacts through an `SmsProvider` interface.
  - `updateSosLocation({ incidentId, location })`, rate-limited, every 30 s from the app while active.
  - `cancelSos` (by the doctor, with reason).
  - Staff `acknowledgeSos` and `resolveSos({ note })`.
- `SmsProvider`: implementation `none` records `{ sent: false, reason: 'SMS_PROVIDER_NOT_CONFIGURED' }` per contact (`BLOCKED_EXTERNAL`; document DLT sender registration). Setting `sos_policy`: `{ smsProvider: 'none', opsResponseMinutes: 5 }`.
- Public tracking page: HTTPS function `sosTrack` (onRequest), `GET ?t=<token>`.
  - Returns a small HTML page: doctor's first name, hospital name, last location as a Google Maps link, last-update time, auto-refresh every 30 s.
  - 404 when the token is unknown, expired (24 h) or the incident is resolved.
  - No other personal data.
- App:
  - Red SOS button on the active-shift card in My Duties, and in Settings › Safety. Press → 5-second cancellable countdown → trigger.
  - Then a full-screen "SOS active" view with "Call 112" (`url_launcher` `tel:112`), "I'm safe" (cancel) and location updates.
  - Settings › Emergency contacts editor.
- Admin: "SOS" page at the top of the nav with a count badge. Poll `listSosIncidents` every 15 s; play a sound for new active incidents. Show timeline, live location link, Acknowledge and Resolve.
- Tests: trigger links the active assignment and notifies the hospital; location updates append and cap; the tracking page serves while active and 404s after resolve; SMS results are recorded as not sent; rules hide incidents from other users.

### WP6 — Channels with the full WhatsApp feature set (in this order; flag `channels_enabled`)

1. **Direct messages:**
   - `directThreads/{uidA_uidB}` (sorted ids) with `messages`. Callables `startDirectThread({ doctorId })` (both verified doctors; respect blocks) and `sendDirectMessage`. Reuse the channel message shape so the same widgets render both.
   - `userBlocks/{uid}` (callable `blockUser` / `unblockUser`). A block hides threads and stops messages.
2. **Unread, push, mute:**
   - Members store `lastReadAt`; the app computes unread from `lastMessageAt`.
   - Callable `markChannelRead`.
   - Push for new messages via outbox fan-out to members who have not muted (`mutedUntil` on the member doc; callable `muteChannel`). Cap 1,000 recipients per message; for larger channels send only to members active in the last 7 days and document the limit.
3. **Reply, reactions, receipts:**
   - `replyTo: { messageId, senderName, preview }` on send.
   - Callable `reactToMessage({ channelId|threadId, messageId, emoji })` storing `reactions.{emoji}: [uids]` (one emoji per user, from a fixed set of six).
   - Receipts: "delivered/read" computed from members' `lastReadAt` (ticks in DMs; "seen by N" in groups).
4. **Group admin:**
   - `setMemberRole` (owner promotes/demotes moderators).
   - `addChannelMember` (owner/moderator adds a doctor they share a DM with).
   - `updateChannel` (name, description, tags, photo under `channels/{id}/meta/`).
5. **Documents and forwarding:**
   - Type `document` (PDF ≤ 10 MB; Storage path rules like voice/image).
   - Callable `forwardMessage({ source, targets[] })` with max 5 targets; mark forwarded messages.
6. **Search, pin, delete for everyone:**
   - Store `keywords` on text messages; callable `searchChannelMessages({ channelId, query })` (array-contains-any on keywords, newest 50).
   - `pinMessage` (owner/moderator, max 3).
   - `deleteChannelMessage` with `forEveryone` allowed for the sender within `channel_policy.deleteForEveryoneMinutes`.
7. **Typing and online:** skip; write a note in the docs explaining the Firestore cost trade-off.

- App: a "Chats" tab inside Community listing DMs and channels together, sorted by last message, with unread badges. Long-press menu on a message (reply, react, forward, copy, pin, delete, report). Swipe-to-reply is optional.
- Tests: for each callable (membership, blocks, limits, delete window, forward limit), plus rules for direct threads (only the two participants read).

### WP7 — Lending scaffold (instant payout via a regulated lender) — `BLOCKED_EXTERNAL`

Goal: after QR check-out, the relieving doctor is paid immediately by a partner lender, and the poster repays the lender at the start of the month.

Under the RBI Digital Lending Directions, HealthForce may only act as a Lending Service Provider:
- the lender (bank/NBFC) lends;
- money moves only between the lender and the borrower's bank account, never through HealthForce;
- the borrower sees a Key Fact Statement and a cooling-off period;
- the lender, not the borrower, pays HealthForce's fee.

So build only the platform side, with no money movement and no credit decisions.

- Flag `lending_enabled`. Setting `lending_policy`: `{ provider: 'none', partnerName: '', model: 'poster_credit_line' | 'receivable_purchase', grievanceOfficer: { name, email, phone } }`.
- `LendingProvider` interface: `checkEligibility`, `createApplication`, `getKfs`, `acceptOffer`, `notifyWorkCompleted`, `getStatus`. Implementation `none` throws `LENDING_NOT_CONFIGURED`.
- Collection `financingRequests/{assignmentId}`: `{ model, borrowerUid, payeeDoctorId, amountPaise, status: draft|kfs_shown|accepted|work_completed|disbursed_by_lender|repaid|defaulted|cancelled, kfsAcceptedAtIso, consentLog: [...], lenderRef, createdAt }`. Rules: the borrower and payee read; staff read via callable.
- Callables `requestInstantPayout({ assignmentId })` (poster, before the shift) and `acceptKfs({ assignmentId })`. Trigger: on assignment `completed`, call `notifyWorkCompleted` with the attendance proof (check-in/out times and distances from `attendance/{assignmentId}`). Statuses after that come only from the provider (a future webhook).
- App: on a confirmed booking (poster side), an "Instant payout for the doctor" card shows "Coming soon" when the provider is `none`. When configured: shows the KFS, consent checkboxes and status. The doctor side shows "Paid instantly by <partner>" status.
- Admin: "Financing" page listing requests and statuses (read-only), plus the grievance officer details.
- Docs: `docs/business/lending.md` covering both models, the RBI constraints above as points to confirm with the partner's compliance team and a lawyer, and the exact integration points.
- Tests: the flag off refuses; provider `none` refuses with `LENDING_NOT_CONFIGURED`; completion with a draft request records the attendance proof payload; rules.

## 4. Definition of done

- All WPs committed separately on the feature branch, with checks green after each.
- New settings in `BUSINESS_CONFIG_SCHEMAS`/`BUSINESS_DEFAULTS`, editable in Admin › Business Settings (add cards in `admin/js/views/business.js`).
- New flags in `FEATURE_FLAG_KEYS`, `FLAG_LABELS` and `getBusinessFeatures`.
- Firestore/Storage rules and indexes for every new collection and query, with rules tests.
- `IMPLEMENTATION_STATUS.md` entry listing `IMPLEMENTED`, `TESTED`, `UNVERIFIED` (anything not run on a device) and `BLOCKED_EXTERNAL` (SMS provider, lending partner).
- `docs/business/README.md` updated with each new module and its flag.
- A final summary to the user: what was built, test counts, what is blocked and why. Do not open a pull request unless asked.
