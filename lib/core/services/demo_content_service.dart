// Asks the server to add this user's sample content (chats, offers, inbox) for
// the client review. The server does nothing unless an admin has turned the
// demo workspace on, and seeds each user and each hospital only once.

import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import '../config/backend_config.dart';
import '../logging/app_logger.dart';

class DemoContentService {
  DemoContentService._();

  static StreamSubscription<User?>? _authSub;

  static void start() {
    _authSub ??= FirebaseAuth.instance.authStateChanges().listen((user) {
      if (user != null) unawaited(ensure());
    });
  }

  /// Safe to call often; failures never block the app.
  static Future<void> ensure() async {
    try {
      await BackendConfig.functions.httpsCallable('ensureDemoContent').call<Map<String, dynamic>>(<String, dynamic>{});
    } catch (e) {
      AppLogger.warn('Sample content was not added', data: {'error': '$e'});
    }
  }
}
