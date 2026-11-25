/**
 * Typed Error Envelope & Domain Failures
 */

import 'package:cloud_functions/cloud_functions.dart';

class AppFailure {
  final String code;
  final String message;
  final String? correlationId;
  final Map<String, List<String>>? fieldErrors;
  final int? retryAfter;

  const AppFailure({
    required this.code,
    required this.message,
    this.correlationId,
    this.fieldErrors,
    this.retryAfter,
  });

  factory AppFailure.fromMap(Map<String, dynamic> map) {
    return AppFailure(
      code: map['code'] as String? ?? 'INTERNAL_ERROR',
      message: map['message'] as String? ?? 'An unexpected error occurred',
      correlationId: map['correlationId'] as String?,
      retryAfter: map['retryAfter'] as int?,
      fieldErrors: (map['fieldErrors'] as Map<String, dynamic>?)?.map(
        (key, value) => MapEntry(key, List<String>.from(value as List)),
      ),
    );
  }

  factory AppFailure.network() {
    return const AppFailure(
      code: 'NETWORK_ERROR',
      message: 'Unable to connect to healthcare network. Please check your connection.',
    );
  }

  factory AppFailure.auth(String message) {
    return AppFailure(
      code: 'AUTH_REQUIRED',
      message: message,
    );
  }

  @override
  String toString() => 'AppFailure($code: $message [corr: $correlationId])';
}

/// Callable failures carry the server's domain code (e.g. `OFFER_EXPIRED`) in
/// `details.code`; `code` itself is the transport status (e.g. `deadline-exceeded`).
extension DomainErrorCode on FirebaseFunctionsException {
  String get domainCode {
    final d = details;
    if (d is Map && d['code'] is String) return d['code'] as String;
    return code;
  }
}
