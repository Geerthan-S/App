/**
 * Centralized Audit Logger
 * Writes immutable, append-only records to `auditLogs` collection.
 */

import { db, nowTimestamp } from '../shared/firestoreHelpers';

export interface AuditEntry {
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  reasonCode: string;
  correlationId: string;
  result: 'SUCCESS' | 'FAILED' | 'DENIED';
  beforeSummary?: Record<string, unknown> | null;
  afterSummary?: Record<string, unknown> | null;
  securityMetadata?: {
    ipAddress?: string;
    userAgent?: string;
  };
}

export const logAudit = async (entry: AuditEntry): Promise<string> => {
  const auditRef = db().collection('auditLogs').doc();
  await auditRef.set({
    auditId: auditRef.id,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    reasonCode: entry.reasonCode,
    correlationId: entry.correlationId,
    result: entry.result,
    beforeSummary: entry.beforeSummary || null,
    afterSummary: entry.afterSummary || null,
    securityMetadata: entry.securityMetadata || null,
    createdAt: nowTimestamp(),
  });
  return auditRef.id;
};
