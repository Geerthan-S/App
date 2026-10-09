"""
Generates the JMeter test plans in this folder from compact definitions.

    python build_plans.py

Edit this file rather than the .jmx output, then regenerate. The generated
plans still open and run normally in the JMeter GUI.

Plans:
  functional.jmx   one pass over the API: happy path, idempotency, security
  concurrency.jmx  double-booking races on one seat and on one doctor
  baseline.jmx     per-endpoint load at a configurable thread count
"""

import json
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

HERE = Path(__file__).parent

# --------------------------------------------------------------------------
# XML building blocks. Each element is (xml, children); a hashTree follows
# every element, holding its children.
# --------------------------------------------------------------------------


def el(tag, gui, testclass, name, props="", children=None, enabled=True):
    head = (f'<{tag} guiclass="{gui}" testclass="{testclass}" testname={quoteattr(name)} '
            f'enabled="{str(enabled).lower()}">')
    return (f"{head}{props}</{tag}>", children or [])


def s(name, value):
    return f'<stringProp name="{name}">{escape(str(value))}</stringProp>'


def b(name, value):
    return f'<boolProp name="{name}">{str(value).lower()}</boolProp>'


def render(node):
    xml, children = node
    return xml + "<hashTree>" + "".join(render(c) for c in children) + "</hashTree>"


def arguments(name, pairs):
    items = "".join(
        f'<elementProp name="{k}" elementType="Argument">{s("Argument.name", k)}{s("Argument.value", v)}'
        f'{s("Argument.metadata", "=")}</elementProp>'
        for k, v in pairs
    )
    return el("Arguments", "ArgumentsPanel", "Arguments", name,
              f'<collectionProp name="Arguments.arguments">{items}</collectionProp>')


def headers(name, pairs):
    items = "".join(
        f'<elementProp name="" elementType="Header">{s("Header.name", k)}{s("Header.value", v)}</elementProp>'
        for k, v in pairs
    )
    return el("HeaderManager", "HeaderPanel", "HeaderManager", name,
              f'<collectionProp name="HeaderManager.headers">{items}</collectionProp>')


def bearer(token_var):
    return headers("Auth header", [("Authorization", f"Bearer ${{{token_var}}}")])


def jsr223(kind, name, script="", filename="", parameters=""):
    gui = "TestBeanGUI"
    props = (s("scriptLanguage", "groovy") + s("parameters", parameters) + s("filename", filename)
             + s("cacheKey", "true") + s("script", script))
    return el(kind, gui, kind, name, props)


def expect(checks):
    return jsr223("JSR223Assertion", "Expect: " + checks, filename="lib/expect.groovy", parameters=checks)


def http(name, url, body=None, method="POST", children=None):
    body_props = ""
    if body is not None:
        text = body if isinstance(body, str) else json.dumps(body)
        body_props = (
            b("HTTPSampler.postBodyRaw", True)
            + '<elementProp name="HTTPsampler.Arguments" elementType="Arguments"><collectionProp name="Arguments.arguments">'
            + '<elementProp name="" elementType="HTTPArgument">'
            + b("HTTPArgument.always_encode", False) + s("Argument.value", text) + s("Argument.metadata", "=")
            + "</elementProp></collectionProp></elementProp>"
        )
    props = (s("HTTPSampler.domain", "") + s("HTTPSampler.port", "") + s("HTTPSampler.protocol", "")
             + s("HTTPSampler.path", url) + s("HTTPSampler.method", method)
             + b("HTTPSampler.follow_redirects", True) + b("HTTPSampler.use_keepalive", True)
             + s("HTTPSampler.connect_timeout", "15000") + s("HTTPSampler.response_timeout", "60000")
             + body_props)
    return el("HTTPSamplerProxy", "HttpTestSampleGui", "HTTPSamplerProxy", name, props, children)


def callable_(name, function, token_var, data, checks, extra=None):
    """A Cloud Functions callable request: POST {data: ...} with a bearer token."""
    children = ([bearer(token_var)] if token_var else []) + [expect(checks)] + (extra or [])
    return http(name, f"${{functions_url}}/{function}", {"data": data}, children=children)


def extract(var, path):
    props = (s("JSONPostProcessor.referenceNames", var) + s("JSONPostProcessor.jsonPathExprs", path)
             + s("JSONPostProcessor.match_numbers", "1") + s("JSONPostProcessor.defaultValues", "NOT_FOUND"))
    return el("JSONPostProcessor", "JSONPostProcessorGui", "JSONPostProcessor", f"Extract {var}", props)


def sign_in(name, prefix, checks="http=200"):
    """Firebase Auth email/password sign-in, storing the ID token in <prefix>_token."""
    body = {"email": f"${{{prefix}_email}}", "password": f"${{{prefix}_password}}", "returnSecureToken": True}
    return http(name, "${auth_url}/accounts:signInWithPassword?key=${api_key}", body,
                children=[expect(checks), extract(f"{prefix}_token", "$.idToken")])


def run_query(name, token_var, structured_query, checks):
    children = ([bearer(token_var)] if token_var else []) + [expect(checks)]
    return http(name, "${firestore_docs}:runQuery", {"structuredQuery": structured_query}, children=children)


def eq(field, value):
    return {"fieldFilter": {"field": {"fieldPath": field}, "op": "EQUAL", "value": {"stringValue": value}}}


def and_(*filters):
    return {"compositeFilter": {"op": "AND", "filters": list(filters)}}


def thread_group(name, children, threads="1", ramp="1", loops="1", duration=None, kind="ThreadGroup"):
    gui = {"ThreadGroup": "ThreadGroupGui", "SetupThreadGroup": "SetupThreadGroupGui",
           "PostThreadGroup": "PostThreadGroupGui"}[kind]
    loop = (f'<elementProp name="ThreadGroup.main_controller" elementType="LoopController" '
            f'guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">'
            f'{b("LoopController.continue_forever", False)}{s("LoopController.loops", loops)}</elementProp>')
    props = (s("ThreadGroup.on_sample_error", "continue") + loop + s("ThreadGroup.num_threads", threads)
             + s("ThreadGroup.ramp_time", ramp) + b("ThreadGroup.same_user_on_next_iteration", True)
             + b("ThreadGroup.scheduler", duration is not None)
             + s("ThreadGroup.duration", duration or "") + s("ThreadGroup.delay", ""))
    return el(kind, gui, kind, name, props, children)


def csv_data(name, file, prefix):
    columns = ",".join(f"{prefix}_{c}" for c in ["uid", "email", "password", "role", "organizationId", "facilityId"])
    props = (s("delimiter", ",") + s("fileEncoding", "UTF-8") + s("filename", f"${{data_dir}}/{file}")
             + b("ignoreFirstLine", True) + b("quotedData", False) + b("recycle", True)
             + s("shareMode", "shareMode.all") + b("stopThread", False) + s("variableNames", columns))
    return el("CSVDataSet", "TestBeanGUI", "CSVDataSet", name, props)


def once_only(name, children):
    return el("OnceOnlyController", "OnceOnlyControllerGui", "OnceOnlyController", name, "", children)


def sync_timer(name):
    # groupSize 0 = release when every thread in the group has arrived.
    props = '<intProp name="groupSize">0</intProp><longProp name="timeoutInMs">60000</longProp>'
    return el("SyncTimer", "TestBeanGUI", "SyncTimer", name, props)


def think_time():
    return el("ConstantTimer", "ConstantTimerGui", "ConstantTimer", "Think time",
              s("ConstantTimer.delay", "${__P(think_ms,0)}"))


def test_plan(name, comment, children):
    config = arguments("Endpoints (override with -J or -q cloud.properties)", [
        ("project", "${__P(project,demo-healthforce)}"),
        ("functions_url", "${__P(functions_url,http://127.0.0.1:5001/demo-healthforce/us-central1)}"),
        ("auth_url", "${__P(auth_url,http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1)}"),
        ("firestore_host", "${__P(firestore_host,http://127.0.0.1:8080)}"),
        ("api_key", "${__P(api_key,fake-api-key)}"),
        ("data_dir", "${__P(data_dir,../data)}"),
    ])
    # A variable cannot reference another from the same block, so derived URLs get their own.
    derived = arguments("Derived endpoints", [
        ("firestore_docs", "${firestore_host}/v1/projects/${project}/databases/(default)/documents"),
    ])
    json_header = headers("JSON content type", [("Content-Type", "application/json")])
    props = (s("TestPlan.comments", comment) + b("TestPlan.functional_mode", False)
             + b("TestPlan.serialize_threadgroups", True) + b("TestPlan.tearDown_on_shutdown", True)
             + '<elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" '
               'testclass="Arguments" testname="User Defined Variables" enabled="true">'
               '<collectionProp name="Arguments.arguments"/></elementProp>')
    plan = el("TestPlan", "TestPlanGui", "TestPlan", name, props, [config, derived, json_header] + children)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3"><hashTree>'
            + render(plan) + "</hashTree></jmeterTestPlan>\n")


def load_accounts(name, assignments):
    """Copies seeded accounts from perf/data into variables. Not recorded in results."""
    lines = ["def fb = evaluate(new File(org.apache.jmeter.services.FileServer.getFileServer().getBaseDir(), 'lib/firebase.groovy'))"]
    for prefix, (file, index) in assignments.items():
        lines += [
            f"def {prefix} = fb.csv('{file}')[{index}]",
            f"vars.put('{prefix}_uid', {prefix}.uid)",
            f"vars.put('{prefix}_email', {prefix}.email)",
            f"vars.put('{prefix}_password', {prefix}.password)",
            f"vars.put('{prefix}_org', {prefix}.organizationId)",
            f"vars.put('{prefix}_facility', {prefix}.facilityId)",
        ]
    lines.append("SampleResult.setIgnore()")
    return jsr223("JSR223Sampler", name, script="\n".join(lines))


# --------------------------------------------------------------------------
# Shared request bodies
# --------------------------------------------------------------------------

def duty_payload(org, facility, start_shift, end_shift, headcount=1):
    fmt = "yyyy-MM-dd'T'HH:00:00.000'Z'"
    return {
        "organizationId": f"${{{org}}}",
        "facilityId": f"${{{facility}}}",
        "facilityName": "Ignored by server",
        "city": "Ignored by server",
        "department": "Casualty",
        "specialtyId": "general_medicine",
        "specialtyName": "General Medicine",
        "qualificationRequired": "MBBS",
        "experienceMinYears": 0,
        "schedule": {
            "startAt": f"${{__timeShift({fmt},,{start_shift},,)}}",
            "endAt": f"${{__timeShift({fmt},,{end_shift},,)}}",
            "shiftType": "morning",
        },
        "headcount": headcount,
        "paymentTerms": {"amount": 4000, "currency": "INR", "basis": "per_shift", "expectedPaymentTiming": "end_of_shift"},
    }


MARKETPLACE_QUERY = {
    "from": [{"collectionId": "duties"}],
    "where": eq("status", "published"),
    "orderBy": [{"field": {"fieldPath": "createdAt"}, "direction": "DESCENDING"}],
    "limit": 50,
}

MARKETPLACE_BY_SPECIALTY = {
    "from": [{"collectionId": "duties"}],
    "where": and_(eq("status", "published"), eq("specialtyName", "Pediatrics")),
    "orderBy": [{"field": {"fieldPath": "createdAt"}, "direction": "DESCENDING"}],
    "limit": 50,
}


# --------------------------------------------------------------------------
# functional.jmx
# --------------------------------------------------------------------------

def functional_plan():
    accounts = load_accounts("Load seeded accounts", {
        "doctor": ("doctors.csv", 0),
        "doctor2": ("doctors.csv", 1),
        "hospital": ("hospitals.csv", 0),      # loadtest_org_001 owner
        "other": ("hospitals.csv", 2),         # loadtest_org_002 owner
        "admin": ("admins.csv", 0),
    })
    keys = arguments("Idempotency keys for this run", [
        ("apply_key", "${__UUID()}"),
        ("select_key", "${__UUID()}"),
        ("confirm_key", "${__UUID()}"),
    ])

    auth = [
        sign_in("Auth: sign in doctor", "doctor"),
        sign_in("Auth: sign in second doctor", "doctor2"),
        sign_in("Auth: sign in hospital staff", "hospital"),
        sign_in("Auth: sign in other hospital staff", "other"),
        sign_in("Auth: sign in platform admin", "admin"),
        http("Auth: wrong password is rejected", "${auth_url}/accounts:signInWithPassword?key=${api_key}",
             {"email": "${doctor_email}", "password": "wrong-password", "returnSecureToken": True},
             children=[expect("http=400")]),
    ]

    happy = [
        callable_("Hospital: getMyOrganizations", "getMyOrganizations", "hospital_token", {},
                  "ok result.organizations.0.organizationId=${hospital_org}"),
        callable_("Hospital: createDuty", "createDuty", "hospital_token",
                  duty_payload("hospital_org", "hospital_facility", "P45D", "P45DT6H"),
                  "ok", [extract("duty_id", "$.result.dutyId")]),
        callable_("Hospital: publishDuty", "publishDuty", "hospital_token", {"dutyId": "${duty_id}"},
                  "ok result.status=published"),
        run_query("Doctor: marketplace query (published duties)", "doctor_token", MARKETPLACE_QUERY,
                  "http=200 docs>=1"),
        run_query("Doctor: marketplace query by specialty", "doctor_token", MARKETPLACE_BY_SPECIALTY,
                  "http=200 docs>=1"),
        callable_("Doctor: applyToDuty", "applyToDuty", "doctor_token",
                  {"dutyId": "${duty_id}", "idempotencyKey": "${apply_key}"},
                  "ok result.status=submitted result.replayed=false"),
        callable_("Doctor: applyToDuty replay (same key) returns original", "applyToDuty", "doctor_token",
                  {"dutyId": "${duty_id}", "idempotencyKey": "${apply_key}"},
                  "ok result.replayed=true"),
        callable_("Doctor: applyToDuty again (new key) is rejected", "applyToDuty", "doctor_token",
                  {"dutyId": "${duty_id}", "idempotencyKey": "${__UUID()}"},
                  "error=APPLICATION_ALREADY_EXISTS http=409"),
        callable_("Hospital: shortlistApplication", "shortlistApplication", "hospital_token",
                  {"dutyId": "${duty_id}", "doctorId": "${doctor_uid}"},
                  "ok result.status=shortlisted"),
        callable_("Hospital: atomicSelectDoctor", "atomicSelectDoctor", "hospital_token",
                  {"dutyId": "${duty_id}", "doctorId": "${doctor_uid}", "idempotencyKey": "${select_key}"},
                  "ok result.replayed=false", [extract("assignment_id", "$.result.assignmentId")]),
        callable_("Hospital: atomicSelectDoctor replay returns same offer", "atomicSelectDoctor", "hospital_token",
                  {"dutyId": "${duty_id}", "doctorId": "${doctor_uid}", "idempotencyKey": "${select_key}"},
                  "ok result.replayed=true result.assignmentId=${assignment_id}"),
        callable_("Doctor: contact hidden before confirmation", "getAssignmentContact", "doctor_token",
                  {"assignmentId": "${assignment_id}"}, "error=PERMISSION_DENIED http=403"),
        callable_("Doctor: confirmAssignment", "confirmAssignment", "doctor_token",
                  {"assignmentId": "${assignment_id}", "idempotencyKey": "${confirm_key}"},
                  "ok result.status=confirmed result.replayed=false"),
        callable_("Doctor: confirmAssignment replay", "confirmAssignment", "doctor_token",
                  {"assignmentId": "${assignment_id}", "idempotencyKey": "${confirm_key}"},
                  "ok result.replayed=true"),
        callable_("Doctor: getAssignmentContact returns hospital", "getAssignmentContact", "doctor_token",
                  {"assignmentId": "${assignment_id}"}, "ok result.contact.role=hospital"),
        callable_("Hospital: getAssignmentContact returns doctor", "getAssignmentContact", "hospital_token",
                  {"assignmentId": "${assignment_id}"}, "ok result.contact.role=doctor"),
        callable_("Security: other hospital cannot read contact", "getAssignmentContact", "other_token",
                  {"assignmentId": "${assignment_id}"}, "error=PERMISSION_DENIED http=403"),
        callable_("Hospital: cancelAssignment", "cancelAssignment", "hospital_token",
                  {"assignmentId": "${assignment_id}", "reason": "LOAD_TEST_CANCEL"},
                  "ok result.status=cancelled"),
        http("Doctor: cancelled seat is released (duty read)", "${firestore_docs}/duties/${duty_id}", method="GET",
             children=[bearer("doctor_token"),
                       expect("http=200 fields.remainingHeadcount.integerValue=1 fields.status.stringValue=published")]),
        callable_("Admin: getAdminQueues", "getAdminQueues", "admin_token", {}, "ok"),
        callable_("Admin: getVerificationQueue", "getVerificationQueue", "admin_token", {}, "ok"),
    ]

    security = [
        callable_("Security: no token is rejected", "applyToDuty", None,
                  {"dutyId": "${duty_id}", "idempotencyKey": "${__UUID()}"}, "error=AUTH_REQUIRED http=401"),
        http("Security: forged token is rejected", "${functions_url}/applyToDuty",
             {"data": {"dutyId": "${duty_id}", "idempotencyKey": "${__UUID()}"}},
             children=[headers("Forged auth header", [("Authorization", "Bearer not-a-real-token")]),
                       expect("http=401")]),
        callable_("Security: doctor cannot open admin queues", "getAdminQueues", "doctor_token", {},
                  "error=PERMISSION_DENIED http=403"),
        callable_("Security: doctor cannot open verification queue", "getVerificationQueue", "doctor_token", {},
                  "error=PERMISSION_DENIED http=403"),
        callable_("Security: doctor cannot create a hospital duty", "createDuty", "doctor_token",
                  duty_payload("hospital_org", "hospital_facility", "P46D", "P46DT6H"),
                  "error=PERMISSION_DENIED http=403"),
        callable_("Security: other hospital cannot shortlist", "shortlistApplication", "other_token",
                  {"dutyId": "${duty_id}", "doctorId": "${doctor_uid}"}, "error=PERMISSION_DENIED http=403"),
        callable_("Security: other hospital cannot publish", "publishDuty", "other_token",
                  {"dutyId": "${duty_id}"}, "error=PERMISSION_DENIED http=403"),
        callable_("Security: hospital cannot grant itself super admin", "setCustomClaims", "hospital_token",
                  {"targetUid": "${hospital_uid}", "claims": {"isSuperAdmin": True}},
                  "error=PERMISSION_DENIED http=403"),
        callable_("Security: second doctor cannot confirm another's offer", "confirmAssignment", "doctor2_token",
                  {"assignmentId": "${assignment_id}", "idempotencyKey": "${__UUID()}"},
                  "error=PERMISSION_DENIED http=403"),
        http("Security: doctor cannot edit a duty directly in Firestore",
             "${firestore_docs}/duties/${duty_id}?updateMask.fieldPaths=status",
             {"fields": {"status": {"stringValue": "cancelled"}}}, method="PATCH",
             children=[bearer("doctor_token"), expect("http=403")]),
        http("Security: doctor cannot read another user's profile", "${firestore_docs}/users/${doctor2_uid}",
             method="GET", children=[bearer("doctor_token"), expect("http=403")]),
        run_query("Security: signed-out marketplace query is rejected", None, MARKETPLACE_QUERY, "http=403"),
    ]

    validation = [
        callable_("Validation: malformed duty ID", "applyToDuty", "doctor_token",
                  {"dutyId": "../../users/x", "idempotencyKey": "${__UUID()}"}, "error=VALIDATION_FAILED http=400"),
        callable_("Validation: idempotency key too short", "applyToDuty", "doctor_token",
                  {"dutyId": "${duty_id}", "idempotencyKey": "abc"}, "error=VALIDATION_FAILED http=400"),
        callable_("Validation: duty in the past", "createDuty", "hospital_token",
                  duty_payload("hospital_org", "hospital_facility", "-P1D", "-P1DT-6H"),
                  "error=VALIDATION_FAILED http=400"),
        callable_("Validation: shift longer than 24 hours", "createDuty", "hospital_token",
                  duty_payload("hospital_org", "hospital_facility", "P47D", "P48DT6H"),
                  "error=VALIDATION_FAILED http=400"),
        callable_("Validation: applying to a missing duty", "applyToDuty", "doctor_token",
                  {"dutyId": "loadtest_missing_duty", "idempotencyKey": "${__UUID()}"},
                  "error=INVALID_STATE_TRANSITION http=400"),
    ]

    group = thread_group("Functional pass (1 user, runs once)", [accounts, keys] + auth + happy + security + validation)
    return test_plan("Functional API checks",
                     "One pass over the API: sign-in, duty lifecycle, idempotency replays, "
                     "authorization and validation. Every sample must pass.",
                     [group])


# --------------------------------------------------------------------------
# concurrency.jmx
# --------------------------------------------------------------------------

def concurrency_plan():
    setup = thread_group("Prepare race fixtures", [
        jsr223("JSR223Sampler", "Create duties, applications and tokens", filename="lib/race_setup.groovy"),
    ], kind="SetupThreadGroup")

    def race(name, prefix, checks):
        pick = jsr223("JSR223PreProcessor", "Pick this thread's contender", filename="lib/race_pick.groovy",
                      parameters=prefix)
        tally = jsr223("JSR223Assertion", "Tally outcome", filename="lib/race_tally.groovy", parameters=prefix)
        select = callable_(f"{name}: atomicSelectDoctor", "atomicSelectDoctor", "race_token",
                           {"dutyId": "${race_duty}", "doctorId": "${race_doctor}", "idempotencyKey": "${__UUID()}"},
                           checks, [pick, sync_timer("Release all threads at once"), tally])
        return thread_group(name, [select], threads=f"${{__P({prefix}_threads,{30 if prefix == 'seat' else 20})}}",
                            ramp="0")

    seat = race("Race 1: many hospitals' picks for ONE seat", "seat",
                "allow=OK,DUTY_CAPACITY_FILLED,INVALID_STATE_TRANSITION")
    doctor = race("Race 2: many hospitals select ONE doctor for overlapping shifts", "doctor",
                  "allow=OK,ASSIGNMENT_CONFLICT")

    verify = thread_group("Verify: no double booking", [
        jsr223("JSR223Sampler", "Verify race 1: one seat, one assignment", filename="lib/race_verify.groovy",
               parameters="seat"),
        jsr223("JSR223Sampler", "Verify race 2: one doctor, one assignment", filename="lib/race_verify.groovy",
               parameters="doctor"),
    ], kind="PostThreadGroup")

    return test_plan("Double-booking concurrency",
                     "Race 1: N selections fire at the same instant for a duty with one seat. "
                     "Race 2: N hospitals select the same doctor for overlapping shifts at the same instant. "
                     "Each race must produce exactly one assignment.",
                     [setup, seat, doctor, verify])


# --------------------------------------------------------------------------
# baseline.jmx
# --------------------------------------------------------------------------

def baseline_plan():
    threads, ramp, duration = "${__P(threads,10)}", "${__P(rampup,10)}", "${__P(duration,60)}"

    def remember(prefix):
        script = (f"vars.put('my_token', vars.get('{prefix}_token'))\n"
                  f"vars.put('my_org', vars.get('{prefix}_organizationId'))")
        return jsr223("JSR223PostProcessor", "Remember this thread's account", script=script)

    def login(prefix):
        signin = sign_in("Sign in", prefix)
        signin[1].append(remember(prefix))
        return once_only("Sign in once per thread", [signin])

    doctor_browse = thread_group("Doctor: browse marketplace", [
        csv_data("Doctor accounts", "doctors.csv", "d"), login("d"), think_time(),
        run_query("Doctor: marketplace query", "my_token", MARKETPLACE_QUERY, "http=200 docs>=1"),
        run_query("Doctor: marketplace query by specialty", "my_token", MARKETPLACE_BY_SPECIALTY, "http=200"),
    ], threads=threads, ramp=ramp, loops="-1", duration=duration)

    duty_csv = el("CSVDataSet", "TestBeanGUI", "CSVDataSet", "Duties",
                  s("delimiter", ",") + s("fileEncoding", "UTF-8") + s("filename", "${data_dir}/duties.csv")
                  + b("ignoreFirstLine", True) + b("quotedData", False) + b("recycle", True)
                  + s("shareMode", "shareMode.all") + b("stopThread", False)
                  + s("variableNames", "duty_id,duty_org,duty_facility,duty_specialty,duty_city,duty_start,duty_end,duty_headcount"))
    doctor_apply = thread_group("Doctor: apply to duty", [
        csv_data("Doctor accounts", "doctors.csv", "a"), duty_csv, login("a"), think_time(),
        callable_("Doctor: applyToDuty", "applyToDuty", "my_token",
                  {"dutyId": "${duty_id}", "idempotencyKey": "${__UUID()}"},
                  "allow=OK,APPLICATION_ALREADY_EXISTS,DUTY_CAPACITY_FILLED,INVALID_STATE_TRANSITION"),
    ], threads=threads, ramp=ramp, loops="-1", duration=duration)

    org_duties = {
        "from": [{"collectionId": "duties"}],
        "where": eq("organizationId", "${my_org}"),
        "orderBy": [{"field": {"fieldPath": "createdAt"}, "direction": "DESCENDING"}],
    }
    org_assignments = {
        "from": [{"collectionId": "assignments"}],
        "where": eq("organizationId", "${my_org}"),
        "orderBy": [{"field": {"fieldPath": "updatedAt"}, "direction": "DESCENDING"}],
    }
    hospital = thread_group("Hospital: dashboard", [
        csv_data("Hospital accounts", "hospitals.csv", "h"), login("h"), think_time(),
        callable_("Hospital: getMyOrganizations", "getMyOrganizations", "my_token", {}, "ok"),
        run_query("Hospital: own duties query", "my_token", org_duties, "http=200 docs>=1"),
        run_query("Hospital: own assignments query", "my_token", org_assignments, "http=200"),
    ], threads=threads, ramp=ramp, loops="-1", duration=duration)

    admin = thread_group("Admin: work queues", [
        csv_data("Admin accounts", "admins.csv", "m"), login("m"), think_time(),
        callable_("Admin: getAdminQueues", "getAdminQueues", "my_token", {}, "ok"),
        callable_("Admin: getVerificationQueue", "getVerificationQueue", "my_token", {}, "ok"),
    ], threads=threads, ramp=ramp, loops="-1", duration=duration)

    return test_plan("Per-endpoint baseline",
                     "Each thread group hammers one area for -Jduration seconds with -Jthreads users, "
                     "one group after another. Run at 1, 10 and 50 threads to see how latency grows.",
                     [doctor_browse, doctor_apply, hospital, admin])


if __name__ == "__main__":
    for filename, build in [("functional.jmx", functional_plan),
                            ("concurrency.jmx", concurrency_plan),
                            ("baseline.jmx", baseline_plan)]:
        (HERE / filename).write_text(build(), encoding="utf-8")
        print(f"wrote {filename}")
