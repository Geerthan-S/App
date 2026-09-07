# Firestore Data Model & Schema Dictionary

This document specifies the Firestore collection structures, document schemas, field types, and indexing rules for the Healthcare Workforce Platform. All fields strictly follow **`camelCase`**.

---

## 1. Identity & Profile Collections

### `users/{uid}`
```json
{
  "uid": "string",
  "phoneNumber": "string (E.164)",
  "displayName": "string",
  "status": "'active' | 'suspended' | 'deleted'",
  "activeRole": "'doctor' | 'hospital_staff' | 'verifier' | 'support_admin' | 'super_admin'",
  "consentVersion": "string",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "lastLoginAt": "timestamp"
}
```

### `doctors/{doctorId}` (Document ID = Auth UID)
```json
{
  "doctorId": "string",
  "userId": "string",
  "fullName": "string",
  "council": "string (e.g. 'Tamil Nadu Medical Council')",
  "registrationNo": "string",
  "registrationNoNorm": "string (e.g. 'TNMC_123456')",
  "qualification": "string (e.g. 'MBBS, MD')",
  "specialties": ["string"],
  "primarySpecialty": "string",
  "yearsOfExperience": 5,
  "preferredCities": ["string"],
  "bio": "string",
  "isVerified": false,
  "verificationCaseId": "string | null",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### Subcollections under `doctors/{doctorId}`:
- `doctors/{doctorId}/qualifications/{id}`: `{ qualification, institution, yearOfPassing, certificateDocRef }`
- `doctors/{doctorId}/specialties/{id}`: `{ specialtyId, specialtyName, isPrimary }`

---

## 2. Organization & Facilities Collections

### `organizations/{organizationId}`
```json
{
  "organizationId": "string (UUID)",
  "legalName": "string",
  "displayName": "string",
  "organizationType": "'hospital' | 'clinic' | 'nursing_home'",
  "registrationNumber": "string",
  "address": "string",
  "city": "string",
  "verificationState": "'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'suspended'",
  "verificationCaseId": "string | null",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `organizations/{organizationId}/members/{uid}`
```json
{
  "userId": "string",
  "organizationId": "string",
  "role": "'owner' | 'admin' | 'duty_manager'",
  "permissions": ["string"],
  "facilityIds": ["string"],
  "joinedAt": "timestamp"
}
```

### `organizations/{organizationId}/facilities/{facilityId}`
```json
{
  "facilityId": "string (UUID)",
  "organizationId": "string",
  "name": "string",
  "address": "string",
  "city": "string",
  "geo": {
    "latitude": 13.0827,
    "longitude": 80.2707,
    "geohash": "string"
  },
  "status": "'active' | 'inactive'",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

---

## 3. Marketplace, Applications & Concurrency Collections

### `duties/{dutyId}`
```json
{
  "dutyId": "string (UUID)",
  "organizationId": "string",
  "facilityId": "string",
  "facilityName": "string",
  "city": "string",
  "department": "string",
  "specialtyId": "string",
  "specialtyName": "string",
  "qualificationRequired": "string",
  "experienceMinYears": 2,
  "schedule": {
    "startAt": "timestamp",
    "endAt": "timestamp",
    "shiftType": "'morning' | 'evening' | 'night' | 'full_day'"
  },
  "headcount": 1,
  "remainingHeadcount": 1,
  "paymentTerms": {
    "amount": 5000,
    "currency": "INR",
    "basis": "'per_shift' | 'per_hour'",
    "expectedPaymentTiming": "'end_of_shift' | 'within_24_hours' | 'weekly'"
  },
  "notes": "string",
  "status": "'draft' | 'published' | 'paused' | 'filled' | 'in_progress' | 'completed' | 'closed' | 'cancelled'",
  "version": 1,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `duties/{dutyId}/applications/{doctorId}` (Uniquely Keyed by Doctor ID)
```json
{
  "applicationId": "string (UUID)",
  "dutyId": "string",
  "doctorId": "string",
  "doctorName": "string",
  "primarySpecialty": "string",
  "yearsOfExperience": 5,
  "status": "'submitted' | 'shortlisted' | 'selected' | 'rejected' | 'withdrawn' | 'expired'",
  "rejectionReason": "string | null",
  "snapshotRef": "string (reference to applicationSnapshots)",
  "appliedAt": "timestamp",
  "updatedAt": "timestamp",
  "version": 1
}
```

### `applicationSnapshots/{snapshotId}` (Immutable Review-Time Facts)
```json
{
  "snapshotId": "string (UUID)",
  "applicationId": "string",
  "dutyId": "string",
  "doctorId": "string",
  "doctorProfileSnapshot": {
    "fullName": "string",
    "council": "string",
    "registrationNo": "string",
    "qualification": "string",
    "specialties": ["string"],
    "yearsOfExperience": 5
  },
  "capturedAt": "timestamp"
}
```

### `doctorSchedules/{doctorId}_{YYYY-MM-DD}` (Date-Scoped Schedule Lock)
```json
{
  "doctorId": "string",
  "date": "string (YYYY-MM-DD)",
  "intervals": [
    {
      "assignmentId": "string",
      "dutyId": "string",
      "startAt": "timestamp",
      "endAt": "timestamp",
      "status": "'selected' | 'confirmed' | 'in_progress' | 'completed'"
    }
  ],
  "version": 1,
  "updatedAt": "timestamp"
}
```

### `assignments/{assignmentId}`
```json
{
  "assignmentId": "string (UUID)",
  "dutyId": "string",
  "doctorId": "string",
  "organizationId": "string",
  "facilityId": "string",
  "termsSnapshot": {
    "amount": 5000,
    "currency": "INR",
    "basis": "'per_shift'",
    "startAt": "timestamp",
    "endAt": "timestamp"
  },
  "status": "'selected' | 'confirmed' | 'in_progress' | 'completed' | 'replaced' | 'cancelled' | 'disputed' | 'closed'",
  "expiresAt": "timestamp",
  "confirmedAt": "timestamp | null",
  "startedAt": "timestamp | null",
  "completedAt": "timestamp | null",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "version": 1
}
```

### `contactGrants/{grantId}` (Metadata Only — No Plain Phone Numbers)
```json
{
  "grantId": "string (UUID)",
  "assignmentId": "string",
  "doctorId": "string",
  "organizationId": "string",
  "status": "'active' | 'revoked'",
  "grantedAt": "timestamp",
  "revokedAt": "timestamp | null"
}
```

---

## 4. Verification, Operations & Outbox Collections

### `verificationCases/{caseId}`
```json
{
  "caseId": "string (UUID)",
  "subjectType": "'doctor' | 'organization'",
  "subjectId": "string",
  "status": "'draft' | 'submitted' | 'under_review' | 'needs_information' | 'approved' | 'rejected' | 'expired' | 'suspended'",
  "policyVersion": "string",
  "reviewerId": "string | null",
  "decisionReason": "string | null",
  "submittedAt": "timestamp",
  "decidedAt": "timestamp | null",
  "updatedAt": "timestamp"
}
```

### `verificationDocuments/{documentId}`
```json
{
  "documentId": "string (UUID)",
  "caseId": "string",
  "objectKey": "string (opaque path in Cloud Storage)",
  "mimeType": "string",
  "fileSize": 1048576,
  "sha256": "string | null",
  "scanStatus": "'pending' | 'clean' | 'infected'",
  "uploadedBy": "string",
  "uploadedAt": "timestamp"
}
```

### `notificationOutbox/{eventId}` (Leased Outbox Pattern)
```json
{
  "eventId": "string (UUID)",
  "dedupeKey": "string",
  "eventType": "string (e.g. 'assignment.confirmed')",
  "targetUserId": "string",
  "title": "string",
  "body": "string",
  "payload": {
    "dutyId": "string",
    "assignmentId": "string"
  },
  "status": "'pending' | 'leased' | 'delivered' | 'failed' | 'dead_letter'",
  "leaseExpiresAt": "timestamp | null",
  "attemptCount": 0,
  "maxAttempts": 5,
  "lastError": "string | null",
  "availableAt": "timestamp",
  "createdAt": "timestamp"
}
```

### `auditLogs/{auditId}`
```json
{
  "auditId": "string (UUID)",
  "actorId": "string",
  "actorRole": "string",
  "action": "string",
  "targetType": "string",
  "targetId": "string",
  "reasonCode": "string",
  "correlationId": "string",
  "beforeSummary": "object | null",
  "afterSummary": "object | null",
  "createdAt": "timestamp"
}
```
