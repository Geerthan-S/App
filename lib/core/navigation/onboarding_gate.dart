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
}
