/**
 * Security Middleware and Guards for Cloud Functions
 */

import { CallableRequest } from 'firebase-functions/v2/https';
import { DomainError } from '../shared/errors';
import { db } from '../shared/firestoreHelpers';

export const requireAuth = (request: CallableRequest): string => {
  if (!request.auth || !request.auth.uid) {
    throw new DomainError('AUTH_REQUIRED', 'Authentication required for this operation', 'auth_err');
  }
  return request.auth.uid;
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

/**
 * Validates that the caller is an active member of the target organization
 */
export const requireOrgMember = async (uid: string, orgId: string, correlationId: string): Promise<string> => {
  const memberDoc = await db().collection('organizations').doc(orgId).collection('members').doc(uid).get();
  if (!memberDoc.exists) {
    throw new DomainError('PERMISSION_DENIED', 'User is not a member of this organization', correlationId);
  }
  const role = memberDoc.data()?.role;
  return role || 'member';
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
