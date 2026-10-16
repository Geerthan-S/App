// Account rights, devices and notification preferences (blueprint §8.5, §11).
//
// Every call goes through a callable: the server owns deletion, export and
// preference validation, and audits each request.

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import '../../../core/config/backend_config.dart';

/// The server's message for a failed callable, or a generic fallback.
String callableErrorMessage(Object error, [String fallback = 'Something went wrong. Try again.']) {
  if (error is FirebaseFunctionsException) {
    final details = error.details;
    final code = details is Map ? details['code'] : null;
    if (code == 'STEP_UP_REQUIRED') {
      return 'For your safety, sign out and sign back in, then try again within 10 minutes.';
    }
    if (error.message != null && error.message!.isNotEmpty) return error.message!;
  }
  return fallback;
}

class AccountRepository {
  static Future<Map<String, dynamic>> _call(String name, [Map<String, dynamic>? data]) async {
    final result = await BackendConfig.functions.httpsCallable(name).call<Map<String, dynamic>>(data ?? {});
    return Map<String, dynamic>.from(result.data);
  }

  // ── Data rights ─────────────────────────────────────────

  static Future<Map<String, dynamic>> exportMyData() => _call('exportMyData');

  static Future<void> submitPrivacyRequest({required String type, required String details}) =>
      _call('submitPrivacyRequest', {'type': type, 'details': details});

  static Future<void> deleteMyAccount() => _call('deleteMyAccount', {'confirm': 'DELETE'});

  // ── Devices ─────────────────────────────────────────────

  static Future<List<Map<String, dynamic>>> listMyDevices() async {
    String? token;
    try {
      token = await FirebaseMessaging.instance.getToken();
    } catch (_) {
      token = null; // Still list devices; this one just is not marked.
    }
    final data = await _call('listMyDevices', {if (token != null) 'currentToken': token});
    return (data['devices'] as List? ?? []).map((d) => Map<String, dynamic>.from(d as Map)).toList();
  }

  static Future<int> signOutEverywhere() async {
    final data = await _call('signOutEverywhere');
    return (data['devicesSignedOut'] as num?)?.toInt() ?? 0;
  }

  // ── Notification preferences ────────────────────────────

  static Future<NotificationPreferences> getNotificationPreferences() async {
    final data = await _call('getNotificationPreferences');
    return NotificationPreferences.fromMap(Map<String, dynamic>.from(data['preferences'] as Map));
  }

  static Future<void> updateNotificationPreferences(NotificationPreferences prefs) =>
      _call('updateNotificationPreferences', prefs.toMap());
}

class NotificationPreferences {
  /// Categories the server understands; critical alerts ignore mutes and quiet hours.
  static const categories = {
    'applications': ('Applications', 'Applicants, shortlists and selections'),
    'duty_alerts': ('Duty alerts', 'Saved-search matches and duty changes'),
    'verification': ('Verification', 'Review decisions and appeals'),
    'team': ('Team', 'Invitations and hospital team changes'),
  };

  final Set<String> muted;
  final bool quietEnabled;
  final String quietStart;
  final String quietEnd;

  const NotificationPreferences({
    required this.muted,
    required this.quietEnabled,
    required this.quietStart,
    required this.quietEnd,
  });

  factory NotificationPreferences.fromMap(Map<String, dynamic> map) {
    final quiet = Map<String, dynamic>.from(map['quietHours'] as Map? ?? {});
    return NotificationPreferences(
      muted: {...(map['mutedCategories'] as List? ?? []).cast<String>()},
      quietEnabled: quiet['enabled'] == true,
      quietStart: quiet['start'] as String? ?? '22:00',
      quietEnd: quiet['end'] as String? ?? '07:00',
    );
  }

  NotificationPreferences copyWith({Set<String>? muted, bool? quietEnabled, String? quietStart, String? quietEnd}) =>
      NotificationPreferences(
        muted: muted ?? this.muted,
        quietEnabled: quietEnabled ?? this.quietEnabled,
        quietStart: quietStart ?? this.quietStart,
        quietEnd: quietEnd ?? this.quietEnd,
      );

  Map<String, dynamic> toMap() => {
        'mutedCategories': muted.toList(),
        'quietHours': {'enabled': quietEnabled, 'start': quietStart, 'end': quietEnd},
      };
}
