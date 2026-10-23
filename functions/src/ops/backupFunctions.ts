/**
 * Daily Firestore export (blueprint §7.6 backups, Appendix B "backups and
 * restore evidence"). Complements point-in-time recovery: PITR covers the last
 * 7 days at minute granularity; these exports are the longer-retention copy
 * restored in drills (docs/runbooks/launch-readiness.md).
 *
 * BLOCKED_EXTERNAL until BACKUP_BUCKET is set in functions/.env.<project> and
 * the Functions service account can export (roles/datastore.importExportAdmin)
 * and write to that bucket. Without it the job logs and does nothing.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getApp } from 'firebase-admin/app';

const BUCKET = /^gs:\/\/[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

export const exportOutputPrefix = (bucket: string, now: Date): string =>
  `${bucket}/firestore/${now.toISOString().slice(0, 10)}`;

export const scheduledFirestoreExport = onSchedule({ schedule: 'every day 02:30', timeZone: 'Asia/Kolkata' }, async () => {
  const bucket = process.env.BACKUP_BUCKET ?? '';
  if (!BUCKET.test(bucket)) {
    console.warn('BLOCKED_EXTERNAL: Firestore export skipped; set BACKUP_BUCKET=gs://<bucket> for this project');
    return;
  }
  const projectId = process.env.GCLOUD_PROJECT ?? getApp().options.projectId;
  const credential = getApp().options.credential;
  if (!projectId || !credential) throw new Error('Project or credential unavailable for Firestore export');

  const { access_token: token } = await credential.getAccessToken();
  const outputUriPrefix = exportOutputPrefix(bucket, new Date());
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ outputUriPrefix }),
    });
  if (!response.ok) {
    throw new Error(`Firestore export failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const operation = await response.json() as { name?: string };
  console.log('Firestore export started', { outputUriPrefix, operation: operation.name });
});
