/**
 * Verification Domain Models
 * Structured types for Doctor Medical Registration Verification
 */

enum VerificationOutcome {
  match,
  mismatch,
  notFound,
  sourceUnavailable,
  manualReviewRequired,
  verificationError,
}

class ComparisonField {
  final String field;
  final String submitted;
  final String official;
  final bool isMatch;
  final String? notes;

  ComparisonField({
    required this.field,
    required this.submitted,
    required this.official,
    required this.isMatch,
    this.notes,
  });

  factory ComparisonField.fromMap(Map<String, dynamic> map) {
    return ComparisonField(
      field: map['field'] as String? ?? '',
      submitted: map['submitted'] as String? ?? '',
      official: map['official'] as String? ?? '',
      isMatch: map['isMatch'] as bool? ?? false,
      notes: map['notes'] as String?,
    );
  }
}

class VerificationResult {
  final String outcome;
  final bool isAutoApprovable;
  final int confidenceScore;
  final String? discrepancySummary;
  final List<ComparisonField> fieldComparisons;
  final Map<String, dynamic>? officialRecord;
  final String caseStatus;

  VerificationResult({
    required this.outcome,
    required this.isAutoApprovable,
    required this.confidenceScore,
    this.discrepancySummary,
    required this.fieldComparisons,
    this.officialRecord,
    required this.caseStatus,
  });

  factory VerificationResult.fromMap(Map<String, dynamic> map) {
    final rawFields = (map['fieldComparisons'] as List?) ?? [];
    return VerificationResult(
      outcome: map['outcome'] as String? ?? 'MANUAL_REVIEW_REQUIRED',
      isAutoApprovable: map['isAutoApprovable'] as bool? ?? false,
      confidenceScore: (map['confidenceScore'] as num?)?.toInt() ?? 0,
      discrepancySummary: map['discrepancies'] as String?,
      fieldComparisons: rawFields.map((f) => ComparisonField.fromMap(Map<String, dynamic>.from(f as Map))).toList(),
      officialRecord: map['officialRecord'] as Map<String, dynamic>?,
      caseStatus: map['caseStatus'] as String? ?? 'submitted',
    );
  }
}
