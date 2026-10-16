import 'package:flutter/foundation.dart';

/// Local Firebase Emulator Suite access only; never enabled in release builds.
class LocalTestConfig {
  static const enabled =
      kDebugMode &&
      bool.fromEnvironment('LOCAL_TEST_LOGIN', defaultValue: false);
  static const projectId = 'demo-healthforce';
  static const email = 'tester@healthforce.example';
  // Disposable emulator fixture, never a credential for the live project.
  static const password = 'local-emulator-fixture-only';
  /// The Android emulator reaches the host machine at 10.0.2.2; a browser
  /// build runs on the host itself.
  static const host = kIsWeb ? '127.0.0.1' : '10.0.2.2';
}
