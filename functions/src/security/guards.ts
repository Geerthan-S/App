/**
 * Security Middleware and Guards for Cloud Functions
 */

import { CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentData, Transaction } from 'firebase-admin/firestore';
import { DomainError } from '../shared/errors';
import { db } from '../shared/firestoreHelpers';
import { PLATFORM_DEFAULTS } from '../shared/platformConfig';

export const requireAuth = (request: CallableRequest): string => {
  if (!request.auth || !request.auth.uid) {
    throw new DomainError('AUTH_REQUIRED', 'Authentication required for this operation', 'auth_err');
  }
  return request.auth.uid;
};

/** Account states that may no longer act on the platform. */
const INELIGIBLE_ACCOUNT_STATUSES = ['suspended', 'deleted'];

/** Membership states that still grant tenant access. A missing status predates the field and is active. */
const isActiveMembership = (data: DocumentData | undefined): boolean =>
  data !== undefined && (data.status === undefined || data.status === 'active');

/**
 * Rejects suspended or deleted accounts, and optionally accounts that have not
 * accepted the current consent version. Runs at the shared callable boundary.
 */
export const requireEligibleAccount = async (
  uid: string,
  correlationId: string,
  options: { requireConsent?: boolean } = {}
): Promise<void> => {
  const user = (await db().collection('users').doc(uid).get()).data();
  if (user && INELIGIBLE_ACCOUNT_STATUSES.includes(user.status)) {
    throw new DomainError('ACCOUNT_SUSPENDED', 'This account is not permitted to perform platform actions', correlationId);
  }
  if (options.requireConsent && user?.consentVersion !== PLATFORM_DEFAULTS.CURRENT_CONSENT_VERSION) {
    throw new DomainError('CONSENT_REQUIRED', 'Accept the current terms and privacy notice to continue', correlationId);
  }
};

/** Transactional eligibility read for the counterparty of a contested write. */
export const assertAccountActiveInTx = async (tx: Transaction, uid: string, correlationId: string): Promise<void> => {
  const user = (await tx.get(db().collection('users').doc(uid))).data();
  if (user && INELIGIBLE_ACCOUNT_STATUSES.includes(user.status)) {
    throw new DomainError('ACCOUNT_SUSPENDED', 'The account involved in this operation is suspended', correlationId);
  }
};

export const requireVerifier = (request: CallableRequest, correlationId: string): string => {
  const uid = requireAuth(request);
  const token = request.auth?.token;
  if (!token?.isVerifier && !token?.isSuperAdmin) {
    throw new DomainError('PERMISSION_DENIED', 'Verifier or Admin privileges required', correlationId);
  }
  return uid;
};

export const requireAdmin = (request: CallableRequest, correlationId: string): string => {
  const uid = requireAuth(request);
  const token = request.auth?.token;
  if (!token?.isSupportAdmin && !token?.isSuperAdmin) {
    throw new DomainError('PERMISSION_DENIED', 'Administrative privileges required', correlationId);
  }
  return uid;
};

export const requireSuperAdmin = (request: CallableRequest, correlationId: string): string => {
  const uid = requireAuth(request);
  const token = request.auth?.token;
  if (!token?.isSuperAdmin) {
    throw new DomainError('PERMISSION_DENIED', 'Super Admin privileges required', correlationId);
  }
  return uid;
};

/**
 * Step-Up Authentication Guard: Ensures auth_time is within the last `maxAgeSeconds`
 */
export const requireStepUpAuth = (request: CallableRequest, correlationId: string, maxAgeSeconds = 600): void => {
  const authTime = request.auth?.token?.auth_time;
  if (!authTime) {
    throw new DomainError('STEP_UP_REQUIRED', 'Recent authentication is required for this action', correlationId);
  }
  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (nowInSeconds - authTime > maxAgeSeconds) {
    throw new DomainError('STEP_UP_REQUIRED', 'Session expired for sensitive action; please re-authenticate', correlationId);
  }
};

const memberRef = (orgId: string, uid: string) =>
  db().collection('organizations').doc(orgId).collection('members').doc(uid);

/**
 * Validates that the caller is an active member of the target organization
 */
export const requireOrgMember = async (uid: string, orgId: string, correlationId: string): Promise<string> => {
  const memberDoc = await memberRef(orgId, uid).get();
  if (!memberDoc.exists || !isActiveMembership(memberDoc.data())) {
    throw new DomainError('PERMISSION_DENIED', 'User is not an active member of this organization', correlationId);
  }
  const role = memberDoc.data()?.role;
  return role || 'member';
};

/** Transactional membership check for contested writes. Returns false instead of throwing. */
export const isActiveOrgMemberInTx = async (tx: Transaction, uid: string, orgId: string): Promise<boolean> => {
  const memberDoc = await tx.get(memberRef(orgId, uid));
  return memberDoc.exists && isActiveMembership(memberDoc.data());
};

/**
 * Validates that the caller is an admin or owner of the organization
 */
export const requireOrgAdmin = async (uid: string, orgId: string, correlationId: string): Promise<void> => {
  const role = await requireOrgMember(uid, orgId, correlationId);
  if (role !== 'owner' && role !== 'admin') {
    throw new DomainError('PERMISSION_DENIED', 'Organization administrator role required', correlationId);
  }
};
