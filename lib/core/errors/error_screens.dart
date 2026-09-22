/**
 * Full-Page Error Screens
 *
 * These are top-level pages (as opposed to the inline [ErrorView] in
 * state_views.dart) shown when navigation, rendering, connectivity, or a
 * requested resource breaks:
 *  - [NotFoundScreen]: an unknown/invalid route was requested (GoRouter
 *    `errorBuilder`).
 *  - [AppErrorScreen]: a widget threw while building, so Flutter has
 *    nothing valid to render in its place (`ErrorWidget.builder`).
 *  - [NoConnectionScreen]: the device has no network connectivity
 *    (see core/widgets/connectivity_gate.dart).
 *  - [ContentNotFoundScreen]: the route matched, but the resource it
 *    needed (a duty post, a conversation) is missing or was deleted.
 */

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_typography.dart';
import '../design_system/app_spacing.dart';
import '../design_system/app_buttons.dart';

class _ErrorScaffold extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String message;
  final String? detail;
  final String actionLabel;
  final VoidCallback onAction;

  const _ErrorScaffold({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.message,
    required this.actionLabel,
    required this.onAction,
    this.detail,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: AppSpacing.paddingScreen,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 88,
                  height: 88,
                  decoration: BoxDecoration(
                    color: iconColor.withOpacity(0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, color: iconColor, size: 40),
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: AppTypography.headingMedium(colors.textPrimary),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: AppTypography.bodyMedium(colors.textSecondary),
                ),
                if (detail != null && kDebugMode) ...[
                  const SizedBox(height: AppSpacing.md),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(AppSpacing.sm),
                    decoration: BoxDecoration(
                      color: colors.surfaceElevated,
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                      border: Border.all(color: colors.border),
                    ),
                    child: Text(
                      detail!,
                      style: AppTypography.bodySmall(colors.textMuted),
                    ),
                  ),
                ],
                const SizedBox(height: AppSpacing.xl),
                AppButton(
                  label: actionLabel,
                  isFullWidth: false,
                  onPressed: onAction,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown by GoRouter when the requested location doesn't match any route
/// (typo'd deep link, stale bookmark, removed screen, etc).
class NotFoundScreen extends StatelessWidget {
  final String? attemptedPath;

  const NotFoundScreen({super.key, this.attemptedPath});

  @override
  Widget build(BuildContext context) {
    return _ErrorScaffold(
      icon: Icons.signpost_outlined,
      iconColor: AppColors.amber,
      title: "Page Not Found",
      message: attemptedPath != null && attemptedPath!.isNotEmpty
          ? "We couldn't find '$attemptedPath'. It may have been moved or no longer exists."
          : "We couldn't find the page you were looking for.",
      actionLabel: 'Go to Home',
      onAction: () => context.go('/home'),
    );
  }
}

/// Shown wherever a widget throws while building — the app-wide
/// replacement for Flutter's default "red screen of death", wired via
/// `ErrorWidget.builder` in main.dart.
class AppErrorScreen extends StatelessWidget {
  final FlutterErrorDetails? details;

  const AppErrorScreen({super.key, this.details});

  @override
  Widget build(BuildContext context) {
    return _ErrorScaffold(
      icon: Icons.error_outline_rounded,
      iconColor: AppColors.rose,
      title: 'Something Went Wrong',
      message: 'This screen ran into a problem. You can head back to home and try again.',
      detail: details?.exceptionAsString(),
      actionLabel: 'Go to Home',
      onAction: () => context.go('/home'),
    );
  }
}

/// Shown app-wide in place of the current screen whenever the device has
/// no network connectivity, via [ConnectivityGate] wrapping the router.
class NoConnectionScreen extends StatelessWidget {
  final VoidCallback onRetry;

  const NoConnectionScreen({super.key, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return _ErrorScaffold(
      icon: Icons.wifi_off_rounded,
      iconColor: AppColors.textDarkMuted,
      title: 'No Internet Connection',
      message: "You're offline. Check your connection and try again.",
      actionLabel: 'Retry',
      onAction: onRetry,
    );
  }
}

/// Shown when a route resolves but the resource it points to (a duty post,
/// a conversation, a review list) is missing — deleted, expired, filled,
/// or reached through a stale link — as opposed to [NotFoundScreen], which
/// is for an unregistered route.
class ContentNotFoundScreen extends StatelessWidget {
  final String title;
  final String message;
  final IconData icon;
  final String actionLabel;
  final VoidCallback onAction;

  const ContentNotFoundScreen({
    super.key,
    this.title = 'Not Found',
    this.message = 'This content may have been removed or is no longer available.',
    this.icon = Icons.search_off_rounded,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return _ErrorScaffold(
      icon: icon,
      iconColor: AppColors.teal,
      title: title,
      message: message,
      actionLabel: actionLabel,
      onAction: onAction,
    );
  }
}
