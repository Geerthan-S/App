# Cloud Storage Security & Private Evidence Architecture

## 1. Private Bucket Taxonomy & Storage Rules

Permanent public URLs (`getDownloadURL()`) are **strictly prohibited** for all sensitive evidence.

```
/
├── verification/
│   ├── doctor/
│   │   └── {doctorUid}/
│   │       └── {caseId}/
│   │           └── {opaqueFileId}          # Doctor registration certificate & identity proof
│   └── organization/
│       └── {orgId}/
│           └── {caseId}/
│               └── {opaqueFileId}          # Hospital establishment license & authorized rep proof
│
├── disputes/
│   └── {disputeId}/
│       └── {opaqueFileId}                  # Dispute evidence photos / documents
│
└── public/
    └── branding/
        └── {orgId}/
            └── logo.png                    # Public hospital logos (cache-controlled)
```

---

## 2. Secure Upload & Review Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Client as Doctor / Hospital Client
    participant CF as Cloud Function (requestUploadUrl)
    participant Store as Cloud Storage
    participant DB as Cloud Firestore
    actor Verifier as Verification Admin
    participant ReviewCF as Cloud Function (getEvidenceReadUrl)

    Client->>CF: requestUploadUrl({ caseId, fileName, mimeType, fileSize })
    CF->>DB: Verify caller is owner of caseId & case is in 'draft' or 'needs_information'
    CF-->>Client: Return short-lived upload target path & signed URL / session token
    Client->>Store: Upload file bytes directly to private path
    Client->>CF: finalizeEvidenceUpload({ caseId, objectKey, mimeType, fileSize })
    CF->>DB: Record verificationDocuments document with scanStatus = 'pending'
    
    Note over Verifier, ReviewCF: Review Time (Private Read)
    Verifier->>ReviewCF: getEvidenceReadUrl({ documentId })
    ReviewCF->>DB: Verify caller has 'isVerifier' claim & recent step-up auth (<= 10 mins)
    ReviewCF->>DB: Log access to auditLogs (action: "EVIDENCE_ACCESSED")
    ReviewCF->>Store: Generate 5-minute time-limited signed URL
    ReviewCF-->>Verifier: Return temporary signed read URL
```

---

## 3. Storage Security Rules Enforcement
- **MIME Types Allowed:** `image/jpeg`, `image/png`, `application/pdf`.
- **Max File Size:** $10\text{ MB}$ ($10 \times 1024 \times 1024$ bytes).
- **Ownership Check:** Direct writes enforce `request.auth.uid == doctorUid` or active membership in `orgId`.
- **Direct Reads:** All root verification folders disallow unauthenticated and cross-user direct client reads (`allow read: if false;`). Authorized reads go through the server-signed URL function.
