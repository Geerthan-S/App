/*
 * JSR223 Sampler run after both races. Passes only if the race produced
 * exactly one successful selection AND the database holds exactly one live
 * assignment for it. Parameters: the race name (seat|doctor).
 */

import org.apache.jmeter.services.FileServer

String race = Parameters.trim()
def fb = evaluate(new File(FileServer.getFileServer().getBaseDir(), 'lib/firebase.groovy'))
Map outcomes = props.get(race + '_outcomes') ?: [:]
int wins = outcomes['OK'] ?: 0
def problems = []
def report = new StringBuilder("Outcomes: ${new TreeMap(outcomes)}\n")

if (race == 'seat') {
    String token = props.get('seat_verify_token')
    String dutyId = props.get('seat_duties')[0]
    def live = fb.query('assignments', [organizationId: props.get('seat_org'), dutyId: dutyId], token)
        .findAll { it.status in ['selected', 'confirmed'] }
    def duty = fb.getDoc('duties/' + dutyId, token)
    report << "Live assignments for ${dutyId}: ${live.size()}\n"
    report << "Duty remainingHeadcount=${duty.remainingHeadcount} status=${duty.status}\n"
    if (live.size() != 1) problems << "expected 1 live assignment, found ${live.size()}"
    if (duty.remainingHeadcount != 0) problems << "expected remainingHeadcount 0, found ${duty.remainingHeadcount}"
    if (duty.status != 'filled') problems << "expected duty status filled, found ${duty.status}"
} else {
    String token = props.get('doctor_verify_token')
    Set duties = props.get('doctor_duties') as Set
    def live = fb.query('assignments', [doctorId: props.get('doctor_uid')], token)
        .findAll { it.dutyId in duties && it.status in ['selected', 'confirmed'] }
    report << "Live assignments for ${props.get('doctor_uid')} across the ${duties.size()} overlapping duties: ${live.size()}\n"
    if (live.size() != 1) problems << "expected 1 live assignment, found ${live.size()}"
}

if (wins != 1) problems << "expected exactly 1 successful selection, got ${wins}"
def unexpected = outcomes.keySet() - ['OK', 'DUTY_CAPACITY_FILLED', 'INVALID_STATE_TRANSITION', 'ASSIGNMENT_CONFLICT']
if (unexpected) report << "Unexpected loser outcomes (not double booking, but users saw an error): ${unexpected}\n"

report << (problems ? "FAIL: ${problems.join('; ')}\n" : "PASS: no double booking\n")
SampleResult.setResponseData(report.toString(), 'UTF-8')
SampleResult.setSuccessful(problems.isEmpty())
SampleResult.setResponseMessage(problems ? problems.join('; ') : 'no double booking')
log.info("[${race} race] " + report.toString().replace('\n', ' | '))
