// Push notification device registration.
//
// Tokens are registered through the `registerDeviceToken` callable, which owns
// the `deviceTokens` collection server-side (the outbox worker reads it). The
// last outcome is exposed through [status] so the UI can show and retry a
// failed registration instead of silently losing notifications.

import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import '../logging/app_logger.dart';

enum PushRegistrationStatus { unknown, registered, permissionDenied, failed }

class PushRegistrationService {
  PushRegistrationService._();

  static final ValueNotifier<PushRegistrationStatus> status =
      ValueNotifier(PushRegistrationStatus.unknown);

  static String? _registeredToken;
  static StreamSubscription<User?>? _authSub;
  static StreamSubscription<String>? _refreshSub;

  /// Registers on every sign-in and whenever FCM rotates the token.
  static void start() {
    _authSub ??= FirebaseAuth.instance.authStateChanges().listen((user) {
      if (user != null) unawaited(register());
    });
    _refreshSub ??= FirebaseMessaging.instance.onTokenRefresh.listen((token) {
      if (FirebaseAuth.instance.currentUser != null) unawaited(register(token: token));
    });
  }

  static Future<void> register({String? token}) async {
    try {
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        status.value = PushRegistrationStatus.permissionDenied;
        return;
      }
      final fcmToken = token ?? await FirebaseMessaging.instance.getToken();
      if (fcmToken == null) throw StateError('FCM returned no device token');
      await FirebaseFunctions.instance
          .httpsCallable('registerDeviceToken')
          .call<Map<String, dynamic>>({'token': fcmToken, 'platform': 'android'});
      _registeredToken = fcmToken;
      status.value = PushRegistrationStatus.registered;
    } catch (e, st) {
      status.value = PushRegistrationStatus.failed;
      AppLogger.error(
        'Push registration failed; this device will not receive notifications until it succeeds',
        error: e,
        stackTrace: st,
      );
    }
  }

  /// Must run while still signed in, so the server can verify token ownership.
  static Future<void> unregister() async {
    try {
      final token = _registeredToken ?? await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      await FirebaseFunctions.instance
          .httpsCallable('unregisterDeviceToken')
          .call<Map<String, dynamic>>({'token': token, 'platform': 'android'});
    } catch (e, st) {
      AppLogger.error('Push unregistration failed during sign-out', error: e, stackTrace: st);
    } finally {
      _registeredToken = null;
      status.value = PushRegistrationStatus.unknown;
    }
  }
}
