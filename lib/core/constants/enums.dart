/**
 * Canonical Domain Enumerations
 * Healthcare Workforce Platform
 */

enum UserRole {
  doctor,
  hospitalStaff,
  verifier,
  supportAdmin,
  superAdmin,
}

enum DutyStatus {
  draft,
  published,
  paused,
  filled,
  inProgress,
  completed,
  closed,
  cancelled,
}

enum ApplicationStatus {
  submitted,
  shortlisted,
  selected,
  rejected,
  withdrawn,
  expired,
}

enum AssignmentStatus {
  selected,
  confirmed,
  inProgress,
  completed,
  replaced,
  cancelled,
  disputed,
  closed,
}

enum VerificationStatus {
  draft,
  submitted,
  underReview,
  needsInformation,
  approved,
  rejected,
  expired,
  suspended,
}

enum PaymentAckStatus {
  pending,
  acknowledged,
  disputed,
}

enum ShiftType {
  morning,
  evening,
  night,
  fullDay,
}

extension DutyStatusExtension on DutyStatus {
  String get nameString {
    switch (this) {
      case DutyStatus.draft: return 'draft';
      case DutyStatus.published: return 'published';
      case DutyStatus.paused: return 'paused';
      case DutyStatus.filled: return 'filled';
      case DutyStatus.inProgress: return 'in_progress';
      case DutyStatus.completed: return 'completed';
      case DutyStatus.closed: return 'closed';
      case DutyStatus.cancelled: return 'cancelled';
    }
  }

  static DutyStatus fromString(String val) {
    switch (val) {
      case 'published': return DutyStatus.published;
      case 'paused': return DutyStatus.paused;
      case 'filled': return DutyStatus.filled;
      case 'in_progress': return DutyStatus.inProgress;
      case 'completed': return DutyStatus.completed;
      case 'closed': return DutyStatus.closed;
      case 'cancelled': return DutyStatus.cancelled;
      default: return DutyStatus.draft;
    }
  }
}

extension ApplicationStatusExtension on ApplicationStatus {
  String get nameString {
    switch (this) {
      case ApplicationStatus.submitted: return 'submitted';
      case ApplicationStatus.shortlisted: return 'shortlisted';
      case ApplicationStatus.selected: return 'selected';
      case ApplicationStatus.rejected: return 'rejected';
      case ApplicationStatus.withdrawn: return 'withdrawn';
      case ApplicationStatus.expired: return 'expired';
    }
  }

  static ApplicationStatus fromString(String val) {
    switch (val) {
      case 'shortlisted': return ApplicationStatus.shortlisted;
      case 'selected': return ApplicationStatus.selected;
      case 'rejected': return ApplicationStatus.rejected;
      case 'withdrawn': return ApplicationStatus.withdrawn;
      case 'expired': return ApplicationStatus.expired;
      default: return ApplicationStatus.submitted;
    }
  }
}

extension VerificationStatusExtension on VerificationStatus {
  String get nameString {
    switch (this) {
      case VerificationStatus.draft: return 'draft';
      case VerificationStatus.submitted: return 'submitted';
      case VerificationStatus.underReview: return 'under_review';
      case VerificationStatus.needsInformation: return 'needs_information';
      case VerificationStatus.approved: return 'approved';
      case VerificationStatus.rejected: return 'rejected';
      case VerificationStatus.expired: return 'expired';
      case VerificationStatus.suspended: return 'suspended';
    }
  }

  static VerificationStatus fromString(String val) {
    switch (val) {
      case 'submitted': return VerificationStatus.submitted;
      case 'under_review': return VerificationStatus.underReview;
      case 'needs_information': return VerificationStatus.needsInformation;
      case 'approved': return VerificationStatus.approved;
      case 'rejected': return VerificationStatus.rejected;
      case 'expired': return VerificationStatus.expired;
      case 'suspended': return VerificationStatus.suspended;
      default: return VerificationStatus.draft;
    }
  }
}
