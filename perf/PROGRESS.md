# Load Testing Progress

Running log of the load-testing work: what has been decided, what is done,
and what is next. Newest updates are at the bottom of each section.
How-to instructions live in [README.md](README.md).

**Last updated:** 2026-10-10
**Branch:** `fix/production-blockers-2026-10-08`

---

## Goal

Test the Healthcare Workforce backend before launch:

- **Apache JMeter** for API and backend testing: each endpoint is correct,
  secure, and safe under concurrent use.
- **Locust** for real-world user simulation: doctors, hospital staff and
  admins using the app at the same time, up to **1000 concurrent users**.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where tests are built and debugged | Local Firebase emulator (project `demo-healthforce`) | Free, fast, and a `demo-` project can never reach real Firebase services |
| Where the 1000-user test runs | `doctor-c7c29` (the real project) | App is not launched yet, so there are no real users to affect. The project is already on Blaze (all Cloud Functions are deployed), so there is no user cap |
| Staging project | Not created | Not needed while the app is pre-launch |
| Expected cloud cost | ~$10–25 for the whole campaign | Estimate from Firestore and Cloud Functions pricing at 1000 users |
| Tools | JMeter 5.6.3, Locust 2.46.7 | Both free and open source |

## Plan

| # | Step | Where | Status |
|---|---|---|---|
| 1 | Install JMeter and Locust | Laptop | ✅ Done |
| 2 | Seed and clean-up scripts for test data | Emulator | ✅ Done |
| 3 | JMeter plans: functional, security, idempotency, double-booking concurrency, per-endpoint baseline | Emulator | ✅ Done (1 finding open) |
| 4 | Locust user scenarios (doctor, hospital, admin), checked at 50–100 users | Emulator | ⏳ Next |
| 5 | Smoke pass, concurrency test and the 1000-user Locust runs (load, spike, soak) | `doctor-c7c29` | ⏳ Not started |
| 6 | Clean-up of cloud test data, results report, fixes for any bottlenecks | `doctor-c7c29` + repo | ⏳ Not started |

---

## Log

### Step 1: Tools installed (2026-10-09)

- **Locust 2.46.7** installed with `pip install locust`.
- **Apache JMeter 5.6.3** (latest release) downloaded to
  `tools/apache-jmeter-5.6.3/`. The download was checked against Apache's
  official SHA-512 checksum. `tools/` is git-ignored.
- Java 17 (system default) and Python 3.12 were already installed.

### Step 2: Test data scripts (2026-10-09)

Built in `perf/`:

- `seed/seed.mjs` (`npm run seed`): creates the test accounts and data:
  - 900 verified doctors
  - 75 approved hospitals, each with a facility and 2 staff accounts
  - 25 platform admins (verifier and support-admin roles)
  - 600 published duties spread over the next 3–30 days
  - Login details for every account go to `perf/data/*.csv` (git-ignored),
    which JMeter and Locust read. Each seed run uses a new random password.
- `seed/cleanup.mjs` (`npm run cleanup`): deletes all of it, including
  everything the backend creates during a test (applications, assignments,
  schedules, audit logs, notifications).
- `seed/target.mjs`: picks the target. The emulator is the default. The real
  project needs `--target cloud --confirm doctor-c7c29`, so it cannot be hit
  by accident.
- `start-emulators.bat` (`npm run emulators`): builds the functions and
  starts the Auth, Functions and Firestore emulators.

Every test account and seeded record starts with `loadtest_`.

**Verified on the emulator:**

- Seeding takes about 10 seconds.
- Signed in over HTTP and ran a full flow against the real function code:
  apply → replay apply (no duplicate) → shortlist → select → confirm →
  view contact. All succeeded.
- No login is rejected (401). A doctor calling an admin function is blocked (403).
- The marketplace query the app uses returns 50 duties.
- After clean-up, Firestore and Auth were both completely empty: 1,075
  accounts plus 27 documents the backend generated during the flow.

**Issue found and solved:** the Firebase CLI (15.29) needs Java 21+, but the
system default is Java 17. A Microsoft JDK 21 was already installed, so
`start-emulators.bat` uses it for the emulators only. The Android build keeps
using Java 17.

### Step 3: JMeter plans (2026-10-10)

Built in `perf/jmeter/` (how to run them is in [README.md](README.md#jmeter-api-and-backend-tests)):

| File | Purpose |
|---|---|
| `functional.jmx` | 44 checks in one pass (details below) |
| `concurrency.jmx` | The double-booking races |
| `baseline.jmx` | Per-endpoint load at 1 / 10 / 50 users |
| `build_plans.py` | Generates the three `.jmx` files (edit this, not the XML) |
| `lib/expect.groovy` | Checks every response (status, error code, JSON values) |
| `lib/firebase.groovy`, `lib/race_*.groovy` | Setup and database verification for the races |
| `run.ps1` | One-command runner; writes results and an HTML report to `perf/results/` |
| `summarize.py` | Prints a latency table (p50 / p95 / p99, errors, req/s) |
| `cloud.properties` | Endpoints for the later run on `doctor-c7c29` |

#### Result 1: Functional plan, 44 / 44 passed ✅

| Area | Checks |
|---|---|
| Sign-in | 5 roles sign in; a wrong password is rejected |
| Duty lifecycle | getMyOrganizations → createDuty → publishDuty → marketplace queries → apply → shortlist → select → confirm → contact (both sides) → cancel → seat released |
| Idempotency | Repeating apply, select or confirm with the same key returns the original result without duplicating it. Applying again with a new key is rejected (`APPLICATION_ALREADY_EXISTS`) |
| Security | No token and forged tokens get 401. A doctor cannot open admin or verification queues or create hospital duties. Another hospital cannot shortlist, publish or read contacts. A hospital cannot make itself super admin. A second doctor cannot confirm someone else's offer. Contact is hidden before confirmation. Firestore rules block direct duty edits, reading another user's profile and signed-out queries |
| Validation | Malformed IDs, short idempotency keys, duties in the past, shifts over 24 h and missing duties are all rejected with the right error code |

#### Result 2: Double-booking concurrency, no double booking in any run ✅

| Race | What happens | Result (4 runs) |
|---|---|---|
| 1: one seat | 30 selections for a 1-seat duty fire at the same instant | Exactly 1 assignment every run; duty shows 0 seats left, status `filled` |
| 2: one doctor | 20 hospitals select the same doctor for overlapping shifts at the same instant | Exactly 1 assignment every run; 19 × `ASSIGNMENT_CONFLICT` |

#### Result 3: Per-endpoint baseline, 0 errors in about 120,000 requests ✅

Each area ran for 60 s with no think time (every user fires requests
back-to-back), so this is a stress pattern. Times are in milliseconds.

| Request | p95 at 1 user | p95 at 10 users | p95 at 50 users |
|---|---|---|---|
| Doctor: marketplace query | 15 | 30 | 281 |
| Doctor: applyToDuty | 65 | 69 | 244 |
| Hospital: getMyOrganizations | 67 | 76 | 606 |
| Hospital: own duties query | 19 | 24 | 257 |
| Admin: getAdminQueues | 58 | 71 | 800 |
| Admin: getVerificationQueue | 41 | 51 | 673 |

Total throughput rose from about 11 req/s to 263 req/s between 1 and 10
users, then stayed flat at 211 req/s at 50 users. That means the laptop
running the emulator was saturated, as expected. **These emulator numbers
only show that the plans work and give relative costs. They are not
production performance.** Real numbers come from step 5.

Relative costs worth watching on the cloud run: `getAdminQueues` and
`getMyOrganizations` are the slowest calls and had the worst p99 at 50 users
(10.3 s and 5.7 s).

#### Findings

**Finding 1 (open): losers of a seat race sometimes get "internal error" instead of "duty filled"**

- **What happened:** in 1 of 4 seat-race runs, the 29 losing selections got
  HTTP 500 `INTERNAL_ERROR`. In the other 3 runs they got the correct
  `INVALID_STATE_TRANSITION` (duty already filled). There was no double
  booking in any run.
- **Cause:** with 30 transactions on the same duty, Firestore made them
  wait for a lock and aborted some with `10 ABORTED: Transaction lock
  timeout`. `toCallableError` in `functions/src/shared/errors.ts` turns any
  unrecognised error into a generic `internal` error, so the hospital user
  sees "An internal error occurred" rather than "this duty was just filled,
  please refresh".
- **Impact:** data stays correct, but the error message is misleading, and
  it would show up in error monitoring as a server bug.
- **Proposed fix (not applied yet):** map Firestore `ABORTED` errors to a
  retryable callable error (for example `aborted` with domain code
  `CONCURRENT_UPDATE`) so the app can show "someone else just updated this,
  please try again". The emulator's locking is not identical to
  production's, so the frequency must be confirmed in step 5.

**Note (not an app issue): laptop sleep stalls a test**

- During the 1-user baseline the laptop went into Windows Modern Standby
  (00:03 → 00:12, confirmed in the Windows event log). One request was
  recorded as taking 9 minutes. The rest of that run is valid.
- **Before the cloud run:** plug the laptop in and stop it sleeping
  (Settings → System → Power → "Never" for sleep while plugged in), or the
  1000-user results will be corrupted.

**Note (harmless):** the emulator log prints "Firebase Authentication
function was not triggered due to emulation error" each time the seed
creates or deletes a test account. No auth trigger is exported, so nothing
is skipped.
