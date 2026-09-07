/**
 * Structured Logger with Strict PII Scrubbing
 */

import 'package:flutter/foundation.dart';

class AppLogger {
  static void info(String message, {String? correlationId, Map<String, dynamic>? data}) {
    _log('INFO', message, correlationId: correlationId, data: data);
  }

  static void warn(String message, {String? correlationId, Map<String, dynamic>? data}) {
    _log('WARN', message, correlationId: correlationId, data: data);
  }

  static void error(String message, {dynamic error, StackTrace? stackTrace, String? correlationId}) {
    if (kDebugMode) {
      debugPrint('🚨 [ERROR] $message (corr: $correlationId) Error: $error');
      if (stackTrace != null) {
        debugPrint(stackTrace.toString());
      }
    }
  }

  static void _log(String level, String message, {String? correlationId, Map<String, dynamic>? data}) {
    if (kDebugMode) {
      final sanitizedData = data != null ? _sanitize(data) : null;
      debugPrint('[$level] $message ${correlationId != null ? "(corr: $correlationId)" : ""} ${sanitizedData ?? ""}');
    }
  }

  /// PII Sanitizer: Redacts phone numbers, passwords, tokens, and registration certificates
  static Map<String, dynamic> _sanitize(Map<String, dynamic> input) {
    final copy = Map<String, dynamic>.from(input);
    final sensitiveKeys = ['phone', 'phoneNumber', 'token', 'password', 'otp', 'certificate'];

    for (final key in copy.keys) {
      if (sensitiveKeys.any((s) => key.toLowerCase().contains(s))) {
        copy[key] = '[REDACTED]';
      } else if (copy[key] is Map<String, dynamic>) {
        copy[key] = _sanitize(copy[key] as Map<String, dynamic>);
      }
    }
    return copy;
  }
}
