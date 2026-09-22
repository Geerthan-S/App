/**
 * Healthcare Workforce Platform — Application Entry Point
 */

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';
import 'core/design_system/app_theme.dart';
import 'core/design_system/theme_provider.dart';
import 'core/navigation/app_router.dart';
import 'core/logging/app_logger.dart';
import 'core/errors/error_screens.dart';
import 'core/widgets/connectivity_gate.dart';

void main() {
  runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();

    try {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
      AppLogger.info('Firebase initialized successfully for com.geerthan.healthcareworkforce');
    } catch (e, st) {
      AppLogger.error('Firebase initialization skipped or failed in offline preview mode', error: e, stackTrace: st);
    }

    // Route widget build failures to the app-wide error page instead of
    // Flutter's default "red screen of death" so a broken page always
    // shows something the user can act on.
    ErrorWidget.builder = (FlutterErrorDetails details) {
      AppLogger.error('Widget build failed', error: details.exception, stackTrace: details.stack);
      return AppErrorScreen(details: details);
    };

    // Log framework errors that Flutter would otherwise only print to the
    // console, so failures during a build/layout/paint pass are captured.
    FlutterError.onError = (FlutterErrorDetails details) {
      FlutterError.presentError(details);
      AppLogger.error('Uncaught Flutter error', error: details.exception, stackTrace: details.stack);
    };

    // Catch errors from outside the Flutter framework (async gaps, platform
    // channels) that FlutterError.onError never sees.
    PlatformDispatcher.instance.onError = (error, stackTrace) {
      AppLogger.error('Uncaught platform error', error: error, stackTrace: stackTrace);
      return true;
    };

    runApp(
      const ProviderScope(
        child: HealthcareWorkforceApp(),
      ),
    );
  }, (error, stackTrace) {
    AppLogger.error('Uncaught zone error', error: error, stackTrace: stackTrace);
  });
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
      builder: (context, child) => ConnectivityGate(child: child ?? const SizedBox.shrink()),
    );
  }
}
