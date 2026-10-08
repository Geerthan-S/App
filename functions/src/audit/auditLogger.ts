/**
 * Centralized Audit Logger
 * Writes immutable, append-only records to `auditLogs` collection.
 */

import { db, nowTimestamp } from '../shared/firestoreHelpers';
import type { StagedWriter } from '../notifications/outbox';

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

const auditRecord = (auditId: string, entry: AuditEntry) => ({
  auditId,
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

export const logAudit = async (entry: AuditEntry): Promise<string> => {
  const auditRef = db().collection('auditLogs').doc();
  await auditRef.set(auditRecord(auditRef.id, entry));
  return auditRef.id;
};

/** Stages the audit record in the same transaction/batch as the state change it describes. */
export const stageAudit = (writer: StagedWriter, entry: AuditEntry): string => {
  const auditRef = db().collection('auditLogs').doc();
  writer.set(auditRef, auditRecord(auditRef.id, entry));
  return auditRef.id;
};
