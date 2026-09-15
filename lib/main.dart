/**
 * Healthcare Workforce Platform — Application Entry Point
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';
import 'core/design_system/app_theme.dart';
import 'core/navigation/app_router.dart';
import 'core/logging/app_logger.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    AppLogger.info('Firebase initialized successfully for com.geerthan.healthcareworkforce');
  } catch (e, st) {
    AppLogger.error('Firebase initialization skipped or failed in offline preview mode', error: e, stackTrace: st);
  }

  runApp(
    const ProviderScope(
      child: HealthcareWorkforceApp(),
    ),
  );
}

class HealthcareWorkforceApp extends StatelessWidget {
  const HealthcareWorkforceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'HealthForce',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      routerConfig: appRouter,
    );
  }
}
