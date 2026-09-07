# Firestore Security Rules Matrix

All collections default to **DENY**. Direct client access is restricted according to the least-privilege matrix below.

---

## Access Control Matrix

| Resource / Collection | Doctor Access | Hospital Staff Access | Verifier Access | Support Admin Access | Super Admin Access |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `users/{uid}` | Read/Write own document (`auth.uid == uid`) | Read/Write own document | Read all (audit recorded) | Read all | Read/Write all |
| `doctors/{doctorId}` | Read public fields of any doctor; Read/Write own profile | Read public snapshot of applicants | Read all | Read all | Read all |
| `organizations/{orgId}` | Read verified public profile | Read/Write own organization (if member) | Read all | Read all | Read/Write all |
| `organizations/{orgId}/members/{uid}` | Read own membership | Read/Write members of own org (if owner/admin) | Read | Read | Read/Write |
| `duties/{dutyId}` | Read published duties (`status == 'published' \|\| 'filled'`) | Read/Write duties of own org | Read all | Read all | Read/Write all |
| `duties/{dutyId}/applications/{doctorId}` | Read/Write own application (`auth.uid == doctorId`) | Read applications for own org's duties | Denied | Read (support cases) | Read |
| `applicationSnapshots/{snapshotId}` | Read own snapshot | Read applicant snapshot for own duty | Read | Read | Read |
| `assignments/{assignmentId}` | Read assigned to self (`doctorId == auth.uid`) | Read assignments belonging to own org | Denied | Read (support cases) | Read |
| `assignmentEvents/{eventId}` | Read own events | Read own org events | Denied | Read | Read |
| `contactGrants/{grantId}` | Read own grants (`doctorId == auth.uid`) | Read grants for own org | Denied | Read | Read |
| `doctorSchedules/{scheduleId}` | Read own schedule (`doctorId == auth.uid`) | Denied | Denied | Denied | Read |
| `verificationCases/{caseId}` | Read own case (`subjectId == auth.uid`) | Read own org case (`isOrgMember(subjectId)`) | Read/Write (via Functions / Rules) | Read | Read/Write |
| `verificationChecks/{checkId}` | Denied (internal notes) | Denied | Read/Write | Read | Read |
| `verificationDocuments/{docId}` | Read own metadata | Read own org metadata | Read | Read | Read |
| `notificationOutbox/{eventId}` | **DENIED to all clients** (Server trigger only) | **DENIED to all clients** | **DENIED** | **DENIED** | Read |
| `inboxNotifications/{notifId}` | Read/Update own notifications (`isRead` only) | Read/Update own notifications | Read/Update own | Read/Update own | Read/Write |
| `moderationReports/{reportId}` | Create report; Read own created reports | Create report; Read own | Denied | Read/Write | Read/Write |
| `auditLogs/{auditId}` | **DENIED to normal clients** | **DENIED to normal clients** | Denied | Read filtered | Read/Export |
| `featureFlags/{flag}` | Read enabled flags | Read enabled flags | Read | Read | Read/Write |
| `configuration/{configKey}` | Read active master configs | Read active master configs | Read | Read | Read/Write |

---

## Negative Rules Test Requirements
1. Doctor A attempts to read `duties/duty1/applications/doctorB` $\rightarrow$ **DENIED (403)**.
2. Hospital A member attempts to read or mutate Hospital B's duty $\rightarrow$ **DENIED (403)**.
3. Doctor attempts to write `isVerified = true` on `doctors/{doctorId}` $\rightarrow$ **DENIED (403)**.
4. Client attempts to write directly to `assignments/{id}` bypassing `atomicSelectDoctor` $\rightarrow$ **DENIED (403)**.
5. Client attempts to insert a record into `auditLogs` $\rightarrow$ **DENIED (403)**.
6. Unauthenticated request attempts to read `users` or `duties` $\rightarrow$ **DENIED (401/403)**.
