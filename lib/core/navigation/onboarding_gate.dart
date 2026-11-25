import 'package:cloud_firestore/cloud_firestore.dart';
import '../constants/app_constants.dart';

/// Server-owned onboarding state used by the router. Consent is recorded only
/// by the `recordConsent` callable, so `users/{uid}.consentVersion` is the
/// source of truth for whether a signed-in user may leave the consent screen.
class OnboardingGate {
  OnboardingGate._();

  static String? _consentedUid;

  static Future<bool> hasCurrentConsent(String uid) async {
    if (_consentedUid == uid) return true;
    final user = await FirebaseFirestore.instance.collection('users').doc(uid).get();
    final consented = user.data()?['consentVersion'] == AppConstants.currentConsentVersion;
    if (consented) _consentedUid = uid;
    return consented;
  }

  /// Called after the server acknowledged consent, avoiding a stale cache read.
  static void markConsented(String uid) => _consentedUid = uid;

  static void reset() => _consentedUid = null;

  /// Where a signed-in, consented user starts: hospital staff on the hospital
  /// dashboard, doctors on Home, and anyone without a role on role selection.
  static Future<String> landingFor(String uid) async {
    final db = FirebaseFirestore.instance;
    final results = await Future.wait([
      db.collection('users').doc(uid).get(),
      db.collection('doctors').doc(uid).get(),
    ]);
    final user = results[0].data() ?? const <String, dynamic>{};
    final orgIds = user['organizationIds'];
    final isHospitalMember = orgIds is List && orgIds.isNotEmpty;
    final isDoctor = results[1].exists;
    if (isHospitalMember && (user['activeRole'] == 'hospital_staff' || !isDoctor)) return '/hospital-dashboard';
    if (isDoctor) return '/home';
    return '/role-selection';
  }
}
