/**
 * Doctor Profile & Onboarding Cloud Functions
 */

import { createHash } from 'crypto';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentData } from 'firebase-admin/firestore';
import { db, nowTimestamp, normalizeRegistrationNo, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth } from '../security/guards';
import { SubmitDoctorProfileSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';
import { ACTIVE_CASE_STATUSES } from '../verification/verificationStates';

/**
 * Fields a verifier reviews. Changing any of them invalidates verification and
 * starts a new profile revision. Non-credential fields (bio, preferred cities)
 * can change freely.
 */
export const credentialFingerprint = (profile: DocumentData): string => {
  const material = {
    fullName: String(profile.fullName ?? '').trim(),
    council: String(profile.council ?? '').trim(),
    registrationNoNorm: String(profile.registrationNoNorm ?? ''),
    qualification: String(profile.qualification ?? '').trim(),
    primarySpecialty: String(profile.primarySpecialty ?? '').trim(),
    specialties: [...(Array.isArray(profile.specialties) ? profile.specialties : [])].map(String).sort(),
    yearsOfExperience: Number(profile.yearsOfExperience ?? 0),
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
};

export const submitDoctorProfile = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = SubmitDoctorProfileSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Invalid doctor profile payload',
      correlationId,
      parsed.error.flatten().fieldErrors
    );
  }

  const {
    fullName,
    council,
    registrationNo,
    qualification,
    specialties,
    primarySpecialty,
    yearsOfExperience,
    preferredCities,
    bio,
  } = parsed.data;

  const registrationNoNorm = normalizeRegistrationNo(council, registrationNo);
  const doctorRef = db().collection('doctors').doc(uid);
  const reservationRef = db().collection('registrationReservations').doc(registrationNoNorm);

  const incoming = {
    fullName, council, registrationNoNorm, qualification, primarySpecialty, specialties, yearsOfExperience,
  };
  const fingerprint = credentialFingerprint(incoming);

  const result = await db().runTransaction(async (tx) => {
    // ---- reads ----
    const [reservationSnap, legacyDuplicates, existingDoc] = await Promise.all([
      tx.get(reservationRef),
      tx.get(db().collection('doctors').where('registrationNoNorm', '==', registrationNoNorm).limit(2)),
      tx.get(doctorRef),
    ]);

    // Registration uniqueness: an atomic reservation keyed by the normalized
    // registration number, plus a check for profiles written before reservations.
    if (reservationSnap.exists && reservationSnap.data()?.doctorId !== uid) {
      throw new DomainError('APPLICATION_ALREADY_EXISTS',
        'A doctor profile with this medical council registration number already exists', correlationId);
    }
    if (legacyDuplicates.docs.some(doc => doc.id !== uid)) {
      throw new DomainError('APPLICATION_ALREADY_EXISTS',
        'A doctor profile with this medical council registration number already exists', correlationId);
    }

    const existing = existingDoc.exists ? existingDoc.data()! : null;
    const previousFingerprint = existing ? (existing.credentialFingerprint ?? credentialFingerprint(existing)) : null;
    const credentialsChanged = existing !== null && previousFingerprint !== fingerprint;
    const previousCaseId: string | null = existing?.verificationCaseId ?? null;
    const previousCaseSnap = credentialsChanged && previousCaseId
      ? await tx.get(db().collection('verificationCases').doc(previousCaseId))
      : null;
    const oldReservationRef = existing?.registrationNoNorm && existing.registrationNoNorm !== registrationNoNorm
      ? db().collection('registrationReservations').doc(existing.registrationNoNorm)
      : null;
    const oldReservationSnap = oldReservationRef ? await tx.get(oldReservationRef) : null;

    // ---- writes ----
    const profileRevision = existing === null
      ? 1
      : (existing.profileRevision ?? 1) + (credentialsChanged ? 1 : 0);
    const isVerified = existing !== null && !credentialsChanged && existing.isVerified === true;

    const doctorPayload: Record<string, unknown> = {
      doctorId: uid,
      userId: uid,
      fullName,
      council,
      registrationNo,
      registrationNoNorm,
      qualification,
      specialties,
      primarySpecialty,
      yearsOfExperience,
      preferredCities,
      bio: bio || '',
      credentialFingerprint: fingerprint,
      profileRevision,
      isVerified,
      updatedAt: nowTimestamp(),
    };
    if (existing === null) {
      doctorPayload.createdAt = nowTimestamp();
      doctorPayload.verificationCaseId = null;
      doctorPayload.verificationStatus = 'unverified';
    }
    if (credentialsChanged) {
      // Material change: verification no longer describes this profile. The
      // previous case stays as immutable history; a new case must be opened.
      doctorPayload.verificationCaseId = null;
      doctorPayload.previousVerificationCaseId = previousCaseId;
      doctorPayload.verificationStatus = 'unverified';
      doctorPayload.credentialsChangedAt = nowTimestamp();
    }
    tx.set(doctorRef, doctorPayload, { merge: true });

    if (previousCaseSnap?.exists && ACTIVE_CASE_STATUSES.includes(previousCaseSnap.data()?.status)) {
      tx.update(previousCaseSnap.ref, {
        status: 'superseded',
        supersededAt: nowTimestamp(),
        supersededReason: 'MATERIAL_PROFILE_CHANGE',
        updatedAt: nowTimestamp(),
      });
    }

    if (oldReservationSnap?.exists && oldReservationSnap.data()?.doctorId === uid) {
      tx.delete(oldReservationRef!);
    }
    tx.set(reservationRef, { registrationNoNorm, doctorId: uid, reservedAt: nowTimestamp() });

    tx.set(db().collection('users').doc(uid), {
      activeRole: 'doctor',
      displayName: fullName,
      updatedAt: nowTimestamp(),
    }, { merge: true });

    stageAudit(tx, {
      actorId: uid,
      actorRole: 'doctor',
      action: credentialsChanged ? 'DOCTOR_CREDENTIALS_CHANGED' : 'DOCTOR_PROFILE_SUBMITTED',
      targetType: 'doctors',
      targetId: uid,
      reasonCode: credentialsChanged ? 'VERIFICATION_INVALIDATED' : 'PROFILE_UPDATE',
      correlationId,
      result: 'SUCCESS',
      beforeSummary: existing ? { profileRevision: existing.profileRevision ?? 1, isVerified: existing.isVerified === true } : null,
      afterSummary: { fullName, registrationNoNorm, profileRevision, isVerified },
    });

    return { isVerified, profileRevision, verificationReset: credentialsChanged };
  });

  return { success: true, doctorId: uid, registrationNoNorm, ...result };
}, { requireConsent: true });
