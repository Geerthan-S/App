// Crash reporting with PII scrubbing (blueprint §9.4, §9.6).
//
// Crashlytics collects only in release builds against the live project. No
// user identifier is attached, and every message is scrubbed of email
// addresses, phone-like digit runs and long tokens before it leaves the device.

import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';

class CrashReporting {
  CrashReporting._();

  static bool _enabled = false;

  static final _email = RegExp(r'[\w.+-]+@[\w-]+(\.[\w-]+)+');
  static final _digits = RegExp(r'\+?\d[\d\s-]{6,}\d');
  static final _token = RegExp(r'[A-Za-z0-9_\-]{32,}');

  /// Removes personal data and secrets from text sent to crash reporting.
  @visibleForTesting
  static String scrub(String input) => input
      .replaceAll(_email, '[email]')
      .replaceAll(_token, '[token]')
      .replaceAll(_digits, '[number]');

  /// Turns collection on for release builds only. Safe to call when Firebase
  /// failed to start: errors are swallowed and reporting stays off.
  static Future<void> init({required bool usingEmulator}) async {
    if (kDebugMode || usingEmulator) return;
    try {
      await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(true);
      _enabled = true;
    } catch (_) {
      _enabled = false;
    }
  }

  /// Records a scrubbed copy of the error; the original object is never sent.
  static void record(Object error, StackTrace? stack, {String? reason, bool fatal = false}) {
    if (!_enabled) return;
    FirebaseCrashlytics.instance.recordError(
      scrub(error.toString()),
      stack,
      reason: reason == null ? null : scrub(reason),
      fatal: fatal,
    );
  }
}
