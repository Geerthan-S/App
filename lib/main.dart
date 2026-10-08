/**
 * Healthcare Workforce Platform — Application Entry Point
 */

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'core/config/local_test_config.dart';
import 'firebase_options.dart';
import 'core/design_system/app_theme.dart';
import 'core/design_system/theme_provider.dart';
import 'core/navigation/app_router.dart';
import 'core/logging/app_logger.dart';
import 'core/errors/error_screens.dart';
import 'core/widgets/connectivity_gate.dart';
import 'core/services/push_registration_service.dart';

Future<void> initializeFirebaseServices() async {
  await Firebase.initializeApp(
    options: LocalTestConfig.enabled
        ? const FirebaseOptions(
            apiKey: 'local-emulator-only',
            appId: '1:123456789:android:localtest',
            messagingSenderId: '123456789',
            projectId: LocalTestConfig.projectId,
            storageBucket: 'demo-healthforce.appspot.com',
          )
        : DefaultFirebaseOptions.currentPlatform,
  );
  if (LocalTestConfig.enabled) {
    await FirebaseAuth.instance.useAuthEmulator(LocalTestConfig.host, 9099);
    FirebaseFirestore.instance.useFirestoreEmulator(LocalTestConfig.host, 8080);
    FirebaseFunctions.instance.useFunctionsEmulator(LocalTestConfig.host, 5001);
    await FirebaseStorage.instance.useStorageEmulator(
      LocalTestConfig.host,
      9199,
    );
  } else {
    await FirebaseAppCheck.instance.activate(
      androidProvider: kDebugMode ? AndroidProvider.debug : AndroidProvider.playIntegrity,
    );
  }
}

void main() {
  runZonedGuarded(
    () async {
      WidgetsFlutterBinding.ensureInitialized();

      try {
        await initializeFirebaseServices();
        AppLogger.info(
          'Firebase initialized successfully for com.geerthan.healthcareworkforce',
        );

        // Register this device for push on every sign-in and token rotation.
        PushRegistrationService.start();
      } catch (e, st) {
        AppLogger.error(
          'Firebase initialization skipped or failed in offline preview mode',
          error: e,
          stackTrace: st,
        );
      }

      // Route widget build failures to the app-wide error page instead of
      // Flutter's default "red screen of death" so a broken page always
      // shows something the user can act on.
      ErrorWidget.builder = (FlutterErrorDetails details) {
        AppLogger.error(
          'Widget build failed',
          error: details.exception,
          stackTrace: details.stack,
        );
        return AppErrorScreen(details: details);
      };

      // Log framework errors that Flutter would otherwise only print to the
      // console, so failures during a build/layout/paint pass are captured.
      FlutterError.onError = (FlutterErrorDetails details) {
        FlutterError.presentError(details);
        AppLogger.error(
          'Uncaught Flutter error',
          error: details.exception,
          stackTrace: details.stack,
        );
      };

      // Catch errors from outside the Flutter framework (async gaps, platform
      // channels) that FlutterError.onError never sees.
      PlatformDispatcher.instance.onError = (error, stackTrace) {
        AppLogger.error(
          'Uncaught platform error',
          error: error,
          stackTrace: stackTrace,
        );
        return true;
      };

      runApp(const ProviderScope(child: HealthcareWorkforceApp()));
    },
    (error, stackTrace) {
      AppLogger.error(
        'Uncaught zone error',
        error: error,
        stackTrace: stackTrace,
      );
    },
  );
}

class HealthcareWorkforceApp extends ConsumerWidget {
  const HealthcareWorkforceApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    return MaterialApp.router(
      title: 'HealthForce',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: themeMode,
      routerConfig: appRouter,
      builder: (context, child) =>
          ConnectivityGate(child: child ?? const SizedBox.shrink()),
    );
  }
}
