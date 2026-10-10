# Load Testing

Apache JMeter covers API and backend testing; Locust simulates real users.
Scripts are developed and checked on the local emulator first, then the
1000-user run targets `doctor-c7c29` before launch.

## Prerequisites

- Node 20+, Python 3.12 with `pip install locust`
- JDK 21+ for the Firebase emulators (`start-emulators.bat` selects it)
- JMeter 5.6.3 unzipped to `tools/apache-jmeter-5.6.3` (git-ignored)
- `npm install` inside `perf/`

## Test data

```
npm run emulators   # terminal 1: Auth, Functions, Firestore on demo-healthforce
npm run seed        # terminal 2: clears old load-test data, then seeds
npm run cleanup     # removes every load-test user and document
npm run verify      # after a run: seats add up and no doctor is double-booked
```

The seed creates 900 verified doctors, 75 approved hospitals with 2 staff
each, 25 platform admins (verifier + support claims) and 600 published
duties. Credentials and IDs are written to `perf/data/*.csv` (git-ignored) for
JMeter and Locust. Each run uses a new random password.

Every Auth UID and seeded document ID starts with `loadtest_`. Cleanup removes
those, plus everything the backend created during a run (applications,
assignments, schedules, audit logs, notifications, duties posted during a
run), found through the load-test entity each document references.

## JMeter (API and backend tests)

Run from `perf/jmeter/` in PowerShell with the emulators running and data seeded:

```
.\run.ps1 functional                          # 44 checks: duty lifecycle, idempotency, security, validation
.\run.ps1 concurrency                         # double-booking races; re-seed before repeated runs
.\run.ps1 baseline -Threads 10 -Duration 60   # per-endpoint load, one area after another
python summarize.py ..\results\baseline-*     # latency table for one or more runs
```

Each run writes `results.jtl`, `jmeter.log` and an HTML report to
`perf/results/<plan>-<target>-<timestamp>/` (git-ignored). Add `-Target cloud`
to run against `doctor-c7c29`.

| Plan | What it checks |
|---|---|
| `functional.jmx` | Sign-in; create → publish → apply → shortlist → select → confirm → contact → cancel; replays with the same idempotency key; role and tenant checks; Firestore rules; input validation |
| `concurrency.jmx` | Race 1: 30 selections for one seat at the same instant. Race 2: 20 hospitals select one doctor for overlapping shifts at the same instant. Each must yield exactly one assignment, verified in the database |
| `baseline.jmx` | Doctor marketplace reads, doctor applications, hospital dashboard, admin queues, each under `-Threads` users for `-Duration` seconds |

The `.jmx` files are generated: edit `build_plans.py` and run
`python build_plans.py`. Response checks live in `lib/expect.groovy`, and
setup and verification helpers in `lib/*.groovy`.

## Locust (user simulation)

Run from `perf/locust/` in PowerShell with the emulators running and data seeded:

```
.un.ps1 -Users 50                                  # 5 minutes, 5 new users per second
.un.ps1 -Users 100 -SpawnRate 10 -Duration 10m
python -m locust -f locustfile.py                    # interactive web UI on http://localhost:8089
```

Each simulated person signs in with their own seeded account and does what
the app's screens do, pausing between actions like a real user:

| User | Share | What they do |
|---|---|---|
| Doctor | 85% (5–15 s pauses) | Browse the marketplace (all, or by specialty), open duties, apply, check My Duties and accept offers, read the hospital contact after confirming, check notifications, view profile |
| Hospital staff | 13% (5–20 s) | Dashboard (organizations, own duties, own assignments), review applicants and their credentials, select a doctor, post and publish new duties, check notifications |
| Platform admin | 2% (10–30 s) | Verification queue and admin queues |

At 1000 users that is about 850 doctors, 130 hospital staff and 20 admins,
within the seeded 900 / 150 / 25 accounts. Hospitals select the doctors who
applied during the run, and those doctors then confirm, so the whole
apply → select → confirm → contact flow happens between simulated people.

Losing outcomes that are normal when many people act at once
(`APPLICATION_ALREADY_EXISTS`, `DUTY_CAPACITY_FILLED`, `ASSIGNMENT_CONFLICT`,
`INVALID_STATE_TRANSITION` on stale data, `OFFER_EXPIRED`, `CONCURRENT_UPDATE`)
count as successes. `outcomes.csv` shows how often each happened. Anything else
(5xx, permission or rule denials, wrong contact) is a failure, and the run
exits non-zero.

Each run writes `report.html`, `stats_*.csv`, `outcomes.csv` and `locust.log`
to `perf/results/locust-<users>u-<target>-<timestamp>/`. Run `npm run verify`
afterwards to check booking integrity in the database. Use
`-Target cloud -Confirm doctor-c7c29` for the real project. ID tokens are
refreshed every 50 minutes, so soak runs can go past an hour.

## Cloud project

Cloud mode needs the project ID repeated as a safeguard, and Application
Default Credentials (`gcloud auth application-default login`):

```
node seed/seed.mjs    --target cloud --confirm doctor-c7c29
node seed/cleanup.mjs --target cloud --confirm doctor-c7c29
```

Enable the Email/Password sign-in provider for the run and disable it again
afterwards; the app itself signs in by phone.
