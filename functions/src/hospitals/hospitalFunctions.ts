/**
 * Hospital, Organization & Facility Cloud Functions
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db, nowTimestamp, sanitizeCorrelationId } from '../shared/firestoreHelpers';
import { domainCall } from '../shared/callable';
import { requireAuth, requireOrgAdmin } from '../security/guards';
import { CreateOrganizationSchema, CreateFacilitySchema, DocIdSchema } from '../shared/schemas';
import { DomainError } from '../shared/errors';
import { stageAudit } from '../audit/auditLogger';

export const createOrganizationDraft = domainCall(async (request: CallableRequest) => {
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

  // Organization, owner membership, user role and audit commit together.
  const batch = db().batch();
  batch.set(orgRef, orgData);
  batch.set(orgRef.collection('members').doc(uid), {
    userId: uid,
    organizationId: orgId,
    role: 'owner',
    permissions: ['all'],
    status: 'active',
    joinedAt: nowTimestamp(),
  });
  batch.set(db().collection('users').doc(uid), {
    activeRole: 'hospital_staff',
    organizationIds: FieldValue.arrayUnion(orgId),
    updatedAt: nowTimestamp(),
  }, { merge: true });

  stageAudit(batch, {
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
  await batch.commit();

  return { success: true, organizationId: orgId };
}, { requireConsent: true });

export const getMyOrganizations = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const user = await db().collection('users').doc(uid).get();
  const savedIds = user.data()?.organizationIds;
  const legacyOwned = await db().collection('organizations').where('createdBy', '==', uid).limit(20).get();
  const ids = [...new Set([
    ...(Array.isArray(savedIds) ? savedIds : []),
    ...legacyOwned.docs.map(doc => doc.id),
  ])];
  const organizations = await Promise.all(ids.slice(0, 20).map(async id => {
    if (!DocIdSchema.safeParse(id).success) return null;
    const orgRef = db().collection('organizations').doc(id);
    const [member, org] = await Promise.all([
      orgRef.collection('members').doc(uid).get(), orgRef.get(),
    ]);
    const memberStatus = member.data()?.status;
    if (!member.exists || !org.exists || (memberStatus !== undefined && memberStatus !== 'active')) return null;
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

export const addFacility = domainCall(async (request: CallableRequest) => {
  const uid = requireAuth(request);
  const correlationId = sanitizeCorrelationId(request.data?.correlationId);

  const parsed = CreateFacilitySchema.safeParse(request.data);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid facility details', correlationId, parsed.error.flatten().fieldErrors);
  }

  const { organizationId, name, address, city, latitude, longitude } = parsed.data;
  if (!DocIdSchema.safeParse(organizationId).success) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid organization', correlationId);
  }
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

  const batch = db().batch();
  batch.set(facilityRef, facilityData);
  stageAudit(batch, {
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
  await batch.commit();

  return { success: true, facilityId };
}, { requireConsent: true });
