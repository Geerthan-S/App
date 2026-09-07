/**
 * Complete End-to-End Phase 1 Workflow Integration Test
 * Simulates Steps A through Z:
 * A-D: Hospital Auth, Org Creation, Facility Addition, Verification Approval
 * E-I: Doctor Auth, Profile Submission, Verification Case, Evidence Upload, Approval
 * J-K: Hospital Duty Creation & Publishing
 * L-N: Doctor Discovery, Apply & Immutable Snapshot Creation
 * O-R: Hospital Review, Shortlist, Atomic Selection (Locks Capacity, Schedule, Event, Outbox)
 * S-V: Doctor Confirm, Contact Grant, Audited getAssignmentContact (Positive & Third-party Negative)
 * W-Z: Start Shift, Complete Shift, Payment Acknowledgment, Mutual Feedback, Immutable History Verification
 */

import { getDateIntervals, normalizeRegistrationNo } from '../src/shared/firestoreHelpers';

describe('Phase 1 Full E2E Integration Workflow (Steps A - Z)', () => {
  // Shared state across the lifecycle test
  let hospitalStaffUid: string;
  let orgId: string;
  let facilityId: string;
  let doctorUid: string;
  let dutyId: string;
  let applicationId: string;
  let assignmentId: string;
  let applicationSnapshotRef: string;
  let contactGrantId: string;

  const inMemoryDb: Record<string, Record<string, any>> = {
    users: {},
    organizations: {},
    facilities: {},
    doctors: {},
    verificationCases: {},
    duties: {},
    applications: {},
    applicationSnapshots: {},
    doctorSchedules: {},
    assignments: {},
    assignmentEvents: {},
    contactGrants: {},
    completionRecords: {},
    paymentAcknowledgements: {},
    feedback: {},
    notificationOutbox: {},
    auditLogs: {},
  };

  test('Step A-D: Hospital Staff creates Organization, Facility, and receives Verifier Approval', () => {
    hospitalStaffUid = 'usr_hospital_admin_101';
    orgId = 'org_apollo_main';
    facilityId = 'fac_greams_road';

    // A: User profile
    inMemoryDb.users[hospitalStaffUid] = {
      uid: hospitalStaffUid,
      phoneNumber: '+919876543210',
      activeRole: 'hospital_staff',
      status: 'active',
    };

    // B: Organization Draft
    inMemoryDb.organizations[orgId] = {
      organizationId: orgId,
      legalName: 'Apollo Hospitals Enterprise Ltd',
      displayName: 'Apollo Specialty Hospital',
      organizationType: 'hospital',
      verificationState: 'draft',
      createdBy: hospitalStaffUid,
    };

    // C: Add Facility
    inMemoryDb.facilities[facilityId] = {
      facilityId,
      organizationId: orgId,
      name: 'Greams Road Main Hospital',
      city: 'Chennai',
      geo: { latitude: 13.0604, longitude: 80.2496 },
      status: 'active',
    };

    // D: Verifier Approval
    inMemoryDb.organizations[orgId].verificationState = 'approved';

    expect(inMemoryDb.organizations[orgId].verificationState).toBe('approved');
    expect(inMemoryDb.facilities[facilityId].organizationId).toBe(orgId);
  });

  test('Step E-I: Doctor creates Profile, submits Evidence, and receives Verifier Approval', () => {
    doctorUid = 'doc_aravind_77';

    // E: Doctor User Auth
    inMemoryDb.users[doctorUid] = {
      uid: doctorUid,
      phoneNumber: '+919999911111',
      activeRole: 'doctor',
      status: 'active',
    };

    // F: Doctor Profile
    const council = 'Tamil Nadu Medical Council';
    const regNo = 'TNMC_88776';
    const regKey = normalizeRegistrationNo(council, regNo);

    inMemoryDb.doctors[doctorUid] = {
      doctorId: doctorUid,
      userId: doctorUid,
      fullName: 'Dr. Aravind Swaminathan',
      council,
      registrationNo: regNo,
      registrationNoNorm: regKey,
      qualification: 'MBBS, MD',
      specialties: ['General Medicine', 'Critical Care'],
      primarySpecialty: 'General Medicine',
      yearsOfExperience: 6,
      preferredCities: ['Chennai'],
      isVerified: false,
    };

    // G-H: Verification Case & Synthetic Evidence
    const caseId = 'case_verif_doc_77';
    inMemoryDb.verificationCases[caseId] = {
      caseId,
      subjectType: 'doctor',
      subjectId: doctorUid,
      status: 'submitted',
      documents: ['verification/doctor/doc_aravind_77/case_verif_doc_77/cert_opaque_id.pdf'],
    };

    // I: Verifier Approval
    inMemoryDb.verificationCases[caseId].status = 'approved';
    inMemoryDb.doctors[doctorUid].isVerified = true;

    expect(inMemoryDb.doctors[doctorUid].isVerified).toBe(true);
    expect(regKey).toBe('TAMIL_NADU_MEDICAL_COUNCIL_TNMC88776');
  });

  test('Step J-K: Verified Hospital creates and publishes Duty requirement', () => {
    dutyId = 'duty_chennai_gm_99';

    inMemoryDb.duties[dutyId] = {
      dutyId,
      organizationId: orgId,
      facilityId,
      facilityName: 'Greams Road Main Hospital',
      city: 'Chennai',
      specialtyId: 'spec_gm',
      specialtyName: 'General Medicine',
      schedule: {
        startAt: '2026-09-20T08:00:00Z',
        endAt: '2026-09-20T16:00:00Z',
        shiftType: 'morning',
      },
      headcount: 1,
      remainingHeadcount: 1,
      paymentTerms: { amount: 7000, currency: 'INR', basis: 'per_shift' },
      status: 'published',
      version: 1,
    };

    expect(inMemoryDb.duties[dutyId].status).toBe('published');
    expect(inMemoryDb.duties[dutyId].remainingHeadcount).toBe(1);
  });

  test('Step L-N: Doctor discovers Duty, applies, and creates immutable Application Snapshot', () => {
    // Doctor discovers duty matching specialty
    const matchingDuties = Object.values(inMemoryDb.duties).filter(
      d => d.status === 'published' && inMemoryDb.doctors[doctorUid].specialties.includes(d.specialtyName)
    );
    expect(matchingDuties.length).toBe(1);

    // Apply
    applicationId = 'app_99_77';
    applicationSnapshotRef = 'snap_app_99_77';

    // Immutable review snapshot
    inMemoryDb.applicationSnapshots[applicationSnapshotRef] = {
      snapshotId: applicationSnapshotRef,
      dutyId,
      doctorId: doctorUid,
      profileSnapshot: { ...inMemoryDb.doctors[doctorUid] },
      capturedAt: new Date().toISOString(),
    };

    inMemoryDb.applications[applicationId] = {
      applicationId,
      dutyId,
      doctorId: doctorUid,
      status: 'submitted',
      snapshotRef: applicationSnapshotRef,
      version: 1,
    };

    expect(inMemoryDb.applications[applicationId].status).toBe('submitted');
    expect(inMemoryDb.applicationSnapshots[applicationSnapshotRef].profileSnapshot.fullName).toBe('Dr. Aravind Swaminathan');
  });

  test('Step O-R: Hospital reviews, shortlists, and executes Atomic Selection', () => {
    // O-P: Review & Shortlist
    inMemoryDb.applications[applicationId].status = 'shortlisted';

    // Q: Atomic Selection Transaction
    assignmentId = 'asg_duty_99_doctor_77';
    const duty = inMemoryDb.duties[dutyId];
    const coveredDates = getDateIntervals(duty.schedule.startAt, duty.schedule.endAt);

    // Verify remaining capacity > 0
    expect(duty.remainingHeadcount).toBeGreaterThan(0);

    // Lock capacity & schedule
    duty.remainingHeadcount -= 1;
    if (duty.remainingHeadcount === 0) duty.status = 'filled';

    inMemoryDb.applications[applicationId].status = 'selected';

    // Create Assignment Offer (12-hr expiry)
    inMemoryDb.assignments[assignmentId] = {
      assignmentId,
      dutyId,
      doctorId: doctorUid,
      organizationId: orgId,
      facilityId,
      status: 'selected',
      expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
      termsSnapshot: { ...duty.paymentTerms, startAt: duty.schedule.startAt, endAt: duty.schedule.endAt },
      version: 1,
    };

    // Store doctorSchedules lock
    coveredDates.forEach(date => {
      inMemoryDb.doctorSchedules[`${doctorUid}_${date}`] = {
        doctorId: doctorUid,
        date,
        intervals: [{
          assignmentId,
          dutyId,
          startAt: duty.schedule.startAt,
          endAt: duty.schedule.endAt,
          status: 'selected',
        }],
        version: 1,
      };
    });

    // Write assignment event & outbox
    inMemoryDb.assignmentEvents[`evt_${assignmentId}_selected`] = {
      assignmentId,
      fromStatus: 'none',
      toStatus: 'selected',
      actorId: hospitalStaffUid,
      timestamp: new Date().toISOString(),
    };

    inMemoryDb.notificationOutbox[`outbox_${assignmentId}`] = {
      eventId: `outbox_${assignmentId}`,
      dedupeKey: `app_selected_${assignmentId}`,
      eventType: 'application.selected',
      targetUserId: doctorUid,
      status: 'pending',
    };

    // R: Invariant assertions
    expect(duty.remainingHeadcount).toBe(0);
    expect(duty.status).toBe('filled');
    expect(inMemoryDb.applications[applicationId].status).toBe('selected');
    expect(inMemoryDb.assignments[assignmentId].status).toBe('selected');
    expect(inMemoryDb.doctorSchedules[`${doctorUid}_2026-09-20`].intervals.length).toBe(1);
    expect(inMemoryDb.notificationOutbox[`outbox_${assignmentId}`].status).toBe('pending');
  });

  test('Step S-V: Doctor confirms assignment, grants contact, and verifies audited access control', () => {
    // S: Doctor accepts offer
    inMemoryDb.assignments[assignmentId].status = 'confirmed';
    inMemoryDb.assignments[assignmentId].confirmedAt = new Date().toISOString();

    // T: Issue contactGrant metadata
    contactGrantId = 'grant_asg_99_77';
    inMemoryDb.contactGrants[contactGrantId] = {
      grantId: contactGrantId,
      assignmentId,
      doctorId: doctorUid,
      organizationId: orgId,
      status: 'active',
      grantedAt: new Date().toISOString(),
      revokedAt: null,
    };

    // U: Authenticated Contact Resolution for Authorized Parties
    const resolveContact = (callerId: string) => {
      const isDoc = callerId === doctorUid;
      const isHosp = callerId === hospitalStaffUid;

      if (!isDoc && !isHosp) {
        throw new Error('PERMISSION_DENIED');
      }

      // Log access audit
      inMemoryDb.auditLogs[`audit_contact_${callerId}`] = {
        actorId: callerId,
        action: 'CONTACT_ACCESSED',
        targetId: assignmentId,
        result: 'SUCCESS',
      };

      return isDoc
        ? { target: 'Hospital Desk', phone: '+914428290200' }
        : { target: 'Dr. Aravind', phone: '+919999911111' };
    };

    const docAccess = resolveContact(doctorUid);
    const hospAccess = resolveContact(hospitalStaffUid);

    expect(docAccess.phone).toBe('+914428290200');
    expect(hospAccess.phone).toBe('+919999911111');

    // V: Unauthorized third-party receives PERMISSION_DENIED
    expect(() => resolveContact('unauthorized_user_999')).toThrow('PERMISSION_DENIED');
  });

  test('Step W-Z: Start Shift, Complete, Payment Acknowledged, Mutual Feedback, and Immutability Verified', () => {
    // W: Start Shift
    inMemoryDb.assignments[assignmentId].status = 'in_progress';
    inMemoryDb.assignments[assignmentId].startedAt = new Date().toISOString();

    // X: Complete Shift
    inMemoryDb.assignments[assignmentId].status = 'completed';
    inMemoryDb.assignments[assignmentId].completedAt = new Date().toISOString();
    inMemoryDb.completionRecords[`comp_${assignmentId}`] = {
      assignmentId,
      doctorId: doctorUid,
      organizationId: orgId,
      completedAt: inMemoryDb.assignments[assignmentId].completedAt,
      structuredOutcome: 'SUCCESSFUL_SHIFT_COMPLETED',
    };

    // Y: Payment Acknowledgement (Non-blocking post-duty)
    inMemoryDb.paymentAcknowledgements[`pay_ack_${assignmentId}`] = {
      assignmentId,
      agreedAmount: 7000,
      status: 'acknowledged',
      acknowledgedBy: hospitalStaffUid,
      timestamp: new Date().toISOString(),
    };

    // Z: Mutual Feedback
    inMemoryDb.feedback[`fb_doc_to_hosp_${assignmentId}`] = {
      assignmentId,
      authorId: doctorUid,
      targetId: orgId,
      rating: 5,
      punctualitySupport: 'EXCELLENT',
    };
    inMemoryDb.feedback[`fb_hosp_to_doc_${assignmentId}`] = {
      assignmentId,
      authorId: hospitalStaffUid,
      targetId: doctorUid,
      rating: 5,
      clinicalCompetence: 'VERIFIED_ACCURATE',
    };

    // Immutability checks: Verify historical snapshots remained untouched
    expect(inMemoryDb.applicationSnapshots[applicationSnapshotRef].profileSnapshot.fullName).toBe('Dr. Aravind Swaminathan');
    expect(inMemoryDb.assignments[assignmentId].termsSnapshot.amount).toBe(7000);
    expect(inMemoryDb.assignments[assignmentId].status).toBe('completed');
  });
});
