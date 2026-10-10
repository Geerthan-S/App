"""
Real-world user simulation: doctors, hospital staff and platform admins using
the app at the same time, each signed in with their own seeded account and
doing what the app's screens do, with human pauses between actions.

    .\\run.ps1 -Users 50                       (from perf/locust, PowerShell)
    locust -f locustfile.py --target emulator  (interactive web UI)

Mix: 85% doctors, 13% hospital staff, 2% admins. At 1000 users that is about
850 / 130 / 20, within the 900 / 150 / 25 seeded accounts.

Expected business outcomes (losing a seat, applying twice, an offer that
expired) count as successes; outcomes.csv shows how often each happened.
Anything else (500s, permission errors, rule denials) is a failure.
"""

import logging
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from locust import FastHttpUser, between, events, task

from firebase_client import (AccountPool, FirebaseSession, and_, endpoints, eq, in_, outcomes, read_csv,
                             structured_query, write_outcomes)

log = logging.getLogger("healthforce")

URLS = {}
SPECIALTIES = sorted({d["specialtyName"] for d in read_csv("duties.csv")})

# Domain codes that are normal results of many people using the app at once.
APPLY_EXPECTED = {"APPLICATION_ALREADY_EXISTS", "DUTY_CAPACITY_FILLED", "INVALID_STATE_TRANSITION", "CONCURRENT_UPDATE"}
SELECT_EXPECTED = {"DUTY_CAPACITY_FILLED", "ASSIGNMENT_CONFLICT", "INVALID_STATE_TRANSITION", "CONCURRENT_UPDATE"}
CONFIRM_EXPECTED = {"OFFER_EXPIRED", "INVALID_STATE_TRANSITION", "CONCURRENT_UPDATE"}

# Same shifts as the seed (perf/seed/seed.mjs).
SHIFTS = [("morning", 8, 6), ("evening", 14, 6), ("night", 20, 10), ("full_day", 9, 12)]


@events.init_command_line_parser.add_listener
def _add_arguments(parser):
    parser.add_argument("--target", choices=["emulator", "cloud"], default="emulator",
                        help="Backend to load: the local emulator (default) or the real project")
    parser.add_argument("--confirm", default="", help="Project ID, required with --target cloud")
    parser.add_argument("--results-dir", default="", help="Folder for outcomes.csv")


@events.init.add_listener
def _configure(environment, **_kwargs):
    options = environment.parsed_options
    URLS.update(endpoints(options.target, options.confirm))
    AppUser.host = URLS["functions"]
    log.info("Target: %s (%s)", options.target, URLS["project"])


@events.test_stop.add_listener
def _report_outcomes(environment, **_kwargs):
    results_dir = environment.parsed_options.results_dir
    if results_dir:
        write_outcomes(Path(results_dir) / "outcomes.csv")
    for (name, outcome), count in sorted(outcomes.items()):
        if outcome != "OK":
            log.info("Outcome %-45s %-28s %d", name, outcome, count)


def future(dt):
    return dt > datetime.now(timezone.utc).isoformat()


class AppUser(FastHttpUser):
    abstract = True
    accounts = None  # AccountPool, set per subclass
    network_timeout = 60.0
    connection_timeout = 30.0

    def on_start(self):
        self.fb = FirebaseSession(self.client, URLS, self.accounts.take())
        self.fb.sign_in()

    def notifications(self, role):
        uid = self.fb.uid
        self.fb.query(f"{role}: notifications inbox",
                      structured_query("inboxNotifications", eq("userId", uid), "createdAt", 50))
        self.fb.query(f"{role}: unread badge",
                      structured_query("inboxNotifications", and_(eq("userId", uid), eq("isRead", False))))


class DoctorUser(AppUser):
    """Browses the marketplace, opens duties, applies, accepts offers and checks their schedule."""

    weight = 85
    wait_time = between(5, 15)
    accounts = AccountPool("doctors.csv")

    def on_start(self):
        super().on_start()
        self.seen = []        # duties from the last marketplace page
        self.applied = set()
        if not self.fb.token:
            return
        # App launch: onboarding gate and profile.
        self.fb.get("Doctor: app open (user)", f"users/{self.fb.uid}")
        self.fb.get("Doctor: profile", f"doctors/{self.fb.uid}")

    @task(10)
    def browse_marketplace(self):
        self.seen = self.fb.query("Doctor: marketplace",
                                  structured_query("duties", eq("status", "published"), "createdAt", 50))

    @task(4)
    def browse_by_specialty(self):
        where = and_(eq("status", "published"), eq("specialtyName", random.choice(SPECIALTIES)))
        self.seen = self.fb.query("Doctor: marketplace by specialty",
                                  structured_query("duties", where, "createdAt", 50)) or self.seen

    @task(5)
    def open_duty(self):
        if self.seen:
            self.fb.get("Doctor: open duty", f"duties/{random.choice(self.seen)['_id']}")

    @task(2)
    def apply(self):
        open_duties = [d for d in self.seen if d.get("remainingHeadcount", 0) > 0 and d["_id"] not in self.applied]
        if not open_duties:
            return
        duty_id = random.choice(open_duties)["_id"]
        self.applied.add(duty_id)
        self.fb.call("applyToDuty", {"dutyId": duty_id, "idempotencyKey": str(uuid.uuid4()),
                                     "note": "Available for this shift."},
                     "Doctor: applyToDuty", APPLY_EXPECTED)

    @task(4)
    def my_duties(self):
        assignments = self.fb.query("Doctor: my duties",
                                    structured_query("assignments", eq("doctorId", self.fb.uid), "updatedAt", 30))
        for offer in [a for a in assignments if a.get("status") == "selected"]:
            self.fb.call("confirmAssignment", {"assignmentId": offer["_id"], "idempotencyKey": str(uuid.uuid4())},
                         "Doctor: confirmAssignment", CONFIRM_EXPECTED)
        confirmed = [a for a in assignments if a.get("status") == "confirmed"]
        if confirmed and random.random() < 0.3:
            result = self.fb.call("getAssignmentContact", {"assignmentId": random.choice(confirmed)["_id"]},
                                  "Doctor: hospital contact")
            if result is not None and (result.get("contact") or {}).get("role") != "hospital":
                outcomes[("Doctor: hospital contact", "WRONG_CONTACT")] += 1
                log.error("Doctor %s got a non-hospital contact: %s", self.fb.uid, result)

    @task(4)
    def check_notifications(self):
        self.notifications("Doctor")

    @task(1)
    def view_profile(self):
        self.fb.get("Doctor: profile", f"doctors/{self.fb.uid}")


class HospitalUser(AppUser):
    """Watches the dashboard, reviews applicants and selects doctors, and posts new duties."""

    weight = 13
    wait_time = between(5, 20)
    accounts = AccountPool("hospitals.csv")

    def on_start(self):
        super().on_start()
        self.org = self.fb.account["organizationId"]
        self.facility = self.fb.account["facilityId"]
        self.duties = []
        if self.fb.token:
            self.fb.call("getMyOrganizations", {}, "Hospital: getMyOrganizations")

    @task(6)
    def dashboard(self):
        self.fb.call("getMyOrganizations", {}, "Hospital: getMyOrganizations")
        self.duties = self.fb.query("Hospital: own duties",
                                    structured_query("duties", eq("organizationId", self.org), "createdAt"))
        self.fb.query("Hospital: own assignments",
                      structured_query("assignments", eq("organizationId", self.org), "updatedAt"))

    @task(5)
    def review_applicants(self):
        open_duties = [d for d in self.duties if d.get("status") == "published" and d.get("remainingHeadcount", 0) > 0
                       and future((d.get("schedule") or {}).get("startAt", ""))]
        if not open_duties:
            return
        duty_id = random.choice(open_duties)["_id"]
        applicants = self.fb.query("Hospital: applicants",
                                   {"from": [{"collectionId": "applications"}],
                                    "where": in_("status", ["submitted", "shortlisted"])},
                                   parent=f"duties/{duty_id}")
        for app in applicants[:5]:
            if app.get("snapshotRef"):
                self.fb.get("Hospital: applicant credentials", f"applicationSnapshots/{app['snapshotRef']}")
        if applicants and random.random() < 0.5:
            doctor_id = random.choice(applicants).get("doctorId") or applicants[0]["_id"]
            self.fb.call("atomicSelectDoctor",
                         {"dutyId": duty_id, "doctorId": doctor_id, "idempotencyKey": str(uuid.uuid4())},
                         "Hospital: atomicSelectDoctor", SELECT_EXPECTED)

    @task(1)
    def post_duty(self):
        shift_type, start_hour, hours = random.choice(SHIFTS)
        day = datetime.now(timezone.utc).date() + timedelta(days=random.randint(3, 30))
        start = datetime(day.year, day.month, day.day, start_hour, tzinfo=timezone.utc)
        end = start + timedelta(hours=hours)
        specialty = random.choice(SPECIALTIES)
        created = self.fb.call("createDuty", {
            "organizationId": self.org,
            "facilityId": self.facility,
            "facilityName": "Ignored by server",
            "city": "Ignored by server",
            "department": "Casualty",
            "specialtyId": re.sub(r"[^a-z]+", "_", specialty.lower()),  # as the seed derives it
            "specialtyName": specialty,
            "qualificationRequired": "MBBS",
            "experienceMinYears": 0,
            "schedule": {"startAt": start.isoformat().replace("+00:00", ".000Z"),
                         "endAt": end.isoformat().replace("+00:00", ".000Z"), "shiftType": shift_type},
            "headcount": random.randint(1, 3),
            "paymentTerms": {"amount": random.choice([3000, 4000, 5000]), "currency": "INR",
                             "basis": "per_shift", "expectedPaymentTiming": "end_of_shift"},
        }, "Hospital: createDuty")
        if created:
            self.fb.call("publishDuty", {"dutyId": created["dutyId"]}, "Hospital: publishDuty")

    @task(2)
    def check_notifications(self):
        self.notifications("Hospital")


class AdminUser(AppUser):
    """Platform verifiers and support admins working their queues in the admin portal."""

    weight = 2
    wait_time = between(10, 30)
    accounts = AccountPool("admins.csv")

    @task(5)
    def verification_queue(self):
        self.fb.call("getVerificationQueue", {}, "Admin: getVerificationQueue")

    @task(3)
    def admin_queues(self):
        self.fb.call("getAdminQueues", {}, "Admin: getAdminQueues")
