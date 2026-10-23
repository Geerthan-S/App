/*
 * Builds the fixtures for concurrency.jmx before the races start.
 *
 * Race "seat":   one hospital publishes a duty with ONE seat; N doctors apply.
 *                N threads then select a different doctor each, simultaneously.
 * Race "doctor": M hospitals each publish a duty for the SAME shift; one doctor
 *                applies to all of them. M threads then select that doctor,
 *                simultaneously, each for its own duty.
 *
 * Shift times get a random offset so a re-run on the same seed does not
 * collide with the previous run's assignments.
 */

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.ConcurrentHashMap
import org.apache.jmeter.services.FileServer

def fb = evaluate(new File(FileServer.getFileServer().getBaseDir(), 'lib/firebase.groovy'))
def doctors = fb.csv('doctors.csv')
def hospitals = fb.csv('hospitals.csv').findAll { it.uid.endsWith('_1') }   // one owner per organization

int seatThreads = (props.getProperty('seat_threads') ?: '30') as int
int doctorThreads = (props.getProperty('doctor_threads') ?: '20') as int
def random = new Random()

def shift = { int baseDays ->
    def start = Instant.now().truncatedTo(ChronoUnit.HOURS)
        .plus(baseDays, ChronoUnit.DAYS).plus(random.nextInt(24 * 200), ChronoUnit.HOURS)
    [start.toString(), start.plus(6, ChronoUnit.HOURS).toString()]
}

def dutyPayload = { Map hospital, List<String> times, int headcount ->
    [organizationId: hospital.organizationId, facilityId: hospital.facilityId,
     facilityName: 'x', city: 'x', department: 'Casualty',
     specialtyId: 'general_medicine', specialtyName: 'General Medicine',
     qualificationRequired: 'MBBS', experienceMinYears: 0,
     schedule: [startAt: times[0], endAt: times[1], shiftType: 'morning'],
     headcount: headcount,
     paymentTerms: [amount: 4000, currency: 'INR', basis: 'per_shift', expectedPaymentTiming: 'end_of_shift']]
}

def publish = { Map hospital, String token, List<String> times, int headcount ->
    def dutyId = fb.call('createDuty', token, dutyPayload(hospital, times, headcount)).dutyId
    fb.call('publishDuty', token, [dutyId: dutyId])
    dutyId
}

def apply = { String token, String dutyId ->
    fb.call('applyToDuty', token, [dutyId: dutyId, idempotencyKey: UUID.randomUUID().toString()])
}

def log = new StringBuilder()

// ---- Race "seat" ---------------------------------------------------------
if (doctors.size() < 700 + seatThreads) throw new IllegalStateException('Not enough seeded doctors for seat race')
def seatHospital = hospitals[9]
def seatHospitalToken = fb.signIn(seatHospital.email, seatHospital.password)
def seatDuty = publish(seatHospital, seatHospitalToken, shift(40), 1)
def seatDoctors = doctors.subList(700, 700 + seatThreads)
seatDoctors.each { d -> apply(fb.signIn(d.email, d.password), seatDuty) }
props.put('seat_tokens', [seatHospitalToken] * seatThreads)
props.put('seat_duties', [seatDuty] * seatThreads)
props.put('seat_doctors', seatDoctors*.uid)
props.put('seat_org', seatHospital.organizationId)
props.put('seat_verify_token', seatHospitalToken)
props.put('seat_outcomes', new ConcurrentHashMap())
log << "Seat race: duty ${seatDuty} (1 seat) at ${seatHospital.organizationId}, ${seatThreads} applicants\n"

// ---- Race "doctor" -------------------------------------------------------
if (hospitals.size() < 20 + doctorThreads) throw new IllegalStateException('Not enough seeded hospitals for doctor race')
def contested = doctors[849]
def contestedToken = fb.signIn(contested.email, contested.password)
def times = shift(40)
def doctorTokens = []
def doctorDuties = []
hospitals.subList(20, 20 + doctorThreads).each { h ->
    def token = fb.signIn(h.email, h.password)
    def dutyId = publish(h, token, times, 2)
    apply(contestedToken, dutyId)
    doctorTokens << token
    doctorDuties << dutyId
}
props.put('doctor_tokens', doctorTokens)
props.put('doctor_duties', doctorDuties)
props.put('doctor_doctors', [contested.uid] * doctorThreads)
props.put('doctor_uid', contested.uid)
props.put('doctor_verify_token', contestedToken)
props.put('doctor_outcomes', new ConcurrentHashMap())
log << "Doctor race: ${contested.uid} applied to ${doctorThreads} duties at ${times[0]}\n"

SampleResult.setResponseData(log.toString(), 'UTF-8')
