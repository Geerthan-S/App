/**
 * Doctor Profile & Onboarding Cloud Functions
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { db, nowTimestamp, normalizeRegistrationNo, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAuth } from '../security/guards';
import { SubmitDoctorProfileSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';

export const submitDoctorProfile = onCall(async (request: CallableRequest) => {
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

  // Check for duplicate active registration
  const duplicateQuery = await db()
    .collection('doctors')
    .where('registrationNoNorm', '==', registrationNoNorm)
    .limit(2)
    .get();

  for (const doc of duplicateQuery.docs) {
    if (doc.id !== uid) {
      throw new DomainError(
        'APPLICATION_ALREADY_EXISTS',
        'A doctor profile with this medical council registration number already exists',
        correlationId
      );
    }
  }

  const doctorRef = db().collection('doctors').doc(uid);
  const existingDoc = await doctorRef.get();

  let isVerified = false;
  let verificationCaseId: string | null = null;

  if (existingDoc.exists) {
    const existing = existingDoc.data();
    isVerified = existing?.isVerified || false;
    verificationCaseId = existing?.verificationCaseId || null;

    // If material fields change, verification requires reverification
    if (
      existing?.registrationNoNorm !== registrationNoNorm ||
      existing?.fullName !== fullName
    ) {
      isVerified = false;
    }
  }

  const doctorPayload = {
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
    isVerified,
    verificationCaseId,
    updatedAt: nowTimestamp(),
  };

  if (!existingDoc.exists) {
    (doctorPayload as Record<string, unknown>).createdAt = nowTimestamp();
  }

  await doctorRef.set(doctorPayload, { merge: true });

  // Update user active role
  await db().collection('users').doc(uid).set({
    activeRole: 'doctor',
    displayName: fullName,
    updatedAt: nowTimestamp(),
  }, { merge: true });

  await logAudit({
    actorId: uid,
    actorRole: 'doctor',
    action: 'DOCTOR_PROFILE_SUBMITTED',
    targetType: 'doctors',
    targetId: uid,
    reasonCode: 'PROFILE_UPDATE',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { fullName, registrationNoNorm, isVerified },
  });

  return { success: true, doctorId: uid, registrationNoNorm, isVerified };
});
