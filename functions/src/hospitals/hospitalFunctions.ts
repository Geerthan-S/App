/**
 * Hospital, Organization & Facility Cloud Functions
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { requireAuth, requireOrgAdmin } from '../security/guards';
import { CreateOrganizationSchema, CreateFacilitySchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { logAudit } from '../audit/auditLogger';

export const createOrganizationDraft = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = CreateOrganizationSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid organization details', correlationId, parsed.error.flatten().fieldErrors);
  }

  const orgRef = db().collection('organizations').doc();
  const orgId = orgRef.id;

  const orgData = {
    organizationId: orgId,
    legalName: parsed.data.legalName,
    displayName: parsed.data.displayName,
    organizationType: parsed.data.organizationType,
    registrationNumber: parsed.data.registrationNumber,
    address: parsed.data.address,
    city: parsed.data.city,
    verificationState: 'draft',
    verificationCaseId: null,
    createdBy: uid,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };

  await orgRef.set(orgData);

  // Add creator as owner member
  await orgRef.collection('members').doc(uid).set({
    userId: uid,
    organizationId: orgId,
    role: 'owner',
    permissions: ['all'],
    joinedAt: nowTimestamp(),
  });

  // Update user active role
  await db().collection('users').doc(uid).set({
    activeRole: 'hospital_staff',
    organizationIds: FieldValue.arrayUnion(orgId),
    updatedAt: nowTimestamp(),
  }, { merge: true });

  await logAudit({
    actorId: uid,
    actorRole: 'hospital_staff',
    action: 'ORGANIZATION_CREATED',
    targetType: 'organizations',
    targetId: orgId,
    reasonCode: 'ORG_REGISTRATION',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { legalName: parsed.data.legalName, orgId },
  });

  return { success: true, organizationId: orgId };
});

export const getMyOrganizations = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const user = await db().collection('users').doc(uid).get();
  const savedIds = user.data()?.organizationIds;
  const legacyOwned = await db().collection('organizations').where('createdBy', '==', uid).limit(20).get();
  const ids = [...new Set([
    ...(Array.isArray(savedIds) ? savedIds : []),
    ...legacyOwned.docs.map(doc => doc.id),
  ])];
  const organizations = await Promise.all(ids.slice(0, 20).map(async id => {
    if (typeof id !== 'string' || !id || id.includes('/')) return null;
    const orgRef = db().collection('organizations').doc(id);
    const [member, org] = await Promise.all([
      orgRef.collection('members').doc(uid).get(), orgRef.get(),
    ]);
    if (!member.exists || !org.exists) return null;
    const data = org.data()!;
    return {
      organizationId: id,
      legalName: data.legalName,
      displayName: data.displayName,
      organizationType: data.organizationType,
      registrationNumber: data.registrationNumber,
      address: data.address,
      city: data.city,
      verificationState: data.verificationState,
      verificationCaseId: data.verificationCaseId,
      memberRole: member.data()?.role,
    };
  }));
  return { organizations: organizations.filter(Boolean) };
});

export const addFacility = onCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = CreateFacilitySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid facility details', correlationId, parsed.error.flatten().fieldErrors);
  }

  const { organizationId, name, address, city, latitude, longitude } = parsed.data;
  await requireOrgAdmin(uid, organizationId, correlationId);

  const facilityRef = db().collection('organizations').doc(organizationId).collection('facilities').doc();
  const facilityId = facilityRef.id;

  const facilityData = {
    facilityId,
    organizationId,
    name,
    address,
    city,
    geo: {
      latitude,
      longitude,
    },
    status: 'active',
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };

  await facilityRef.set(facilityData);

  await logAudit({
    actorId: uid,
    actorRole: 'hospital_staff',
    action: 'FACILITY_ADDED',
    targetType: 'facilities',
    targetId: facilityId,
    reasonCode: 'FACILITY_CREATION',
    correlationId,
    result: 'SUCCESS',
    afterSummary: { name, city, organizationId },
  });

  return { success: true, facilityId };
});
