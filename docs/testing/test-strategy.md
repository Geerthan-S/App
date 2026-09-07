# Testing Strategy & Acceptance Matrix

## 1. Testing Pyramid & Test Types

```
                  ▲
                 / \
                /E2E\             1. Full Duty Lifecycle Integration Test
               /-----\
              / Concur\           2. 25-Client Atomic Selection Race Test
             /---------\
            / Sec Rules \         3. Granular Firestore & Storage RLS Negative Tests
           /-------------\
          / Widget Tests  \       4. Flutter Form & State Notifier Tests
         /-----------------\
        /    Unit Tests     \     5. Domain Rules, Adapters, Enums, Time Interval Checks
       /---------------------\
```

---

## 2. Acceptance Matrix & Test Proofs

| Category | Requirement / Invariant | Test Proof Command | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **Security Rules** | Doctor A cannot read Doctor B's private applications or profile. | `npm --prefix functions run test:rules` | HTTP 403 / Firestore Permission Denied. |
| **Security Rules** | Hospital A cannot read or mutate Hospital B's duties. | `npm --prefix functions run test:rules` | HTTP 403 / Firestore Permission Denied. |
| **Security Rules** | Client cannot write directly to `assignments` or `auditLogs`. | `npm --prefix functions run test:rules` | HTTP 403 / Firestore Permission Denied. |
| **Concurrency** | 25 simultaneous selection attempts on a single-slot duty. | `npm --prefix functions run test:concurrency` | Exactly 1 success, 24 HTTP 409 conflicts, 0 overbooking. |
| **Double-Booking** | Selecting a doctor for two overlapping shifts concurrently. | `npm --prefix functions run test:concurrency` | Conflicting interval fails transaction atomically. |
| **Lifecycle E2E** | Full loop: Doctor Auth $\rightarrow$ Verify $\rightarrow$ Hospital Post $\rightarrow$ Apply $\rightarrow$ Select $\rightarrow$ Confirm $\rightarrow$ Start $\rightarrow$ Complete $\rightarrow$ Feedback. | `npm --prefix functions run test:e2e` | 100% automated step completion with immutable audit records. |
| **Flutter Units** | Normalization, phone validator, DTO serialization, Riverpod state. | `flutter test` | All test assertions pass. |
