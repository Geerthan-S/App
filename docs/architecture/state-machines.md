# Platform State Machines & Lifecycle Invariants

This document establishes the canonical state machines for the Healthcare Workforce Platform. Every transition is strictly enforced server-side inside Cloud Functions.

---

## 1. Duty Lifecycle State Machine

A Duty represents a hospital's demand for healthcare workforce staffing. It is completely independent of individual applicant assignments.

```mermaid
stateDiagram-v2
    [*] --> draft : Hospital creates draft
    draft --> published : Hospital publishes (verified org + valid future schedule)
    published --> paused : Hospital pauses intake
    paused --> published : Hospital resumes intake
    published --> filled : All headcount assigned
    filled --> in_progress : Shift start time reached
    published --> in_progress : Partial shift starts at scheduled time
    in_progress --> completed : Shift end time reached / confirmed
    completed --> closed : Post-duty administrative closure
    draft --> cancelled : Hospital cancels
    published --> cancelled : Hospital cancels
    paused --> cancelled : Hospital cancels
    cancelled --> [*]
    closed --> [*]
```

### Duty Transitions & Guards
| From | Action | To | Guard / Actor |
| :--- | :--- | :--- | :--- |
| `draft` | `publish` | `published` | Hospital staff with active org membership; org is `approved`; `startAt` is in the future; `headcount > 0`. |
| `published` | `pause` | `paused` | Hospital staff pauses applications temporarily. |
| `paused` | `resume` | `published` | Hospital staff resumes intake. |
| `published` | `assign_headcount` | `filled` | Remaining headcount reaches `0`. |
| `published` / `filled` | `start_shift` | `in_progress` | Time policy or manual start by hospital coordinator. |
| `in_progress` | `complete_shift` | `completed` | Shift ends. Attendance and completion recorded. **Feedback and payment ack are non-blocking optional post-duty workflows.** |
| `completed` | `close_duty` | `closed` | Final closure. |
| `draft` / `published` / `paused` | `cancel_duty` | `cancelled` | Hospital cancels with reason code. Notifies active applicants. |

---

## 2. Doctor Application State Machine

An Application represents a doctor's expression of interest in a specific duty. It is uniquely keyed by `dutyId + doctorId`.

```mermaid
stateDiagram-v2
    [*] --> submitted : Doctor applies (creates snapshot)
    submitted --> shortlisted : Hospital shortlists candidate
    submitted --> rejected : Hospital rejects candidate
    submitted --> withdrawn : Doctor withdraws prior to selection
    shortlisted --> selected : Hospital selects doctor (Atomic Lock)
    shortlisted --> rejected : Hospital rejects candidate
    shortlisted --> withdrawn : Doctor withdraws
    selected --> confirmed : Doctor accepts offer within expiry
    selected --> expired : Expiry deadline elapses without acceptance
    selected --> rejected : Hospital revokes offer before acceptance
    confirmed --> [*]
    rejected --> [*]
    withdrawn --> [*]
    expired --> [*]
```

### Application Transitions & Guards
| From | Action | To | Guard / Actor |
| :--- | :--- | :--- | :--- |
| `[*]` | `apply` | `submitted` | Doctor is verified; duty is `published` with `remainingHeadcount > 0`; no prior active application for this duty. Creates immutable `applicationSnapshots`. |
| `submitted` | `shortlist` | `shortlisted` | Hospital staff belonging to duty's organization. |
| `submitted` / `shortlisted` | `reject` | `rejected` | Hospital staff with rejection category. |
| `submitted` / `shortlisted` | `withdraw` | `withdrawn` | Doctor withdraws before selection. |
| `submitted` / `shortlisted` | `select` | `selected` | Hospital staff selects candidate inside `atomicSelectDoctor` transaction. Creates assignment offer with `expiresAt`. |
| `selected` | `confirm` | `confirmed` | Doctor accepts offer before `expiresAt`. |
| `selected` | `expire` | `expired` | Expiry deadline reached without doctor confirmation. Releases headcount back to duty. |

---

## 3. Assignment Lifecycle State Machine

An Assignment represents the contractual execution of a duty by a specific confirmed doctor.

```mermaid
stateDiagram-v2
    [*] --> selected : Created on hospital selection (Offer state)
    selected --> confirmed : Doctor accepts offer (Releases contactGrant)
    selected --> cancelled : Offer revoked or expired
    confirmed --> in_progress : Shift start check-in recorded
    confirmed --> cancelled : Cancellation before start
    in_progress --> completed : Shift completion recorded
    in_progress --> disputed : Issue raised during shift
    completed --> closed : Post-duty finalization
    completed --> disputed : Post-duty dispute opened
    disputed --> closed : Dispute resolved by support/admin
    cancelled --> replaced : [Phase 2] Replacement requested & assigned
    cancelled --> [*]
    closed --> [*]
    replaced --> [*]
```

### Assignment Transitions & Guards
| From | Action | To | Guard / Actor |
| :--- | :--- | :--- | :--- |
| `selected` | `accept_offer` | `confirmed` | Selected doctor accepts before `expiresAt`. Creates active `contactGrants` for both sides. |
| `selected` | `decline_or_expire` | `cancelled` | Doctor declines or offer expires. Headcount restored on duty. |
| `confirmed` | `start_shift` | `in_progress` | Doctor check-in or hospital coordinator handoff. |
| `in_progress` | `complete_shift` | `completed` | Attendance verified, shift finish recorded. |
| `completed` | `close` | `closed` | Assignment closed. Optional feedback/payment acknowledgement recorded. |
| Any active | `raise_dispute` | `disputed` | Either party opens a formal dispute with evidence. |

---

## 4. Doctor & Organization Verification State Machine

```mermaid
stateDiagram-v2
    [*] --> draft : User creates profile & uploads draft evidence
    draft --> submitted : User submits verification case
    submitted --> under_review : Verifier claims case from queue
    under_review --> needs_information : Verifier requests additional proof
    needs_information --> submitted : User uploads requested documents & resubmits
    under_review --> approved : Official registry / check matches. Sets isVerified = true
    under_review --> rejected : Discrepancy found or criteria not met
    approved --> expired : Annual / periodic reverification interval elapses
    approved --> suspended : Moderation or safety intervention
    rejected --> appealed : [Phase 2] Doctor files formal appeal
    appealed --> approved : Appeal upheld
    appealed --> rejected : Appeal rejected
```
