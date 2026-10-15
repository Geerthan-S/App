# Admin Portal v2 — Feature Analysis & Spec

Reference studied: `https://healthforce-admin.vercel.app/` (2026-10-15). It is a
static mockup: every number and table row is hard-coded in its `js/app.js`, and
only the dashboard plus five pages render (14 sidebar links show "Coming
Soon"). We take its **information architecture** and rebuild every section on
live, server-authorized data. The **visual language follows the mobile app**
(warm neutral canvas, white surfaces, near-black ink actions, sparing lime
highlight, Plus Jakarta Sans / Inter), not the reference's navy/teal theme.

Constitution rules that shape every decision below:
- Law 1 — the portal is an untrusted client; every list, count and action comes
  from a staff-guarded callable.
- Law 8 — every privileged mutation emits an audit record in the same commit.
- Law 12 — nothing is faked. Reference widgets that need data we do not have
  (registry "confidence %", council "last sync") are replaced by real signals or
  marked `BLOCKED_EXTERNAL`.

## 1. Feature inventory and need analysis

| Reference feature | Needed? | Why | Real data source / design |
|---|---|---|---|
| **Top bar: global search (Ctrl K)** | Yes | Staff look up a doctor, hospital, duty or case from a phone call or report. | `adminSearch`: exact ID lookup across doctors, organizations, duties, verification cases, users; exact registration number; name prefix. Firestore has no full-text search, so the UI says "ID, registration no. or name prefix". |
| Top bar: clock | Low | Cosmetic. | Kept (local time) because SLA timers are time-relative. |
| Top bar: notification bell | Yes | Shows work waiting. | Same counts as Attention Center. |
| Top bar: "MFA Active" chip | Yes | Staff MFA is now enforced. | Read from the ID token's `firebase.sign_in_second_factor`. |
| Profile menu: Change password, MFA settings, sign out | Yes | Staff must be able to rotate passwords and manage their authenticator. | Firebase Auth `updatePassword` after re-auth; TOTP enroll/unenroll. "Profile settings" folded into one **My account** panel. |
| **Dashboard** hero, KPI cards, network snapshot | Yes | Daily orientation. | `getAdminDashboard` (extended): counts, cities with published duties, SLA compliance computed from real `submittedAt`/`decidedAt`. |
| Dashboard "Needs your attention" | Yes | Prioritised work. | Attention items (below). |
| Dashboard verification queue with filters (All / Doctors / Hospitals / Escalated / My cases) | Yes | Core verifier workflow. | `getVerificationQueue` (extended with subject names, assignee, SLA due time, escalation). |
| Queue column "Verification %" / "Risk" | **No (as shown)** | The numbers are invented; we have no automated registry match (`verifyDoctorRegistration` records `SOURCE_UNAVAILABLE`). Showing a score would be fake. | Replaced with real **flags**: escalated, stale profile revision, evidence not yet scanned clean, repeat submission (has `previousCaseId`). |
| Queue column "Assigned to" + "My cases" | Yes | Prevents two verifiers working one case. | New `claimVerificationCase` / `releaseVerificationCase`. |
| Queue column "SLA" timer | Yes | Verification turnaround is a product promise. | `slaDueAt = submittedAt + verification_policy.slaHours` (configurable, default 48 h). |
| Verification trends (7 days) | Yes | Throughput and backlog visibility. | Counts of cases submitted and decided per day from `verificationCases`. |
| Medical council status ("last sync", "Operational") | **Replaced** | No council API exists; "last sync" would be fiction. | **Medical Councils** page manages the approved official-registry sources that `recordVerificationDecision` already requires (`configuration/approved_registry_domains`). The dashboard shows how many sources are approved. Live registry sync stays `BLOCKED_EXTERNAL`. |
| Recent admin activity | Yes | Oversight of staff actions. | `getAuditLogs` with `scope: 'staff'`. |
| Upcoming SLA breaches | Yes | Prevents missed SLAs. | Open cases ordered by `slaDueAt`. |
| **Attention Center** | Yes | One list of everything needing a human. | `getAttentionItems`: escalated cases, SLA-breached or due within 4 h, cases waiting on applicant for over 7 days, open reports, dead-lettered notifications, evidence stuck in scanning for over 1 h. |
| **Doctor / Hospital Verification** | Yes | Existing core. | Existing case review + evidence + decision, plus claim, escalate, flags, SLA. |
| **Escalated Cases** | Yes | High-risk or ambiguous cases need senior sign-off. | New `escalateVerificationCase` (verifier, reason). Escalated cases can be decided **only by a super admin** (enforced in `recordVerificationDecision`). |
| **Credential Renewals** | Yes | Registrations lapse; a verification years old is weak evidence. No registration expiry date is captured today. | Re-verification policy: doctors verified more than `verification_policy.reverifyAfterMonths` (default 12) ago are listed; staff can send a renewal reminder (outbox notification + audit). Capturing a registration expiry date in the app is a later enhancement. |
| **Doctors** directory | Yes | Support and compliance lookups. | `listDoctors` (paged, filter: verified / unverified / suspended) and `getDoctorProfile` (profile, account status, case history, assignments count). |
| **Hospitals** directory | Yes | Same for organizations. | `listOrganizations`, `getOrganizationProfile` (facilities, member count, duties). |
| **Duties** directory | Yes | Operations and safety. | `listDuties` (status filter). |
| Account suspend / reinstate | Yes | Today an account can be suspended only through a report, and **cannot be reinstated at all**. | `setAccountStatus` (support admin, step-up, reason; revokes sessions on suspend). |
| **Reports** | Yes | Existing moderation queue. | Existing. Report creation moves from a direct Firestore write to the rate-limited `submitModerationReport` callable. |
| **Duty Moderation** | Yes | Hidden duties need review and a way back. | Duties hidden by moderation, with `setDutyVisibility` restore/hide (support admin, step-up, reason). |
| **Audit & Compliance** | Yes | Existing; add CSV export of the loaded page and a "denied attempts" filter. | `getAuditLogs` (`result` filter). |
| **Admin Activity** | Yes | Staff-only view of the trail. | `getAuditLogs` with `scope: 'staff'`; filter "only mine". |
| **Admins & Roles** | Yes | Roles can only be granted from a script today. | `listStaff` (from a `staffDirectory` collection maintained by `setCustomClaims`) and `setCustomClaims` (super admin, MFA, step-up, cannot edit self). |
| **System Health** | Yes | Ops visibility. | `getSystemHealth`: outbox by status, oldest pending age, evidence scan backlog, last delivered notification. Malware scanner shown `BLOCKED_EXTERNAL` until results arrive. |
| **Notifications** | Yes | Failed pushes are invisible today. | `listNotificationOutbox` (failed / dead-letter) + `requeueNotification` (support admin, audited). Broadcast push to all users: **not built** (spam/abuse risk; needs a product decision). |
| **Support Cases** | Yes | Staff need somewhere to track issues raised by phone or email; no in-app channel exists yet. | Internal tickets: `createSupportCase`, `listSupportCases`, `updateSupportCase` (status, assignee, notes). In-app "Contact support" that files a case is a follow-up. |
| **Master Config** | Yes | Existing offer policy, plus the new verification policy (SLA hours, re-verification months). | `updatePlatformConfig` with schema-validated keys. |
| **Feature Flags** | Yes | Existing; gets its own page. | `setFeatureFlag`. |

## 2. Security changes delivered with v2
- Staff callables require a TOTP second factor (`firebase.sign_in_second_factor`) in production; the Functions emulator is exempt for local work.
- Mobile callables enforce App Check in production.
- Per-user rate limiting at the callable boundary.
- Public email/password sign-up is blocked by a `beforeUserCreated` blocking function (staff accounts are created with the Admin SDK, which does not trigger it).
- Denied staff attempts and request IP / user agent are recorded in `auditLogs`.
- Staff callables only accept the portal's origins (CORS).
- CSP, HSTS, COOP, `X-Robots-Tag: noindex` on hosting.

## 3. External setup (`BLOCKED_EXTERNAL`)
1. Upgrade the project to Firebase Authentication with Identity Platform and enable **TOTP** multi-factor (required for staff MFA and blocking functions).
2. Register the Android app with App Check (Play Integrity) before deploying, or mobile callables will reject requests.
3. Enable a Firestore TTL policy on `rateLimits.expireAt`.
4. Provision the malware scanner (see `docs/evidence-scanning.md`).
