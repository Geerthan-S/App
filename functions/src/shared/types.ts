/**
 * Canonical Domain Types and Enums
 * Healthcare Workforce Platform
 */

export type UserRole = 'doctor' | 'hospital_staff' | 'verifier' | 'support_admin' | 'super_admin';

export type UserStatus = 'active' | 'suspended' | 'deleted';

export type DutyStatus = 
  | 'draft' 
  | 'published' 
  | 'paused' 
  | 'filled' 
  | 'in_progress' 
  | 'completed' 
  | 'closed' 
  | 'cancelled';

export type ApplicationStatus = 
  | 'submitted' 
  | 'shortlisted' 
  | 'selected' 
  | 'rejected' 
  | 'withdrawn' 
  | 'expired';

export type AssignmentStatus = 
  | 'selected' 
  | 'confirmed' 
  | 'in_progress' 
  | 'completed' 
  | 'replaced' 
  | 'cancelled' 
  | 'disputed' 
  | 'closed';

export type VerificationStatus = 
  | 'draft' 
  | 'submitted' 
  | 'under_review' 
  | 'needs_information' 
  | 'approved' 
  | 'rejected' 
  | 'expired' 
  | 'suspended';

export type OutboxStatus = 'pending' | 'leased' | 'delivered' | 'failed' | 'dead_letter';

export type PaymentAckStatus = 'pending' | 'acknowledged' | 'disputed';

export interface TimeRange {
  startAt: string; // ISO-8601 UTC
  endAt: string;   // ISO-8601 UTC
}

export interface PaymentTerms {
  amount: number;
  currency: string;
  basis: 'per_shift' | 'per_hour';
  expectedPaymentTiming: 'end_of_shift' | 'within_24_hours' | 'weekly';
}

export interface ScheduleInterval {
  assignmentId: string;
  dutyId: string;
  startAt: string;
  endAt: string;
  status: AssignmentStatus;
}
