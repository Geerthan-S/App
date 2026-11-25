# Launch readiness (blueprint Appendix B)

The operational half of launch. Code and CI for each item are in place; what is
left is configuration, people and sign-off. Each section ends with the evidence
to file before launch. Items that need a console action or a person outside the
engineering team are marked **BLOCKED_EXTERNAL** until done.

Owner placeholders (`<…>`) must be replaced with real names before launch. Do
not put personal phone numbers in this repository: it is public. Keep the
contact sheet in the team's private drive and link to it from here by name.

---

## 1. Backups, restore drill, RPO and RTO

### Targets

| Measure | Target | How it is met |
| --- | --- | --- |
| **RPO** (data we can lose) | ≤ 5 minutes for the last 7 days; ≤ 24 hours after that | Firestore point-in-time recovery (PITR, 7-day window, minute granularity) plus the daily export |
| **RTO** (time to restore service) | ≤ 4 hours for a full Firestore restore; ≤ 1 hour for a single collection or document set | Scripted import from the latest export, or a PITR read of the affected documents |
| Export retention | 35 daily exports, 12 monthly | Bucket lifecycle rules |

Cloud Storage evidence files are not covered by Firestore backups. Turn on
**object versioning** and **soft delete (30 days)** on the evidence bucket so a
deleted or overwritten object can be recovered.

### One-time setup — BLOCKED_EXTERNAL

1. Enable PITR:
   ```bash
   gcloud firestore databases update --database='(default)' --enable-pitr --project doctor-c7c29
   ```
2. Create the backup bucket in `asia-south1` with uniform access, no public
   access, and lifecycle rules for the retention above:
   ```bash
   gcloud storage buckets create gs://doctor-c7c29-firestore-backups --location=asia-south1 --uniform-bucket-level-access --public-access-prevention --project doctor-c7c29
   ```
3. Grant the Functions runtime service account
   `roles/datastore.importExportAdmin` on the project and
   `roles/storage.objectAdmin` on the bucket.
4. Add `BACKUP_BUCKET=gs://doctor-c7c29-firestore-backups` to
   `functions/.env.doctor-c7c29` and deploy `scheduledFirestoreExport`. Until
   then the job logs `BLOCKED_EXTERNAL` and does nothing.
5. On the evidence bucket: enable object versioning and soft delete.

### Restore drill (quarterly, and once before launch)

Never restore into production during a drill. Use a separate drill project.

1. Pick yesterday's export: `gs://…/firestore/YYYY-MM-DD/`.
2. Import into the drill project:
   ```bash
   gcloud firestore import gs://doctor-c7c29-firestore-backups/firestore/YYYY-MM-DD --project <drill-project>
   ```
3. Check: document counts for `doctors`, `organizations`, `duties`,
   `assignments`, `verificationCases`, `auditLogs` are within 1 % of
   production; open three random assignments and confirm their
   `termsSnapshot` and audit entries are intact.
4. Time each step. RTO is met if the import finished and checks passed within
   4 hours.
5. PITR check: read one document as of 1 hour ago with
   `readTime` in the Firestore API and confirm it differs from the current
   version where expected.
6. Delete the drill project's data afterwards (it contains personal data).

**Evidence:** drill date, export used, import duration, counts compared, who
ran it — appended to the table below.

| Date | Export | Import time | Result | Run by |
| --- | --- | --- | --- | --- |
| _pending_ | | | | |

---

## 2. Incident response

### Roles and contacts

| Role | Who | Backup |
| --- | --- | --- |
| Incident commander | `<name>` | `<name>` |
| Engineering lead (Firebase / Functions) | `<name>` | `<name>` |
| Verification operations lead | `<name>` | `<name>` |
| Grievance officer (DPDP / IT Rules) | `<name, published in the app and privacy policy>` | — |
| Legal counsel | `<firm / name>` | — |
| Google Cloud support | Console → Support (needs a support plan) | — |

Contact numbers live in the private on-call sheet `<link name>`.

### Severity

| Level | Example | First response |
| --- | --- | --- |
| SEV1 | Personal data or evidence exposed; wrong doctor selected for a shift; app down | 15 minutes, all hands |
| SEV2 | Verification queue or selection failing for some users; push notifications down | 1 hour |
| SEV3 | Admin portal degraded; single-feature bug | Next working day |

### First hour (SEV1)

1. Incident commander opens an incident log (time-stamped notes).
2. Contain:
   - App-wide: turn **maintenance mode** on (Admin portal → Master Config →
     App release). Server functions keep running for staff.
   - A feature: switch its feature flag off.
   - A compromised staff account: disable it in Admins & Roles; revoke its
     sessions.
   - A compromised key: rotate it (Firebase console / Secret Manager) and
     redeploy.
3. Preserve evidence: export the relevant `auditLogs` and Cloud Logging
   entries before anything is cleaned up.
4. Assess personal-data impact (whose data, which fields, how many people).

### Notification duties (India)

- **CERT-In:** report qualifying cyber incidents (including data breaches and
  unauthorised access) **within 6 hours** of noticing them
  (`incident@cert-in.org.in`, per the CERT-In Directions of 28 April 2022).
- **Data Protection Board and affected people:** under the DPDP Act 2023 and
  its Rules, a personal-data breach must be reported to the Board and to each
  affected Data Principal without delay, in the form and timelines the Rules
  set. Legal counsel confirms the current timelines at the time of the
  incident.
- Hospitals affected by a breach of their staff or duty data are told by the
  incident commander directly.

### After

Blameless review within 5 working days: timeline, root cause, what contained
it, and follow-up issues with owners.

---

## 3. Legal and privacy review — BLOCKED_EXTERNAL (counsel)

Engineering has implemented the controls; counsel signs off the documents.

| Item | Engineering status | Sign-off |
| --- | --- | --- |
| Privacy notice (DPDP Act §5): purposes, data, retention, rights, grievance officer | Consent versioned server-side (`consentVersion`); notice text to be supplied | ☐ |
| Terms of use and Integrity Charter | Shown at consent | ☐ |
| Right to access | In-app **Settings › Your data › Download a copy** (`exportMyData`, audited) | ☐ |
| Right to correction / restriction | In-app request → high-priority `privacy` support case | ☐ |
| Right to erasure | In-app deletion (`deleteMyAccount`, step-up sign-in, audited); legal-hold records kept with name removed | ☐ |
| Retention schedule | See below | ☐ |
| Processors list (Google Cloud / Firebase, region asia-south1) | Data stays in Mumbai except FCM delivery | ☐ |
| Children's data | Not collected; registered practitioners only | ☐ |
| Medical council registry use | Manual checks on official sites; no scraping | ☐ |

### Retention (proposed for counsel)

| Data | Keep | Then |
| --- | --- | --- |
| Account and profile | While the account exists | Deleted / anonymised on account deletion |
| Verification cases and evidence | 3 years after the last decision | Purge job (to build: scheduled function deleting evidence objects and redacting cases past retention) |
| Assignments, terms snapshots | 8 years (financial records) | Anonymise |
| Audit logs | 3 years | Delete |
| Rate-limit records | 1 day | Firestore TTL on `rateLimits.expireAt` |
| Notifications inbox | 1 year | TTL (to configure) |

---

## 4. Play Store listing — BLOCKED_EXTERNAL (store account)

- **App:** HealthForce, package `com.geerthan.healthcareworkforce`, signed with
  the client-owned upload key (`android/key.properties`, never in git); Play
  App Signing on.
- **Category:** Medical or Business. Target audience 18+.
- **Before submitting:** run MobSF on the signed release APK (CI scans a debug
  build; see `.github/workflows/mobsf.yml`), and set the minimum version in
  Master Config → App release after the build is live.
- **Store assets:** 512×512 icon, 1024×500 feature graphic, 4–8 phone
  screenshots (marketplace, duty details, verification centre, hospital
  dashboard), short and full description.
- **Privacy policy URL:** required; must match section 3.

### Data safety form (draft — confirm against the final build)

| Data type | Collected | Shared | Purpose | Optional |
| --- | --- | --- | --- | --- |
| Name, phone number, email | Yes | With hospitals the doctor applies to (name, credentials only) | Account, app functionality | Email optional |
| Professional credentials (registration no., council, qualification) and documents | Yes | Credentials with hospitals on application; documents never | Verification, fraud prevention | No |
| App activity (applications, duties) | Yes | With the counter-party hospital / doctor | App functionality | No |
| Crash logs and diagnostics | Yes (release builds; PII scrubbed) | No | Stability | No |
| App performance / analytics | Yes | No | Analytics | No |
| Device IDs (FCM token) | Yes | No | Notifications | No |
| Location | No | — | — | — |

- Data encrypted in transit: **Yes**. Users can request deletion: **Yes**
  (in-app, plus a web contact for people without the app).
- **App access for review:** provide Google a test doctor account and a test
  hospital account on production, with a note on how to reach each screen.

---

## 5. Go / no-go checklist

| # | Item | Status |
| --- | --- | --- |
| 1 | PITR on, daily export running, restore drill passed | ☐ |
| 2 | Evidence bucket versioning and soft delete on | ☐ |
| 3 | Incident roles named; on-call sheet exists; CERT-In contact saved | ☐ |
| 4 | Counsel signed off privacy notice, terms, retention | ☐ |
| 5 | Staff MFA enforced (`REQUIRE_STAFF_MFA` on) — see `admin-v2-security-setup.md` §6 | ☐ |
| 6 | App Check enforced (`ENFORCE_APP_CHECK` on) — §7 | ☐ |
| 7 | Security workflow green; Semgrep / OSV / ZAP / MobSF baselines triaged | ☐ |
| 8 | Play listing, data safety form, review accounts submitted | ☐ |
| 9 | Minimum app version set; maintenance message tested on a device | ☐ |
| 10 | Budget alerts on the billing account | ☐ |
