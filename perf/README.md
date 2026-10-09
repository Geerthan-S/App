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
```

The seed creates 900 verified doctors, 75 approved hospitals with 2 staff
each, 25 platform admins (verifier + support claims) and 600 published
duties. Credentials and IDs are written to `perf/data/*.csv` (git-ignored) for
JMeter and Locust. Each run uses a new random password.

Every Auth UID and seeded document ID starts with `loadtest_`. Cleanup removes
those, plus everything the backend created during a run (applications,
assignments, schedules, audit logs, notifications), found through the
load-test entity each document references.

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

## Cloud project

Cloud mode needs the project ID repeated as a safeguard, and Application
Default Credentials (`gcloud auth application-default login`):

```
node seed/seed.mjs    --target cloud --confirm doctor-c7c29
node seed/cleanup.mjs --target cloud --confirm doctor-c7c29
```

Enable the Email/Password sign-in provider for the run and disable it again
afterwards; the app itself signs in by phone.
