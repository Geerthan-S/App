# Deployment, Rollback & Incident Response Runbooks

## 1. Deployment Runbook (`docs/runbooks/deployment.md`)
```powershell
# 1. Build and Test Cloud Functions
cd functions
npm run lint
npm run build
npm test

# 2. Deploy Security Rules & Indexes
npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage

# 3. Deploy Cloud Functions
npx firebase-tools deploy --only functions

# 4. Deploy Admin Web Portal
npx firebase-tools deploy --only hosting
```

---

## 2. Rollback & Emergency Kill Switches (`docs/runbooks/rollback.md`)

If an unexpected production defect or security incident occurs:

### Immediate Server-Side Kill Switches (No Play Store release delay):
Set the corresponding Remote Config parameter or `featureFlags` Firestore document:
- `kill_switch_duty_publishing = true` $\rightarrow$ Disables duty creation and publishing.
- `kill_switch_applications = true` $\rightarrow$ Pauses doctor application submissions.
- `kill_switch_selection = true` $\rightarrow$ Blocks hospital selection transactions.
- `kill_switch_evidence_upload = true` $\rightarrow$ Blocks evidence uploads.

### Reverting Cloud Functions & Rules:
```powershell
# Deploy prior tagged commit
git checkout <PREVIOUS_RELEASE_TAG>
npx firebase-tools deploy --only functions,firestore:rules,storage
```

---

## 3. Verification Operations Runbook (`docs/runbooks/verification.md`)

1. **Queue Inspection:** Verifier opens Admin Web Portal $\rightarrow$ **Doctor Verification Queue**.
2. **Document Check:** Verifier reviews the private registration certificate via temporary signed URL.
3. **Official Lookup:** Verifier validates the registration number against the National Medical Commission (NMC) Indian Medical Register or State Medical Council registry.
4. **Decision:**
   - **Approve:** Issues reasoned decision $\rightarrow$ sets `status = 'approved'`, updates `isVerified = true` on `doctors/{doctorId}`, and emits an immutable `auditLogs` entry with correlation ID.
   - **Needs Info:** Notes specific missing proof $\rightarrow$ sends in-app and push notification to the doctor.
   - **Reject:** Notes discrepancy reason $\rightarrow$ removes badge and notifies applicant with appeal instructions.
