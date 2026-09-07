/**
 * Application GoRouter Configuration with Auth & Role Routing
 */

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'main_scaffold.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/otp_screen.dart';
import '../../features/auth/presentation/consent_screen.dart';
import '../../features/onboarding/presentation/role_selection_screen.dart';
import '../../features/doctor_profile/presentation/doctor_onboarding_screen.dart';
import '../../features/doctor_profile/presentation/doctor_profile_screen.dart';
import '../../features/verification/presentation/verification_center_screen.dart';
import '../../features/duty_marketplace/presentation/duty_marketplace_screen.dart';
import '../../features/duty_details/presentation/duty_details_screen.dart';
import '../../features/applications/presentation/applications_screen.dart';
import '../../features/assignments/presentation/assignments_screen.dart';
import '../../features/hospital/presentation/hospital_dashboard_screen.dart';
import '../../features/hospital/presentation/hospital_profile_screen.dart';
import '../../features/hospital/presentation/create_duty_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/settings/presentation/settings_screen.dart';

final GlobalKey<NavigatorState> _rootNavigatorKey = GlobalKey<NavigatorState>();

final appRouter = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/login',
  routes: [
    GoRoute(
      path: '/login',
      builder: (context, state) => const LoginScreen(),
    ),
    GoRoute(
      path: '/otp',
      builder: (context, state) => OtpScreen(phoneNumber: state.extra as String? ?? '+91 9876543210'),
    ),
    GoRoute(
      path: '/consent',
      builder: (context, state) => const ConsentScreen(),
    ),
    GoRoute(
      path: '/role-selection',
      builder: (context, state) => const RoleSelectionScreen(),
    ),
    GoRoute(
      path: '/doctor-onboarding',
      builder: (context, state) => const DoctorOnboardingScreen(),
    ),
    GoRoute(
      path: '/hospital-dashboard',
      builder: (context, state) => const HospitalDashboardScreen(),
    ),
    GoRoute(
      path: '/hospital-profile',
      builder: (context, state) => const HospitalProfileScreen(),
    ),
    GoRoute(
      path: '/create-duty',
      builder: (context, state) => const CreateDutyScreen(),
    ),
    GoRoute(
      path: '/duty-details',
      builder: (context, state) => DutyDetailsScreen(duty: state.extra as Map<String, dynamic>),
    ),
    GoRoute(
      path: '/verification',
      builder: (context, state) => const VerificationCenterScreen(),
    ),
    GoRoute(
      path: '/notifications',
      builder: (context, state) => const NotificationsScreen(),
    ),
    GoRoute(
      path: '/settings',
      builder: (context, state) => const SettingsScreen(),
    ),

    // Stateful Nested Shell for Doctor Bottom Navigation
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) => MainScaffold(navigationShell: navigationShell),
      branches: [
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/marketplace',
              builder: (context, state) => const DutyMarketplaceScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/applications',
              builder: (context, state) => const ApplicationsScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/assignments',
              builder: (context, state) => const AssignmentsScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/profile',
              builder: (context, state) => const DoctorProfileScreen(),
            ),
          ],
        ),
      ],
    ),
  ],
);
