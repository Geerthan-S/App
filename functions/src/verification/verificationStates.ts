/** Verification case states that are still open for evidence, submission or review. */
export const ACTIVE_CASE_STATUSES = ['draft', 'submitted', 'under_review', 'needs_information'];

/** Case states a verifier may decide. */
export const REVIEWABLE_CASE_STATUSES = ['submitted', 'under_review', 'needs_information'];

/** Decided or retired cases. Evidence uploaded against them is never trusted. */
export const CLOSED_CASE_STATUSES = ['approved', 'rejected', 'expired', 'suspended', 'superseded'];
