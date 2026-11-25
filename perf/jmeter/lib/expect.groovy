/*
 * Response checks for every HTTP sampler, used as a JSR223 Assertion.
 * The assertion's Parameters field lists the checks, separated by spaces:
 *
 *   ok                       HTTP 200 with a callable `result` body
 *   error=CODE               callable failed with this domain code
 *                            (error.details.code, else error.status)
 *   allow=OK,CODE,...        any of these outcomes is acceptable (load tests)
 *   http=403                 HTTP status code
 *   docs>=1                  Firestore runQuery returned at least N documents
 *   some.json.path=value     value at a dotted JSON path (list indexes allowed)
 *   some.json.path>=number   numeric comparison
 *
 * Expected error responses (4xx) count as successful samples; anything that
 * does not match fails the sample with the reason in the assertion message.
 */

import groovy.json.JsonSlurper

String status = SampleResult.getResponseCode()
def body = null
try {
    String text = SampleResult.getResponseDataAsString()
    body = text ? new JsonSlurper().parseText(text) : null
} catch (ignored) {
    // Non-JSON responses (HTML error pages, timeouts) fail the checks below.
}

def outcome = null
if (body instanceof Map && body.error instanceof Map) {
    outcome = body.error.details?.code ?: body.error.status
} else if (body instanceof Map && body.containsKey('result')) {
    outcome = 'OK'
}

def valueAt = { Object root, String path ->
    path.split('\\.').inject(root) { node, key ->
        if (node instanceof List) return key.isInteger() && (key as int) < node.size() ? node[key as int] : null
        if (node instanceof Map) return node[key]
        return null
    }
}

List<String> checks = (Parameters ?: '').trim().split(/\s+/).findAll { it } as List
List<String> problems = []

checks.each { String check ->
    if (check == 'ok') {
        if (outcome != 'OK') problems << "expected success, got HTTP ${status} ${outcome ?: SampleResult.getResponseMessage()}"
        return
    }
    if (check.startsWith('error=')) {
        String expected = check.substring(6)
        if (outcome != expected) problems << "expected error ${expected}, got HTTP ${status} ${outcome}"
        return
    }
    if (check.startsWith('allow=')) {
        List<String> allowed = check.substring(6).split(',') as List
        if (!(outcome in allowed)) problems << "outcome ${outcome} (HTTP ${status}) not in ${allowed}"
        return
    }
    def match = check =~ /^([^=<>]+)(>=|=)(.*)$/
    if (!match.matches()) {
        problems << "unreadable check '${check}'"
        return
    }
    String key = match.group(1)
    String op = match.group(2)
    String expected = match.group(3)
    def actual
    if (key == 'http') actual = status
    else if (key == 'docs') actual = body instanceof List ? body.count { it instanceof Map && it.document } : 0
    else actual = valueAt(body, key)

    if (op == '=' && String.valueOf(actual) != expected) {
        problems << "${key}: expected ${expected}, got ${actual}"
    }
    if (op == '>=') {
        boolean numeric = actual != null && String.valueOf(actual).isBigDecimal()
        if (!numeric || new BigDecimal(String.valueOf(actual)) < new BigDecimal(expected)) {
            problems << "${key}: expected >= ${expected}, got ${actual}"
        }
    }
}

// Store the outcome so post-processors (race tallies) can read it.
vars.put('last_outcome', String.valueOf(outcome))

SampleResult.setSuccessful(problems.isEmpty())
if (problems) {
    AssertionResult.setFailure(true)
    AssertionResult.setFailureMessage(problems.join('; '))
}
