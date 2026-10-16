# Phase 1 Completion — Spec

Source: *Healthcare Workforce Ecosystem Master Blueprint v1.1* (21 Aug 2026), gaps
found on 2026-10-16. Each item below closes a Phase 1 requirement from that
document. Everything runs through the existing callable boundary
(`domainCall`: rate limit, account eligibility, audit) and deny-by-default rules.

## 1. Hospital roles, invitations and offboarding (blueprint §4.2)

Roles inside an organization:

| Role | Team & profile | Duties (create/edit/publish) & selection | Assignments (contact, complete, feedback) |
|---|---|---|---|
| `owner` | yes | yes | yes |
| `admin` (existing) | yes | yes | yes |
| `recruiter` | – | yes | yes |
| `operations` | – | – | yes |
| `member` (legacy) | – | yes (treated as recruiter) | yes |

- `inviteOrgMember` (owner/admin): invite by phone (E.164) or email into `admin`,
  `recruiter` or `operations`. Invitations live in `organizationInvitations`,
  expire after 7 days, one pending invite per contact per organization.
- `listMyInvitations` / `respondToInvitation`: the invitee must be signed in with
  the invited phone number or verified email.
- `listOrgMembers`, `updateOrgMemberRole`, `removeOrgMember` (offboarding),
  `revokeOrgInvitation`. The last active owner can never be removed, demoted or
  leave; nobody changes their own role. Offboarding sets `status: removed` and
  keeps duties and audit history intact.

## 2. Privacy and account controls (§3.10, App Store 5.1.1(v))

- `exportMyData`: returns the caller's own records as JSON (profile, account,
  applications, assignments, feedback written, notifications, memberships,
  saved searches). Rate limited to 3 per day, audited.
- `submitPrivacyRequest`: correction or other privacy request; opens a Support
  Case (category `privacy`) for staff.
- `deleteMyAccount`: needs a sign-in within 10 minutes and the typed word
  `DELETE`. Refused while the user has an active assignment or is an active
  owner of a hospital. It withdraws open applications, anonymises the public
  profile, removes memberships, disables devices, deletes saved searches, marks
  the account deleted and deletes the Firebase Auth user.
  **Retained** (legal / fraud purposes, purged by a later retention job):
  verification cases and evidence, audit logs, assignment history, and the
  registration-number reservation, so a deleted registration cannot be reused to
  impersonate the doctor. Staff can release a reservation on request.
- `listMyDevices` / `signOutEverywhere`: Firebase cannot revoke a single
  session, so the app lists registered devices and offers "sign out of all
  devices" (revokes refresh tokens, disables push on every device).

## 3. Notification preferences (§3.9)

`users/{uid}.notificationPreferences = { mutedCategories, quietHours: { enabled, start, end } }`,
times in India Standard Time.

| Category | Event types |
|---|---|
| `applications` | `application.*`, `assignment.*`, `duty.updated` |
| `duty_alerts` | `duty.saved_search_match` |
| `verification` | `verification.*` |
| `team` | `organization.*` |

Critical events (`application.selected`, `assignment.cancelled`,
`assignment.expired`) ignore mutes and quiet hours. Muted or quiet-hour events
are still written to the in-app inbox; only the push is skipped.

## 4. Verification appeals (§3.8, §10.2)

- `submitVerificationAppeal`: subject (doctor, or hospital owner/admin) appeals a
  **rejected** case once, within 30 days of the decision, with a statement.
- `listVerificationAppeals` / `decideVerificationAppeal` (verifier, fresh
  sign-in): decided by a reviewer **other than** the one who rejected.
  `upheld` closes the appeal; `overturned` opens a new case (`appealOf`) in
  `submitted` with the original, already-scanned evidence linked to it, so it
  re-enters the normal review queue. The rejected case itself never changes.

## 5. Duty edits with versions (§4.3)

`updateDuty` (owner/admin/recruiter) with `expectedVersion` (optimistic
concurrency). Editable while `draft`, `published` or `paused`. Pay and schedule
cannot change once a doctor has been selected for the duty. Each change writes
`duties/{id}/versions/{n}` (changed fields, before, after, actor) and notifies
every doctor with an open application.

## 6. Saved searches (§3.3)

`savedSearches/{id}` (owner-readable): specialty (or any), city (optional),
minimum pay, alerts on/off; 10 per user. When a duty is first published a
trigger alerts matching doctors (one alert per doctor per duty, never to members
of the posting hospital).

## 7. Server-set minimum version and maintenance mode (§16.2 "basement")

`appVersions/current` (public read): `minimumVersion`, `latestVersion`,
`updateUrl`, `maintenance { enabled, message }`, edited by super admins in Master
Config. The app checks it at launch and shows a maintenance or update-required
screen.

## 8. Crash reporting (§9.4, §9.6)

Crashlytics in release builds only. No user identifiers are attached; error
messages are scrubbed of phone numbers, emails, long digit runs and tokens
before they leave the device.

## 9. Security pipeline (§9.5, Appendix A)

CodeQL (TypeScript/JavaScript), Semgrep, Gitleaks, OSV-Scanner, an OWASP ZAP
baseline scan of the admin portal on every PR; MobSF static analysis of a debug
APK weekly and on demand.

## 10. Launch readiness (Appendix B)

Runbooks for backup/restore (PITR + scheduled exports, restore drill, RPO/RTO),
incident response, the privacy/legal review, and the Play Store listing.
Operational sign-off items stay with the named owners.
