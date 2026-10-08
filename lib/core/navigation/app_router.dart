/**
 * Application GoRouter Configuration with Auth & Role Routing
 */

import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'main_scaffold.dart';
import 'onboarding_gate.dart';
import '../logging/app_logger.dart';
import '../errors/error_screens.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/otp_screen.dart';
import '../../features/auth/presentation/consent_screen.dart';
import '../../features/onboarding/presentation/role_selection_screen.dart';
import '../../features/doctor_profile/presentation/doctor_onboarding_screen.dart';
import '../../features/doctor_profile/presentation/doctor_profile_screen.dart';
import '../../features/doctor_profile/presentation/hospital_info_screen.dart';
import '../../features/doctor_profile/presentation/reviews_screen.dart';
import '../../features/verification/presentation/verification_center_screen.dart';
import '../../features/duty_marketplace/presentation/duty_marketplace_screen.dart';
import '../../features/duty_details/presentation/duty_details_screen.dart';
import '../../features/duty_post_details/presentation/duty_post_details_screen.dart';
import '../../features/hospital/presentation/hospital_dashboard_screen.dart';
import '../../features/hospital/presentation/hospital_profile_screen.dart';
import '../../features/hospital/presentation/create_duty_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/settings/presentation/settings_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/search/presentation/search_screen.dart';
import '../../features/add_post/presentation/add_post_screen.dart';
import '../../features/messages/presentation/messages_screen.dart';
import '../../features/messages/presentation/chat_screen.dart';

final GlobalKey<NavigatorState> _rootNavigatorKey = GlobalKey<NavigatorState>();

/// Bridges a [Stream] into a [Listenable] so GoRouter re-evaluates its
/// `redirect` callback whenever Firebase's auth state changes.
class GoRouterRefreshStream extends ChangeNotifier {
  GoRouterRefreshStream(Stream<dynamic> stream) {
    notifyListeners();
    _subscription = stream.listen((_) => notifyListeners());
  }

  late final StreamSubscription<dynamic> _subscription;

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}

final appRouter = GoRouter(
  navigatorKey: _rootNavigatorKey,
  initialLocation: '/login',
  refreshListenable: GoRouterRefreshStream(FirebaseAuth.instance.authStateChanges()),
  errorBuilder: (context, state) => NotFoundScreen(attemptedPath: state.uri.toString()),
  redirect: (context, state) async {
    final user = FirebaseAuth.instance.currentUser;
    final location = state.matchedLocation;
    final isLoggingIn = location == '/login';
    // '/otp' is reached mid phone-verification, before Firebase has signed
    // the user in, so it must stay reachable without an active session.
    final isPublicRoute = isLoggingIn || location == '/otp';

    if (user == null) {
      OnboardingGate.reset();
      return isPublicRoute ? null : '/login';
    }

    // Signed-in users resume onboarding from server-owned state: nothing past
    // the consent screen is reachable until the current consent is recorded.
    bool consented;
    try {
      consented = await OnboardingGate.hasCurrentConsent(user.uid);
    } catch (e, st) {
      // Callables enforce consent server-side regardless; do not trap the user
      // on a screen when the state cannot be read (e.g. offline).
      AppLogger.error('Could not read onboarding state', error: e, stackTrace: st);
      return isLoggingIn ? '/home' : null;
    }
    if (!consented) {
      return location == '/consent' ? null : '/consent';
    }
    if (isLoggingIn || location == '/otp') {
      return '/home';
    }
    return null;
  },
  routes: [
    GoRoute(
      path: '/login',
      builder: (context, state) => const LoginScreen(),
    ),
    GoRoute(
      path: '/otp',
      builder: (context, state) {
        final extra = state.extra as Map<String, String>;
        return OtpScreen(
          phoneNumber: extra['phoneNumber']!,
          verificationId: extra['verificationId']!,
        );
      },
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
      builder: (context, state) {
        final duty = state.extra;
        if (duty is! Map<String, dynamic>) {
          return ContentNotFoundScreen(
            title: 'Duty Not Found',
            message: 'This duty may have been filled, removed, or is no longer available.',
            icon: Icons.event_busy_outlined,
            actionLabel: 'Back to Marketplace',
            onAction: () => context.go('/marketplace'),
          );
        }
        return DutyDetailsScreen(duty: duty);
      },
    ),
    GoRoute(
      path: '/post-details',
      builder: (context, state) {
        final duty = state.extra;
        if (duty is! Map<String, dynamic>) {
          return ContentNotFoundScreen(
            title: 'Post Not Found',
            message: 'This post may have been removed by its author or is no longer available.',
            icon: Icons.article_outlined,
            actionLabel: 'Back to Home',
            onAction: () => context.go('/home'),
          );
        }
        return DutyPostDetailsScreen(duty: duty);
      },
    ),
    GoRoute(
      path: '/chat',
      builder: (context, state) {
        final conversation = state.extra;
        if (conversation is! Map<String, dynamic>) {
          return ContentNotFoundScreen(
            title: 'Conversation Not Found',
            message: 'This conversation may have been deleted or is no longer available.',
            icon: Icons.forum_outlined,
            actionLabel: 'Back to Messages',
            onAction: () => context.go('/messages'),
          );
        }
        return ChatScreen(conversation: conversation);
      },
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
    GoRoute(
      path: '/hospital-info',
      builder: (context, state) {
        final extra = state.extra;
        final orgId = extra is Map<String, dynamic> ? extra['organizationId'] as String? : null;
        return HospitalInfoScreen(organizationId: orgId);
      },
    ),
    GoRoute(
      path: '/reviews',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>;
        return ReviewsScreen(
          title: extra['title'] as String,
          reviews: extra['reviews'] as List<Map<String, dynamic>>,
        );
      },
    ),

    // Duty marketplace screens remain fully intact and reachable by direct
    // path; they are no longer part of the bottom navigation shell below.
    GoRoute(
      path: '/marketplace',
      builder: (context, state) => const DutyMarketplaceScreen(),
    ),
    // The former local-only demo screens for applications and assignments
    // were retired; offers and duties are handled by the persisted workflow
    // in My Duties, so old links land there.
    GoRoute(
      path: '/applications',
      redirect: (context, state) => '/messages',
    ),
    GoRoute(
      path: '/assignments',
      redirect: (context, state) => '/messages',
    ),

    // Stateful Nested Shell for Main Bottom Navigation
    // Home / Search / Add Post / Messages / Profile
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) => MainScaffold(navigationShell: navigationShell),
      branches: [
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/home',
              builder: (context, state) => const HomeScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/search',
              builder: (context, state) => const SearchScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/add-post',
              builder: (context, state) => const AddPostScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/messages',
              builder: (context, state) => const MessagesScreen(),
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
