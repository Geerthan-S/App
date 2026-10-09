/**
 * Seeds the users and marketplace data JMeter and Locust act on, then writes
 * the credentials and duty list they read to perf/data/*.csv.
 *
 * Every Auth UID and seeded document ID starts with `loadtest_` so cleanup.mjs
 * can remove exactly this data. Seeding always clears earlier load-test data
 * first, so each run starts from the same state.
 *
 *   node seed/seed.mjs                                     (emulator)
 *   node seed/seed.mjs --target cloud --confirm doctor-c7c29
 *
 * Documents mirror what the production callables write (doctor profile,
 * approved organization with an owner membership, active facility, published
 * duty), so the load test exercises real handler paths and security rules.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { PREFIX, resolveTarget, db, auth, pool } from './target.mjs';
import { cleanup } from './cleanup.mjs';

const COUNTS = {
  doctors: 900,
  organizations: 75,
  staffPerOrganization: 2,
  platformAdmins: 25,
  dutiesPerOrganization: 8,
};

/** Must equal PLATFORM_DEFAULTS.CURRENT_CONSENT_VERSION in functions/src/shared/platformConfig.ts. */
const CONSENT_VERSION = 'v1.0_2026';
const COUNCIL = 'LOADTEST Council';
const EMAIL_DOMAIN = 'loadtest.invalid';

const SPECIALTIES = ['General Medicine', 'Emergency Medicine', 'Pediatrics', 'Anaesthesiology', 'General Surgery', 'Obstetrics & Gynaecology'];
const CITIES = ['Chennai', 'Bengaluru', 'Hyderabad', 'Mumbai', 'Delhi'];
const SHIFTS = [
  { shiftType: 'morning', startHour: 8, hours: 6 },
  { shiftType: 'evening', startHour: 14, hours: 6 },
  { shiftType: 'night', startHour: 20, hours: 10 },
  { shiftType: 'full_day', startHour: 9, hours: 12 },
];

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const pad = (n, width) => String(n).padStart(width, '0');
const pick = (list, i) => list[i % list.length];

/** Same algorithm as functions/src/doctors/doctorFunctions.ts so profile edits behave normally. */
const credentialFingerprint = (p) => createHash('sha256').update(JSON.stringify({
  fullName: p.fullName.trim(),
  council: p.council.trim(),
  registrationNoNorm: p.registrationNoNorm,
  qualification: p.qualification.trim(),
  primarySpecialty: p.primarySpecialty.trim(),
  specialties: [...p.specialties].sort(),
  yearsOfExperience: p.yearsOfExperience,
})).digest('hex');

/** Same rule as normalizeRegistrationNo in functions/src/shared/firestoreHelpers.ts. */
const normalizeRegistrationNo = (council, regNo) =>
  `${council.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${regNo.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')}`;

const buildPlan = () => {
  const users = [];
  const doctors = [];
  const organizations = [];
  const duties = [];

  for (let i = 1; i <= COUNTS.doctors; i++) {
    const uid = `${PREFIX}doc_${pad(i, 4)}`;
    const primarySpecialty = pick(SPECIALTIES, i);
    const registrationNo = `LT${pad(i, 6)}`;
    const profile = {
      fullName: `Loadtest Doctor ${pad(i, 4)}`,
      council: COUNCIL,
      registrationNo,
      registrationNoNorm: normalizeRegistrationNo(COUNCIL, registrationNo),
      qualification: 'MBBS',
      specialties: [primarySpecialty],
      primarySpecialty,
      yearsOfExperience: 2 + (i % 19),
      preferredCities: [pick(CITIES, i)],
    };
    users.push({ uid, role: 'doctor', displayName: profile.fullName, organizationId: '', facilityId: '' });
    doctors.push({ uid, profile });
  }

  for (let o = 1; o <= COUNTS.organizations; o++) {
    const organizationId = `${PREFIX}org_${pad(o, 3)}`;
    const facilityId = `${PREFIX}fac_${pad(o, 3)}`;
    const city = pick(CITIES, o);
    const staff = [];
    for (let s = 1; s <= COUNTS.staffPerOrganization; s++) {
      const uid = `${PREFIX}hosp_${pad(o, 3)}_${s}`;
      staff.push({ uid, role: s === 1 ? 'owner' : 'admin' });
      users.push({ uid, role: 'hospital', displayName: `Loadtest Coordinator ${pad(o, 3)}-${s}`, organizationId, facilityId });
    }
    organizations.push({ organizationId, facilityId, city, staff, name: `Loadtest Hospital ${pad(o, 3)}` });

    for (let d = 1; d <= COUNTS.dutiesPerOrganization; d++) {
      const shift = pick(SHIFTS, o + d);
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 3 + ((o * 7 + d * 3) % 28));
      start.setUTCHours(shift.startHour, 0, 0, 0);
      const end = new Date(start.getTime() + shift.hours * 60 * 60 * 1000);
      duties.push({
        dutyId: `${PREFIX}duty_${pad(o, 3)}_${pad(d, 2)}`,
        organizationId,
        facilityId,
        facilityName: `Loadtest Hospital ${pad(o, 3)} Main Campus`,
        city,
        specialtyName: pick(SPECIALTIES, o + d),
        shiftType: shift.shiftType,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        headcount: 1 + (d % 3),
        amount: 3000 + ((o + d) % 8) * 500,
      });
    }
  }

  for (let a = 1; a <= COUNTS.platformAdmins; a++) {
    users.push({ uid: `${PREFIX}admin_${pad(a, 2)}`, role: 'admin', displayName: `Loadtest Admin ${pad(a, 2)}`, organizationId: '', facilityId: '' });
  }

  return { users, doctors, organizations, duties };
};

const createAuthUsers = async (users, password) => {
  let done = 0;
  await pool(users, 10, async (user) => {
    const record = {
      uid: user.uid,
      email: `${user.uid}@${EMAIL_DOMAIN}`,
      password,
      emailVerified: true,
      displayName: user.displayName,
    };
    for (let attempt = 0; ; attempt++) {
      try {
        await auth().createUser(record);
        break;
      } catch (error) {
        if (error.code === 'auth/uid-already-exists') {
          const { uid, ...update } = record;
          await auth().updateUser(uid, update);
          break;
        }
        // Auth throttles bursts of account creation on the cloud project.
        if (attempt < 5 && /quota|too-many|TOO_MANY/i.test(`${error.code} ${error.message}`)) {
          await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }
    if (user.role === 'admin') {
      await auth().setCustomUserClaims(user.uid, { isVerifier: true, isSupportAdmin: true, isSuperAdmin: false });
    }
    if (++done % 100 === 0) console.log(`  auth users: ${done}/${users.length}`);
  });
};

const writeFirestore = async ({ users, doctors, organizations, duties }) => {
  const writer = db().bulkWriter();
  const now = FieldValue.serverTimestamp();
  const meta = { loadTest: true };

  users.forEach((user, i) => {
    writer.set(db().collection('users').doc(user.uid), {
      ...meta,
      uid: user.uid,
      email: `${user.uid}@${EMAIL_DOMAIN}`,
      displayName: user.displayName,
      phoneNumber: `+9199${pad(i, 8)}`,
      status: 'active',
      activeRole: user.role === 'doctor' ? 'doctor' : user.role === 'hospital' ? 'hospital_staff' : 'admin',
      organizationIds: user.organizationId ? [user.organizationId] : [],
      consentVersion: CONSENT_VERSION,
      consentAcceptedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });

  for (const { uid, profile } of doctors) {
    writer.set(db().collection('doctors').doc(uid), {
      ...meta,
      doctorId: uid,
      userId: uid,
      ...profile,
      bio: 'Synthetic load-test profile.',
      credentialFingerprint: credentialFingerprint(profile),
      profileRevision: 1,
      isVerified: true,
      verificationStatus: 'approved',
      verificationCaseId: null,
      createdAt: now,
      updatedAt: now,
    });
    writer.set(db().collection('registrationReservations').doc(profile.registrationNoNorm), {
      registrationNoNorm: profile.registrationNoNorm,
      doctorId: uid,
      reservedAt: now,
    });
  }

  for (const org of organizations) {
    const orgRef = db().collection('organizations').doc(org.organizationId);
    writer.set(orgRef, {
      ...meta,
      organizationId: org.organizationId,
      legalName: `${org.name} Pvt Ltd`,
      displayName: org.name,
      organizationType: 'hospital',
      registrationNumber: `LT-ORG-${org.organizationId.slice(-3)}`,
      address: `${org.organizationId.slice(-3)} Load Test Road, ${org.city}`,
      city: org.city,
      contactPhone: '+919800000000',
      verificationState: 'approved',
      verificationCaseId: null,
      createdBy: org.staff[0].uid,
      createdAt: now,
      updatedAt: now,
    });
    for (const member of org.staff) {
      writer.set(orgRef.collection('members').doc(member.uid), {
        userId: member.uid,
        organizationId: org.organizationId,
        role: member.role,
        permissions: ['all'],
        status: 'active',
        joinedAt: now,
      });
    }
    writer.set(orgRef.collection('facilities').doc(org.facilityId), {
      facilityId: org.facilityId,
      organizationId: org.organizationId,
      name: `${org.name} Main Campus`,
      address: `${org.organizationId.slice(-3)} Load Test Road, ${org.city}`,
      city: org.city,
      geo: { latitude: 13.0827, longitude: 80.2707 },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  duties.forEach((duty, i) => {
    writer.set(db().collection('duties').doc(duty.dutyId), {
      ...meta,
      dutyId: duty.dutyId,
      organizationId: duty.organizationId,
      facilityId: duty.facilityId,
      facilityName: duty.facilityName,
      city: duty.city,
      department: 'Casualty',
      specialtyId: duty.specialtyName.toLowerCase().replace(/[^a-z]+/g, '_'),
      specialtyName: duty.specialtyName,
      qualificationRequired: 'MBBS',
      experienceMinYears: i % 3,
      schedule: { startAt: duty.startAt, endAt: duty.endAt, shiftType: duty.shiftType },
      headcount: duty.headcount,
      remainingHeadcount: duty.headcount,
      paymentTerms: { amount: duty.amount, currency: 'INR', basis: 'per_shift', expectedPaymentTiming: 'end_of_shift' },
      notes: '',
      status: 'published',
      version: 2,
      createdBy: organizations.find(o => o.organizationId === duty.organizationId).staff[0].uid,
      // Distinct timestamps keep the marketplace's createdAt ordering stable.
      createdAt: Timestamp.fromMillis(Date.now() - i * 1000),
      publishedAt: now,
      updatedAt: now,
    });
  });

  await writer.close();
};

const toCsv = (rows, columns) =>
  [columns.join(','), ...rows.map(row => columns.map(c => String(row[c] ?? '')).join(','))].join('\n') + '\n';

const writeCsvFiles = ({ users, duties }, password) => {
  mkdirSync(DATA_DIR, { recursive: true });
  const userRows = users.map(u => ({ ...u, email: `${u.uid}@${EMAIL_DOMAIN}`, password }));
  const userColumns = ['uid', 'email', 'password', 'role', 'organizationId', 'facilityId'];
  writeFileSync(join(DATA_DIR, 'users.csv'), toCsv(userRows, userColumns));
  for (const role of ['doctor', 'hospital', 'admin']) {
    writeFileSync(join(DATA_DIR, `${role}s.csv`), toCsv(userRows.filter(u => u.role === role), userColumns));
  }
  writeFileSync(join(DATA_DIR, 'duties.csv'), toCsv(duties,
    ['dutyId', 'organizationId', 'facilityId', 'specialtyName', 'city', 'startAt', 'endAt', 'headcount']));
};

const { target, projectId } = await resolveTarget();
const started = Date.now();
console.log(`Seeding load-test data into ${target} (${projectId})`);

console.log('Removing earlier load-test data...');
const removed = await cleanup();
console.log(`  removed ${removed.authUsers} auth users`);

const plan = buildPlan();
// One random password per seed run; it is only ever written to the git-ignored perf/data folder.
const password = `Lt-${randomBytes(12).toString('base64url')}`;

console.log(`Creating ${plan.users.length} auth users...`);
await createAuthUsers(plan.users, password);

console.log('Writing Firestore documents...');
await writeFirestore(plan);

writeCsvFiles(plan, password);

const byRole = role => plan.users.filter(u => u.role === role).length;
console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s:`);
console.log(`  doctors ${byRole('doctor')}, hospital staff ${byRole('hospital')}, platform admins ${byRole('admin')}`);
console.log(`  organizations ${plan.organizations.length}, published duties ${plan.duties.length}`);
console.log(`  credentials and duty list written to ${DATA_DIR}`);
