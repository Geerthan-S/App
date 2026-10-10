"""
Firebase REST helpers for the Locust users: endpoints per target, seeded
account pools, sign-in with token refresh, callable requests, Firestore REST
reads and a tally of business outcomes.

Requests go over the same public REST surfaces the Flutter SDKs use, so the
backend sees the same authentication, security rules and function code.
"""

import csv
import itertools
import json
import logging
import time
from collections import Counter
from pathlib import Path

from locust.exception import RescheduleTask

PERF = Path(__file__).resolve().parent.parent
REPO = PERF.parent
DATA = PERF / "data"

EMULATOR_PROJECT = "demo-healthforce"
CLOUD_PROJECT = "doctor-c7c29"
FUNCTIONS_REGION = "asia-south1"  # setGlobalOptions in functions/src/index.ts

# ID tokens live for an hour; refresh well before that so a soak run never sends an expired one.
TOKEN_REFRESH_AFTER_S = 50 * 60

log = logging.getLogger("healthforce")


def endpoints(target, confirm):
    """Base URLs for the chosen backend. The cloud project must be confirmed by name."""
    if target == "emulator":
        project, key = EMULATOR_PROJECT, "fake-api-key"
        return {
            "project": project,
            "functions": f"http://127.0.0.1:5001/{project}/{FUNCTIONS_REGION}",
            "sign_in": f"http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={key}",
            "refresh": f"http://127.0.0.1:9099/securetoken.googleapis.com/v1/token?key={key}",
            "documents": f"http://127.0.0.1:8080/v1/projects/{project}/databases/(default)/documents",
        }
    if target == "cloud":
        if confirm != CLOUD_PROJECT:
            raise SystemExit(f"Cloud mode loads the real project. Re-run with: --target cloud --confirm {CLOUD_PROJECT}")
        services = json.loads((REPO / "google-services.json").read_text(encoding="utf-8"))
        key = services["client"][0]["api_key"][0]["current_key"]
        project = CLOUD_PROJECT
        return {
            "project": project,
            "functions": f"https://{FUNCTIONS_REGION}-{project}.cloudfunctions.net",
            "sign_in": f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={key}",
            "refresh": f"https://securetoken.googleapis.com/v1/token?key={key}",
            "documents": f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents",
        }
    raise SystemExit(f'Unknown --target "{target}". Use "emulator" or "cloud".')


def read_csv(name):
    path = DATA / name
    if not path.exists():
        raise SystemExit(f"{path} not found. Seed the target first: npm run seed (in perf/)")
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


class AccountPool:
    """Hands each simulated user its own seeded account, wrapping around (with a warning) if users outnumber accounts."""

    def __init__(self, filename):
        self.filename = filename
        self.accounts = read_csv(filename)
        self._next = itertools.cycle(self.accounts)
        self._handed_out = 0

    def take(self):
        self._handed_out += 1
        if self._handed_out == len(self.accounts) + 1:
            log.warning("More users than accounts in %s (%d); accounts are now shared", self.filename, len(self.accounts))
        return next(self._next)


# --------------------------------------------------------------------------
# Business outcomes: OK or the domain error code, per request name. Expected
# losing outcomes (e.g. DUTY_CAPACITY_FILLED) count as successes in Locust's
# stats; this tally shows how often each one happened.
# --------------------------------------------------------------------------

outcomes = Counter()


def write_outcomes(path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["request", "outcome", "count"])
        for (name, outcome), count in sorted(outcomes.items()):
            writer.writerow([name, outcome, count])


# --------------------------------------------------------------------------
# Firestore REST: query builders and value decoding
# --------------------------------------------------------------------------

def _value(v):
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, (list, tuple)):
        return {"arrayValue": {"values": [_value(x) for x in v]}}
    return {"stringValue": v}


def eq(field, value):
    return {"fieldFilter": {"field": {"fieldPath": field}, "op": "EQUAL", "value": _value(value)}}


def in_(field, values):
    return {"fieldFilter": {"field": {"fieldPath": field}, "op": "IN", "value": _value(values)}}


def and_(*filters):
    return {"compositeFilter": {"op": "AND", "filters": list(filters)}}


def structured_query(collection, where, order_by=None, limit=None):
    query = {"from": [{"collectionId": collection}], "where": where}
    if order_by:
        query["orderBy"] = [{"field": {"fieldPath": order_by}, "direction": "DESCENDING"}]
    if limit:
        query["limit"] = limit
    return query


def decode(value):
    """Turns a Firestore REST typed value into plain Python."""
    kind, inner = next(iter(value.items()))
    if kind == "integerValue":
        return int(inner)
    if kind == "mapValue":
        return {k: decode(v) for k, v in inner.get("fields", {}).items()}
    if kind == "arrayValue":
        return [decode(v) for v in inner.get("values", [])]
    if kind == "nullValue":
        return None
    return inner  # string, boolean, double, timestamp (RFC 3339 string), reference


def decode_document(doc):
    data = {k: decode(v) for k, v in doc.get("fields", {}).items()}
    data["_id"] = doc["name"].rsplit("/", 1)[-1]
    return data


def _status(response):
    """HTTP status, or the connection error when no response arrived (status 0)."""
    error = getattr(response, "error", None)
    return f"HTTP {response.status_code} {type(error).__name__}: {error}"[:200] if not response.status_code and error         else f"HTTP {response.status_code}"


def _json(response):
    try:
        return response.json()
    except Exception:  # noqa: BLE001 - empty or non-JSON body (e.g. connection error)
        return None


class FirebaseSession:
    """One signed-in app user: holds the ID token and makes authenticated requests through the Locust client."""

    def __init__(self, client, urls, account):
        self.client = client
        self.urls = urls
        self.account = account
        self.uid = account["uid"]
        self.token = None
        self.refresh_token = None
        self.token_at = 0.0

    # ---- auth ------------------------------------------------------------

    def sign_in(self):
        body = {"email": self.account["email"], "password": self.account["password"], "returnSecureToken": True}
        with self.client.post(self.urls["sign_in"], json=body, name="Auth: sign in", catch_response=True) as r:
            data = _json(r)
            if r.status_code != 200 or not data or "idToken" not in data:
                r.failure(_status(r))
                return False
            self.token, self.refresh_token, self.token_at = data["idToken"], data["refreshToken"], time.monotonic()
            return True

    def _refresh(self):
        body = f"grant_type=refresh_token&refresh_token={self.refresh_token}"
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        with self.client.post(self.urls["refresh"], data=body, headers=headers, name="Auth: refresh token",
                              catch_response=True) as r:
            data = _json(r)
            if r.status_code != 200 or not data or "id_token" not in data:
                r.failure(_status(r))
                return False
            self.token, self.refresh_token, self.token_at = data["id_token"], data["refresh_token"], time.monotonic()
            return True

    def _headers(self):
        if self.token and time.monotonic() - self.token_at > TOKEN_REFRESH_AFTER_S and not self._refresh():
            self.token = None
        if not self.token and not self.sign_in():
            raise RescheduleTask()  # cannot act while signed out; try again on the next task
        return {"Authorization": f"Bearer {self.token}"}

    # ---- Cloud Functions callables ------------------------------------------

    def call(self, function, data, name, expected=()):
        """
        Calls an onCall function. Returns the result on success, None otherwise.
        Domain error codes listed in `expected` are normal business outcomes and
        count as successes; anything else is a failure.
        """
        with self.client.post(f"{self.urls['functions']}/{function}", json={"data": data}, headers=self._headers(),
                              name=name, catch_response=True) as r:
            body = _json(r) or {}
            if r.status_code == 200 and "result" in body:
                outcomes[(name, "OK")] += 1
                r.success()
                return body["result"]
            error = body.get("error") or {}
            code = (error.get("details") or {}).get("code") or error.get("status") or f"HTTP_{r.status_code}"
            outcomes[(name, code)] += 1
            if code in expected:
                r.success()
            else:
                r.failure(f"HTTP {r.status_code} {code}: {error.get('message', '')}"[:200] if r.status_code else _status(r))
            return None

    # ---- Firestore REST reads ----------------------------------------------

    def query(self, name, query, parent=""):
        """Runs a structured query (under `parent`, e.g. 'duties/abc', for subcollections). Returns decoded documents."""
        url = f"{self.urls['documents']}{'/' + parent if parent else ''}:runQuery"
        with self.client.post(url, json={"structuredQuery": query}, headers=self._headers(), name=name,
                              catch_response=True) as r:
            body = _json(r)
            if r.status_code != 200 or not isinstance(body, list):
                message = body[0].get("error", {}).get("message", "") if isinstance(body, list) and body else ""
                r.failure(f"HTTP {r.status_code} {message}"[:200] if r.status_code else _status(r))
                return []
            return [decode_document(row["document"]) for row in body if "document" in row]

    def get(self, name, path):
        """Reads one document. Returns it decoded, or None if it is missing or the read failed."""
        with self.client.get(f"{self.urls['documents']}/{path}", headers=self._headers(), name=name,
                             catch_response=True) as r:
            body = _json(r)
            if r.status_code != 200 or not body:
                r.failure(_status(r))
                return None
            return decode_document(body)
