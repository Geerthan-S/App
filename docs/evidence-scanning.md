# Evidence malware scanning

Status: `BLOCKED_EXTERNAL`. The platform side is implemented and fails closed;
the scanner service itself has not been provisioned.

## What the platform does

1. `indexVerificationEvidence` (Storage finalize trigger) records every upload
   under `verificationDocuments/{sha256(bucket/objectKey)}` with the object
   `generation`, the file's `sha256`, a signature check, and `scanStatus: pending`.
   Uploads for closed cases (approved, rejected, superseded, …) are recorded as
   `rejected` with `rejectionReason: CASE_CLOSED`.
2. A trusted scanner publishes one message per scanned object to the Pub/Sub
   topic `evidence-scan-results`. `ingestEvidenceScanResult` validates it
   (`ScanResultMessageSchema` in `functions/src/verification/malwareScannerAdapter.ts`)
   and applies it only if `bucket`, `objectKey`, `generation` **and** `sha256`
   match the indexed record. Anything else is ignored and the evidence stays untrusted.
3. Evidence counts as trusted only when `scanStatus == 'clean'` and
   `scannedGeneration == generation`. `recordVerificationDecision` refuses
   approval unless every document on the case is trusted, reading the evidence
   set inside the decision transaction, and records the reviewed document IDs,
   hashes and generations on the `verificationChecks` record.
4. `getEvidenceReadUrl` signs URLs pinned to the scanned generation, so a
   replaced object is never served.

Storage rules accept evidence only while a case is `draft` or `needs_information`,
so the evidence set cannot change while a verifier is reviewing it.

## Message contract

```json
{
  "documentId": "<64 hex: sha256 of bucket/objectKey>",
  "bucket": "<bucket>",
  "objectKey": "verification/doctor/<uid>/<caseId>/<uuid>.pdf",
  "generation": "<object generation as a decimal string>",
  "sha256": "<64 hex sha256 of the scanned bytes>",
  "verdict": "clean | infected | error",
  "scannerId": "<scanner identity>",
  "engineVersion": "<optional>",
  "scannedAt": "<ISO-8601>",
  "details": "<optional, max 1000 chars>"
}
```

`error` verdicts are logged in `verificationDocuments/{id}/scanAttempts` and
leave the document `pending` so the scanner can retry.

## Provisioning still required (owner action)

- Deploy a scanner (for example a ClamAV service on Cloud Run) that reads new
  objects from the evidence bucket by generation and publishes results.
- Give the scanner a dedicated service account with read access to the
  evidence bucket only, and make it the **only** principal with
  `roles/pubsub.publisher` on `evidence-scan-results`.
- Define quarantine/retention for `infected` objects.
- Verify clean, infected, corrupt, duplicate-message, stale-generation and
  scanner-outage cases in a non-production project before enabling approvals.
