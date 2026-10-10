# Load Test Report — Healthcare Workforce backend

**Date:** 2026-10-09 to 2026-10-11
**Target:** Firebase project `doctor-c7c29` (pre-launch, no real users), after local work on the emulator
**Tools:** Apache JMeter 5.6.3 (API tests), Locust 2.46.7 (user simulation)
**Detailed log:** [PROGRESS.md](PROGRESS.md) · **How to run:** [README.md](README.md)

---

## Verdict

**The backend handles 1000 people using the app at the same time.** At 1000
concurrent users it served 74,097 requests in 10 minutes with a median of
88 ms and 95% under 200 ms, no application errors, and no overbooked duty or
double-booked doctor. Two real problems were found and fixed on the way,
including one that made every write call 10–20 times slower.

## Results

| Test | Where | Result |
|---|---|---|
| Functional API checks (lifecycle, idempotency, security, validation) | Cloud | ✅ 44 / 44 |
| Double-booking race: 30 selections for one seat at once | Cloud | ✅ exactly 1 assignment |
| Double-booking race: 20 hospitals select one doctor at once | Cloud | ✅ exactly 1 assignment |
| Locust 100 users × 5 min | Cloud | ✅ 3,859 requests, 0 failures, p95 190 ms |
| Locust 1000 users × 10 min | Cloud | ✅ 74,097 requests, 4 dropped connections (0.005%), p95 200 ms |
| Booking integrity after each run (seats add up, no doctor double-booked) | Cloud | ✅ passed (1,077 duties, 353 confirmed assignments) |
| Clean-up | Cloud | ✅ all test data removed, scan of every document found none left |

### 1000 users: what each user type experienced

| Action | Median | 95% under |
|---|---|---|
| Sign in | 410 ms | 470 ms |
| Doctor: browse marketplace | 99 ms | 180 ms |
| Doctor: open duty, My Duties, notifications | 77–82 ms | 130–150 ms |
| Doctor: apply to a duty | 120 ms | 210 ms |
| Doctor: confirm an offer | 110 ms | 200 ms |
| Hospital: dashboard | 84–93 ms | 130–200 ms |
| Hospital: review applicants | 82–85 ms | 110–140 ms |
| Hospital: select a doctor | 150 ms | 210 ms |
| Hospital: post a duty (create + publish) | 110 + 130 ms | 160–180 ms |
| Admin: work queues | 68–87 ms | 150 ms |

Going from 100 to 1000 users raised the 95th percentile by only 10 ms
(190 → 200 ms). Users ramped from 0 to 1000 in 60 seconds with no failures,
so scale-up under a sudden rise in users is covered.

## Problems found and fixed

| # | Problem | Impact | Fix | Status |
|---|---|---|---|---|
| 1 | Functions ran in `us-central1` (Iowa) while Firestore is in `asia-south1` (Mumbai) | Every database call inside a function crossed the Pacific; write calls took 1.6–6.6 s for a single user | All functions moved to `asia-south1`; app, admin portal and tests updated | ✅ Deployed. Warm calls now 0.1–0.25 s |
| 2 | Contested transactions that time out returned a generic `INTERNAL_ERROR` | Users would see "internal error" instead of "please refresh"; noise in error monitoring | Mapped to a retryable `CONCURRENT_UPDATE` (HTTP 409) | ✅ Deployed. Did not occur in production at this load |
| 3 | Cloud backend was behind the code: 5 functions and 4 indexes missing | The app's marketplace queries would have failed | Deployed current backend | ✅ |
| 4 | Clean-up script missed duties posted during a test | Test duties would have stayed in the real marketplace | Clean-up extended; leftover scan added | ✅ |

Problems in the test tooling itself (not the app) were also fixed: Locust
built a TLS context per user (stalling the load generator for minutes), and
certificate verification was off by default; both corrected.

## Recommendations before launch

1. **Make "select a doctor" (and "apply") retry-safe in the app.** The app
   creates a new idempotency key on every tap
   (`hospital_repository.dart:78`, `duty_repository.dart:28`). If a
   connection drops after the server has done the work — 4 times in 74,097
   requests at 1000 users — and the user taps again, the server correctly
   refuses a duplicate, but the user sees an error ("Cannot select
   application in status selected" / "already applied") for an action that
   succeeded. Keep one key per attempt, as confirmation already does
   (`messages_screen.dart:64`). Small change; no backend change needed.
2. **Bound the hospital dashboard queries.** "Own duties" and "own
   assignments" (`hospital_repository.dart:7–20`) have no `limit`, and the
   app keeps live listeners on them. Each hospital's list grows forever, so
   the dashboard gets slower and costs more reads over time. Add a limit
   and paging (other lists already use `limit(30)` / `limit(50)`).
3. **Decide on cold starts.** A few requests (<0.01%) took 1–4.7 s when a
   new function instance started. If the first requests after a quiet night
   must be fast, set `minInstances: 1` on the busiest functions
   (`applyToDuty`, `atomicSelectDoctor`, `confirmAssignment`,
   `getMyOrganizations`); this has a monthly cost per instance.
4. **Optional further tests.** Not run in this campaign: a 70-minute soak at
   1000 users (slow degradation over time) and a burst after a long idle
   period (all instances cold). Both can be run before launch with
   `perf/locust/run.ps1 -Profile soak` and a re-seed.

## Housekeeping after the campaign

- [ ] Turn off the Email/Password sign-in provider in the Firebase Console
      (it was enabled only for the test accounts; the app uses phone sign-in).
- [ ] Revoke the local Google Cloud credentials: `gcloud auth application-default revoke`.
- [ ] Rebuild any installed test build of the app (it calls the old function region).
- [ ] Check the Google Cloud billing page for the campaign's actual cost (estimate: $10–25).
- [ ] Optional: `firebase functions:artifacts:setpolicy --location us-east1 --days 1` to stop a leftover image repository from accruing storage cost.

## Limits of these results

- Load came from one laptop in India over home internet; real users on
  mobile networks will see added network time on top of these numbers.
- Locust simulates the app's requests over the same public APIs the SDKs use,
  but not the app's live Firestore listeners (it polls instead).
- 1000 users were sustained for 10 minutes, not hours.
