# v1.1 blueprint review and Firebase adaptation

Source: `C:\Users\seesi\Downloads\Healthcare_Workforce_Ecosystem_Master_Blueprint_v1.1_Final.pdf` (96 pages). Reviewed 2026-10-02. Page references are PDF page numbers. The user chose to retain Firebase despite the v1.1 document's Supabase/PostgreSQL implementation proposal. The accepted Firebase mapping in `docs/adr/001-firebase-migration-and-concurrency.md` remains the architectural basis.

## Product scope

The current release should remain a **controlled Phase 1 pilot**: doctor Android onboarding, hospital intake, an actual verifier workspace, private evidence, explicit verification decisions, and auditable duty operations. Phase 2 is gated behind founder approval and validation. Phases 3-5 are future opportunities, not launch promises (pp. 2, 5, 81-92). Existing Phase 2 code and feature flags do not by themselves demonstrate deployed, reviewed workflows.

## Priority gaps

| Priority | Blueprint requirement | Current local state | Required next work |
| --- | --- | --- | --- |
| P0 | Official-source doctor verification with real evidence and human review; uncertain cases never auto-pass (pp. 25, 64-67) | A mock adapter previously manufactured a match. It now returns `SOURCE_UNAVAILABLE`; check requests stay under review. Approval requires recorded source fields, but this is only a partial reviewer record. | Build the verifier case UI and trusted source evidence capture. Validate documents, registration number, council, name, qualification, status, source timestamp and reviewer identity. Add a second reviewer for high-risk cases. Do not claim an NMC/SMC API or scrape without permission. |
| P0 | Private evidence, controlled access and audit (pp. 5, 56-63, 67) | Doctor uploads require a matching case and client evidence reads are denied. A Storage trigger creates document metadata and SHA-256 with file-signature checks. Records remain `pending` until a trusted malware scanner marks them `clean`; approval and preview fail closed. | Provision production bucket, deploy rules, integrate an actual malware scanner, and verify the complete upload-to-decision flow. Org and dispute evidence stay disabled until their flows are built. |
| P0 | Real admin role separation, MFA/step-up, queues, and decisions (pp. 35-38) | Browser portal now uses Firebase Auth and live verifier callables; all hardcoded cases were removed. Recent sign-in and custom claims are server-checked. Only the unauthenticated local page was browser-verified. | Enroll real verifier identities and MFA, test authenticated role isolation, finish hospital workflow and audit UI. |
| P0 | Explicit state machines and atomic transitions (p. 5; pp. 66-67) | Case creation is owner-bound and idempotent; submission and decision now recheck state in server transactions. Decision, subject update, outbox and decision audit are atomic. Case creation/submission audits remain separate. | Add replay and dual-review tests, test callable transitions against the emulator, and bring case creation/submission audit into their transactions. |
| P1 | Doctor Verification Center displays real status, requirements, appeal trail (pp. 17-28) | Screen subscribes to persisted case status and evidence metadata and can create/submit its case. Fake appeal success was removed and disabled pending implementation. | Add reviewer requests, resubmission, appeal and timeline once backend exists. |
| P1 | Hospital verification, staffing workflow and scoped memberships (pp. 29-34) | Hospital screen now uses real organizations/facilities, creates and submits a case, and uploads case-bound private evidence. Server checks org admin membership; client writes to org and membership records are denied. Scanner, authenticated end-to-end reviewer test, and member-invitation flow remain incomplete. | Finish actual malware scanner, test organization review end-to-end, add audited member invitation and revocation, and run hospital acceptance tests. |
| P1 | Founder-controlled pilot and measurable validation before Phase 2 (pp. 2, 81-92) | Feature flags and modules exist, but pilot acceptance records are absent. | Define founder sign-off, real hospital/doctor test cohort, incident/rollback procedure, outcome metrics, and staged Play Store checks. |
| P2 | Later ecosystem phases (pp. 2, 81-92) | Out of current Phase 1 delivery. | Keep gated and unadvertised until Phase 1 evidence and approvals exist. |

## Firebase mapping

| v1.1 concept | Firebase implementation target |
| --- | --- |
| Supabase Auth / Postgres RLS | Firebase Auth, custom claims, deny-by-default Firestore and Storage rules |
| PostgreSQL tables and transactions | Firestore collections; server-side transactions for contested state |
| Supabase Edge Functions | Cloud Functions v2 (TypeScript) |
| Private object storage and signed access | Cloud Storage with direct reads denied and short-lived, audited server URLs |
| Admin web | Firebase Auth + custom claims + modular portal; not yet connected |

## Validation and release boundary

Local Cloud Functions TypeScript build and 44 tests pass. Seven combined Storage/Firestore rules tests ran against the Firebase emulators. Flutter analysis of changed verification and hospital files had no errors or warnings; informational lints remain. Android debug APK builds at API 36 with A: caches. These checks do **not** establish a production Firebase deployment, live SMS/Google sign-in, an approved official registry process, a malware scanner, an authenticated admin browser workflow, or an end-to-end verified doctor/hospital. No production rules or functions were deployed as part of this review.
