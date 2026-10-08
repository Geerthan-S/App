/** Index private evidence after upload. No document is trusted until externally scanned. */
import { createHash } from 'crypto';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { getStorage } from 'firebase-admin/storage';
import { db, nowTimestamp } from '../shared/firestoreHelpers';
import { matchesFileSignature } from './evidenceSignature';

const uuidFile = '([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:pdf|png|jpg|jpeg))';
const doctorEvidencePath = new RegExp(`^verification/doctor/([^/]+)/([^/]+)/${uuidFile}$`);
const organizationEvidencePath = new RegExp(`^verification/organization/([^/]+)/([^/]+)/${uuidFile}$`);
const maxBytes = 10 * 1024 * 1024;

export const indexVerificationEvidence = onObjectFinalized(async event => {
  const object = event.data;
  const objectKey = object.name || '';
  const doctorMatch = doctorEvidencePath.exec(objectKey);
  const organizationMatch = organizationEvidencePath.exec(objectKey);
  const match = doctorMatch || organizationMatch;
  if (!match || !object.bucket) return;
  const [, subjectId, caseId] = match;
  const subjectType = doctorMatch ? 'doctor' : 'organization';
  const uploadedBy = doctorMatch ? subjectId : object.metadata?.uploadedBy;
  if (!uploadedBy) return;
  const caseSnap = await db().collection('verificationCases').doc(caseId).get();
  if (!caseSnap.exists || caseSnap.data()?.subjectType !== subjectType || caseSnap.data()?.subjectId !== subjectId) return;
  if (organizationMatch) {
    const member = await db().collection('organizations').doc(subjectId).collection('members').doc(uploadedBy).get();
    if (!member.exists || !['owner', 'admin'].includes(member.data()?.role)) return;
  }

  const documentId = createHash('sha256').update(`${object.bucket}/${objectKey}`).digest('hex');
  const documentRef = db().collection('verificationDocuments').doc(documentId);
  const file = getStorage().bucket(object.bucket).file(objectKey);
  const sizeBytes = Number(object.size || 0);
  let scanStatus = 'pending';
  let sha256: string | null = null;

  if (sizeBytes <= 0 || sizeBytes >= maxBytes) {
    scanStatus = 'rejected';
  } else {
    const [bytes] = await file.download();
    sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!matchesFileSignature(bytes, object.contentType || '')) scanStatus = 'rejected';
  }

  await documentRef.create({
    documentId,
    caseId,
    subjectType,
    subjectId,
    uploadedBy,
    objectKey,
    bucket: object.bucket,
    generation: object.generation || null,
    contentType: object.contentType || null,
    sizeBytes,
    sha256,
    scanStatus,
    uploadedAt: nowTimestamp(),
  }).catch(error => {
    // Cloud Storage events are at least once. A duplicate deterministic record is harmless.
    if (error?.code !== 6) throw error;
  });
});
