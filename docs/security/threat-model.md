# Security Threat Model & Trust Boundaries

## 1. Threat Actors & Attack Vectors

| Attacker Persona | Motivation / Capability | Threat Vector | System Countermeasure |
| :--- | :--- | :--- | :--- |
| **Malicious Doctor** | Fabricate medical credentials; apply to restricted duties; double-book overlapping high-paying shifts. | Submitting fake registration numbers; modifying client app code to bypass UI checks. | Canonical registry normalization, mandatory verifier approval, and Cloud Function Firestore transaction interval checks on `doctorSchedules`. |
| **Malicious Hospital Staff** | Access candidate contact numbers for spamming; select multiple doctors beyond capacity; access competitor hospital data. | Direct Firestore read/write attempts; modifying requests in proxy. | Scoped organization membership rules, atomic `atomicSelectDoctor` transaction, and tokenized on-demand contact resolution (`getAssignmentContact`). |
| **Rogue / Compromised Admin** | Unauthorized bulk data exfiltration; approving illegitimate doctor accounts; tampering with audit logs. | Using leaked credentials or compromised workstation. | Step-up authentication ($\le 10$ min token freshness), multi-factor authentication (MFA), least-privilege role separation, immutable append-only `auditLogs`. |
| **Compromised Mobile Device / Attacker with Stolen Token** | Access sensitive shifts and contact info; replay stale API requests. | Replay attacks, rooted device interception. | Firebase App Check (Play Integrity), short-lived ID tokens, idempotent request keys, and session revocation. |
| **Malicious File Uploader** | Uploading malware/ransomware disguised as doctor registration certificates or hospital licenses. | Uploading crafted binary files. | Pre-signed upload context with MIME/size limits, opaque UUID keys in private storage, and short-lived signed URLs for verifier review. |

---

## 2. Trust Boundaries

```
[ UNTRUSTED ZONE ]
Flutter Android Client (Reverse engineered / Modified)
Browser Admin Portal (Public JS bundle)
        │
        ▼ (App Check + Phone Auth OTP JWT + HTTPS TLS 1.3)
[ PERIMETER SECURITY ]
Firebase Authentication & App Check Gateway
        │
        ▼ (Authorized JWT + Scoped Claims)
[ TRUSTED SERVER RUNTIME ]
Cloud Functions v2 (TypeScript)
- Request Schema Validation (Zod)
- Correlation ID Injection
- Server-Side Role & Tenancy Verification
- Firestore Transactions (Capacity & Schedule Locks)
- Centralized Audit Logging
        │
        ▼ (Admin SDK / Deny-by-Default Security Rules)
[ PERSISTENCE & STORAGE ]
Cloud Firestore (Deny-by-Default Rules)
Cloud Storage (Private Buckets & Strict Storage Rules)
```

---

## 3. Data Protection & PII Minimization
1. **Never Stored in Public Documents:**
   - Raw personal phone numbers and emails on marketplace duty cards.
   - Medical registration document URLs.
2. **Never Written to Logs, Telemetry, or Analytics:**
   - OTP codes.
   - Access tokens and refresh tokens.
   - Raw binary document buffers or signed URL credentials.
   - Full doctor profile PII in Crashlytics reports (only sanitized correlation IDs and error codes are emitted).
