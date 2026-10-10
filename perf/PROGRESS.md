# Load Testing Progress

Running log of the load-testing work: what has been decided, what is done,
and what is next. Newest updates are at the bottom of each section.
How-to instructions live in [README.md](README.md).

**Last updated:** 2026-10-10
**Branch:** `perf/load-testing-2026-10-10`

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
| 3 | JMeter plans: functional, security, idempotency, double-booking concurrency, per-endpoint baseline | Emulator | ✅ Done (finding 1 fixed) |
| 4 | Locust user scenarios (doctor, hospital, admin), checked at 50–100 users | Emulator | ✅ Done |
| 5 | Smoke pass, concurrency test and the 1000-user Locust runs (load, spike, soak) | `doctor-c7c29` | 🔄 In progress (smoke passed after region fix) |
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

**Finding 1 (fixed 2026-10-10): losers of a seat race sometimes got "internal error" instead of "duty filled"**

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
- **Fix:** `toCallableError` now maps Firestore `ABORTED` (gRPC code 10) to
  the new domain code `CONCURRENT_UPDATE`, sent as callable status `aborted`
  (HTTP 409) with the message "Someone else just updated this. Please refresh
  and try again." It is logged as a warning, not an error. The JMeter races
  accept `CONCURRENT_UPDATE` as a valid losing outcome.
- **Verified:** new unit test `functions/tests/callable_errors.test.ts`
  (fails when the fix is disabled); full emulator suite 13 suites / 75 tests
  passed. Re-ran the races 4 times on the emulator: the lock timeout happened
  again in 1 run, and all 29 losers got HTTP 409 `CONCURRENT_UPDATE` instead
  of 500. No double booking in any run.
- **Still to check in step 5:** the emulator's locking is not identical to
  production's, so how often this happens must be confirmed on the cloud run.

### Step 4: Locust user scenarios (2026-10-10)

Built in `perf/locust/` (how to run them is in [README.md](README.md#locust-user-simulation)):

| File | Purpose |
|---|---|
| `locustfile.py` | The three user types and what they do |
| `firebase_client.py` | Sign-in with token refresh, callable requests, Firestore REST reads, outcome tally |
| `run.ps1` | One-command headless runner; writes results to `perf/results/locust-*` |
| `../seed/verify.mjs` (`npm run verify`) | After a run: every duty's seats add up and no doctor holds overlapping live assignments |

Each simulated person signs in with their own seeded account and makes the
same reads and calls as the app's screens, with human pauses (5–30 s):

- **Doctors (85%):** marketplace (all and by specialty), open duty, apply,
  My Duties (accept any offer), hospital contact after confirming,
  notifications, profile.
- **Hospital staff (13%):** dashboard (organizations, own duties, own
  assignments), applicants and their credential snapshots, select a doctor,
  post and publish new duties, notifications.
- **Admins (2%):** verification queue and admin queues.

Hospitals select doctors who applied during the run, and those doctors then
confirm, so the full flow happens between simulated people. Normal losing
outcomes (already applied, seat filled, stale state, offer expired,
`CONCURRENT_UPDATE`) count as successes and are tallied in `outcomes.csv`;
anything else fails the run.

#### Result: emulator check, 0 failures ✅

| Run | Requests | Failures | Flow completed | Integrity check |
|---|---|---|---|---|
| 10 users, 90 s (smoke) | 127 | 0 | — | — |
| 50 users, 5 min | 1,994 | 0 | 85 applications, 16 selections, 11 confirmations, 6 contact reads | PASS (607 duties) |
| 100 users, 5 min | 3,964 | 0 | 167 applications, 36 selections, 31 confirmations, 20 contact reads, 30 duties posted | PASS (637 duties, 42 confirmed, 9 open offers) |

- At 100 users the median request took 9 ms. The slowest median calls were
  the hospital's `atomicSelectDoctor` (89 ms) and `getMyOrganizations`
  (65 ms). As with JMeter, emulator timings only show the scripts work; real
  numbers come from step 5.
- The only non-OK outcomes were expected ones: 2 × `APPLICATION_ALREADY_EXISTS`
  (doctors who had applied in the 50-user run), 3 × `INVALID_STATE_TRANSITION`
  on apply and 1 on select (duty filled since the doctor or hospital last
  looked).
- **Integrity check works:** after setting one duty's `remainingHeadcount`
  to a wrong value, `npm run verify` reported the problem and exited 1.

**Issue found and fixed: clean-up missed duties posted during a run.**
`cleanup.mjs` only removed duties whose IDs start with `loadtest_`. Duties
that hospitals create through `createDuty` get auto IDs, so on the cloud run
they would have stayed in the real marketplace. Clean-up now also removes
duties whose `organizationId` belongs to a load-test hospital (with their
applications). Verified: after the runs, clean-up removed 637 duties
(600 seeded + 37 posted) and the emulator had 0 collections and 0 accounts left.

**For step 5:** Firebase Auth's abuse protection may throttle many sign-ins
from one IP (`TOO_MANY_ATTEMPTS_TRY_LATER`). Spawning 1000 users from one
laptop means 1000 sign-ins in under a minute at a spawn rate of 20/s. This
has not been tested against the real project. Watch the `Auth: sign in` row on the first cloud run, and lower
`-SpawnRate` if it shows failures.

### Step 5: Cloud runs on `doctor-c7c29` (in progress, 2026-10-10)

**Preparation done:**

- The cloud backend was behind the code: 5 functions from the 2026-10-08
  fixes and 4 of 20 Firestore indexes were missing. Deployed functions,
  Firestore rules and indexes, and Storage rules (Storage was granted the
  role it needs for rules that read Firestore). Verified afterwards: all
  functions present, 20 / 20 indexes.
- Seeded the cloud project (1,075 accounts, 75 organizations, 600 duties) in
  120 s. Email/Password sign-in enabled for the test accounts.
- Load patterns added for Locust (`perf/locust/shapes/`): `load`, `spike`
  and `soak` (see README).

#### Result: cloud smoke test, 44 / 44 passed ✅ (but slow)

Every check passed against the real backend, but with one user the calls
that touch the database took 1.6–6.6 s:

| Kind of request | Time |
|---|---|
| Direct Firestore reads (marketplace) | 0.1–0.3 s |
| Calls rejected before any database work (validation) | ~0.6 s |
| Calls that read or write data (apply, select, confirm, publish, contact) | 1.6–6.6 s |

**Finding 2 (fixed and deployed): functions ran in a different region from
the database**

- **Cause:** Firestore is in `asia-south1` (Mumbai), but no region was set
  for the functions, so all callables ran in the default `us-central1`
  (Iowa). Every database read or write inside a function crossed the Pacific
  (about 0.25 s each way), and transactions make several. Users in India
  also had to reach Iowa first. Even warm repeat calls were slow
  (`confirmAssignment` replay: 2.9 s).
- **Fix:** `setGlobalOptions({ region: 'asia-south1' })` in
  `functions/src/index.ts`. The Flutter app now calls functions through one
  shared client, `BackendConfig.functions` in
  `lib/core/config/backend_config.dart` (all 11 files that used
  `FirebaseFunctions.instance` changed). The admin portal uses
  `getFunctions(app, 'asia-south1')`. JMeter and Locust endpoints updated.
- **Verified on the emulator (now serving `asia-south1`):** Functions
  suite 13 suites / 75 tests passed; JMeter functional 44 / 44; both
  double-booking races passed; Locust 30 users for 2 min, 502 requests,
  0 failures, integrity check passed. `flutter analyze --no-pub` shows the
  same 136 issues as before the change, none from it (the local Flutter
  3.24.5 is older than the project's `>=3.35.0` requirement, so most of
  those are newer-API errors unrelated to this work).
- **Deployed (2026-10-10):** all 36 functions now in `asia-south1`; the old
  `us-central1` / `us-east1` copies deleted; admin portal republished. Any
  installed test build of the app must be rebuilt to reach the new region.
- **Re-run smoke test: 44 / 44 passed, whole run 20 s instead of 91 s.**

  | Request | Before | After |
  |---|---|---|
  | `confirmAssignment` replay (warm) | 2,877 ms | 152 ms |
  | `getAssignmentContact` | 3,917 ms | 249 ms |
  | Permission-denied checks | 2,000–3,700 ms | 108–157 ms |
  | First call to each function (cold start) | 3,500–6,650 ms | 950–1,400 ms |

  Warm calls now take 0.1–0.25 s. The ~1 s first calls are cold starts of
  the newly created functions; the load runs show how often users meet them.

#### Result: cloud double-booking races, no double booking ✅

| Race | Outcome | Selection time (min / median / max) |
|---|---|---|
| 1: 30 selections for one seat at once | 1 assignment; 29 × `INVALID_STATE_TRANSITION` (duty already filled); duty `filled`, 0 seats left | 0.94 / 1.6 / 2.3 s |
| 2: 20 hospitals select one doctor for overlapping shifts at once | 1 assignment; 19 × `ASSIGNMENT_CONFLICT` | 0.42 / 0.87 / 1.3 s |

- Verified in the production database after the race. No `ABORTED` lock
  timeouts (`CONCURRENT_UPDATE`) in production: real Firestore queued the
  30 contending transactions without giving up, unlike the emulator in
  1 of 4 runs. The Finding 1 mapping stays as a safety net.
- The 30.7 s sample in the run summary is the race setup step (creating
  21 duties and 50 applications in sequence), not a user request.

#### Run: Locust 100 users × 5 min (cloud), result not valid: the load generator was the bottleneck

2,968 requests, 24 failures (all `Auth: sign in`, no HTTP response). After
start-up the median was 78 ms, but the first 1–2 minutes were very slow:
sign-ins took 23 s (median) and up to 35 s, the first Firestore read per
user 15–41 s. Locust warned that the laptop's CPU was above 90% during
start-up. No business errors: 116 applications, 5 selections, 4
confirmations, all OK.

**Cause (Locust setup, not the app):** Locust's fast HTTP client builds a new
TLS context per user per host, and each one loads the CA certificate bundle,
which measured **338–440 ms of CPU** on this laptop. 100 users × 3 Google
hosts = 300 contexts ≈ 130 s of single-core CPU right at start-up, so the
event loop stalled and connections timed out (the 24 failures). At 1000 users
it would have been about 20 minutes.

**Fix:** all simulated users share one TLS context
(`shared_ssl_context` in `locustfile.py`); setting up 100 users × 3 hosts
now takes 0.00 s instead of about 130 s. Certificates are now verified
(`insecure = False`; Locust's default skipped verification), checked
against a site with an expired certificate. Failures with no HTTP response
now show the real connection error instead of "HTTP 0". The 100-user run
must be repeated.

#### Result: Locust 100 users × 5 min (cloud, re-run), 0 failures ✅

3,859 requests, 0 failures, about 13 req/s. All 100 users (85 doctors,
13 hospital staff, 2 admins) active within 10 s; no CPU warning.
Median 49 ms, p95 190 ms, p99 370 ms, max 2.1 s.

| Request | p50 | p95 |
|---|---|---|
| Auth: sign in | 370 ms | 410 ms |
| Doctor: marketplace / by specialty | 58 / 59 ms | 80 / 82 ms |
| Doctor: open duty / my duties | 40 / 40 ms | 49 / 61 ms |
| Doctor: applyToDuty | 120 ms | 200 ms |
| Doctor: confirmAssignment | 140 ms | 300 ms |
| Doctor: hospital contact | 150 ms | 2.1 s (one cold start of 13) |
| Hospital: getMyOrganizations | 100 ms | 180 ms |
| Hospital: applicants / credentials | 47 / 44 ms | 55 / 110 ms |
| Hospital: atomicSelectDoctor | 160 ms | 200 ms (max 742 ms) |
| Hospital: createDuty / publishDuty | 130 / 160 ms | 180 / 200 ms |
| Admin: queues | 83–120 ms | 110–210 ms |

- Flow between simulated users: 170 applications, 21 selections,
  15 confirmations, 13 contact reads, 18 duties posted. Only non-OK
  outcomes: 2 × `APPLICATION_ALREADY_EXISTS` (doctors from the earlier run).
- **Integrity check (cloud): PASS.** 667 duties checked; assignments
  19 confirmed, 9 open offers, 2 cancelled (from the smoke test);
  27 doctors with live assignments, none double-booked.

#### Result: Locust 1000 users × 10 min (cloud), 4 transport failures in 74,097 ✅

All 1000 users (850 doctors, 130 hospital staff, 20 admins) active within
50 s; about 115 req/s; no CPU warning on the load generator; 1,000 / 1,000
sign-ins succeeded (no Auth throttling).

| | 100 users | 1000 users |
|---|---|---|
| Requests | 3,859 | 74,097 |
| p50 / p95 / p99 | 49 / 190 / 370 ms | 88 / 200 / 410 ms |
| Failures | 0 | 4 (0.005%) |

| Request | p50 | p95 | Calls |
|---|---|---|---|
| Auth: sign in | 410 ms | 470 ms | 1,000 |
| Doctor: marketplace (both queries) | 99 ms | 180 ms | 22,561 |
| Doctor: open duty / my duties / notifications | 77–82 ms | 130–150 ms | 27,357 |
| Doctor: applyToDuty | 120 ms | 210 ms | 3,111 |
| Doctor: confirmAssignment | 110 ms | 200 ms | 336 |
| Doctor: hospital contact | 120 ms | 190 ms | 296 |
| Hospital: dashboard queries | 84–93 ms | 130–200 ms | 7,756 |
| Hospital: applicants / credentials | 82–85 ms | 110–140 ms | 4,747 |
| Hospital: atomicSelectDoctor | 150 ms | 210 ms | 423 |
| Hospital: createDuty / publishDuty | 110 / 130 ms | 160 / 180 ms | 410 / 410 |
| Admin: queues | 68–87 ms | 150 ms | 583 |

- Ten times the users raised p95 by only 10 ms. A few requests (<0.01%)
  took 2–4.7 s, consistent with cold starts while instances scaled out.
- Flow: about 3,070 applications, 394 selections, 334 confirmations,
  296 contact reads, 410 duties posted. Expected losing outcomes: 31 + 15
  `INVALID_STATE_TRANSITION` (duty filled first), 14 `ASSIGNMENT_CONFLICT`,
  4 `APPLICATION_ALREADY_EXISTS`. No permission errors, no 5xx, no
  `CONCURRENT_UPDATE`.
- **Failures:** 2 × applyToDuty and 2 × confirmAssignment with
  `HTTPConnectionClosed`: the client reused a keep-alive connection as
  Google's front end closed it, so no response arrived. Not a function
  error. Follow-up: confirm the Flutter app retries these calls with the
  same idempotency key on a dropped connection.
- **Integrity check (cloud): PASS.** 1,077 duties checked; assignments
  353 confirmed, 69 open offers, 2 cancelled; 311 doctors with live
  assignments, none double-booked and no seat oversold.

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
