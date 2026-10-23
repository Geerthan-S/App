/**
 * App Settings & Session Management Screen
 */

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/theme_provider.dart';
import '../../../core/localization/language_provider.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/widgets/theme_selector_dialog.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../auth/data/auth_repository.dart';
import '../../../core/services/push_registration_service.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.appColors;
    final themeMode = ref.watch(themeModeProvider);
    final language = ref.watch(localizationProvider);

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: const Text('Settings')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.gutter,
            8,
            AppSpacing.gutter,
            AppSpacing.lg,
          ),
          children: [
            const GroupLabel('Preferences'),
            RowGroup(
              children: [
                ListRow(
                  icon: Icons.contrast_outlined,
                  title: 'Theme',
                  subtitle: themeModeLabel(themeMode),
                  onTap: () => ThemeSelectorDialog.show(context),
                ),
                ListRow(
                  icon: Icons.translate_outlined,
                  title: 'Language',
                  subtitle: language.translate('languageName'),
                  onTap: () => LanguageSelectorDialog.show(context),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),

            const GroupLabel('Notifications'),
            RowGroup(
              children: [
                ValueListenableBuilder<PushRegistrationStatus>(
                  valueListenable: PushRegistrationService.status,
                  builder: (context, status, _) => ListRow(
                    icon: Icons.notifications_none_outlined,
                    title: 'Push notifications',
                    subtitle: switch (status) {
                      PushRegistrationStatus.registered =>
                        'This device is registered',
                      PushRegistrationStatus.permissionDenied =>
                        'Blocked in system settings',
                      PushRegistrationStatus.failed =>
                        'Registration failed — tap to retry',
                      PushRegistrationStatus.unknown =>
                        'Not registered yet — tap to register',
                    },
                    trailing: status == PushRegistrationStatus.registered
                        ? const Icon(
                            Icons.check_circle_outline,
                            color: AppColors.emerald,
                            size: 20,
                          )
                        : Icon(
                            Icons.refresh_outlined,
                            color: colors.textMuted,
                            size: 20,
                          ),
                    onTap: status == PushRegistrationStatus.registered
                        ? null
                        : () => PushRegistrationService.register(),
                  ),
                ),
                ListRow(
                  icon: Icons.tune_outlined,
                  title: 'Notification preferences',
                  subtitle: 'Mute categories and set quiet hours',
                  onTap: () => context.push('/notification-preferences'),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),

            const GroupLabel('Security'),
            RowGroup(
              children: [
                ListRow(
                  icon: Icons.verified_user_outlined,
                  title: 'Council verification',
                  subtitle: 'Registration documents and review status',
                  onTap: () => context.push('/verification'),
                ),
                ListRow(
                  icon: Icons.devices_outlined,
                  title: 'Devices',
                  subtitle: 'Where you are signed in; sign out everywhere',
                  onTap: () => context.push('/devices'),
                ),
                // Reflects the App Check provider activated in main.dart.
                // Server-side enforcement is configured separately.
                const ListRow(
                  icon: Icons.shield_outlined,
                  title: 'App integrity',
                  subtitle: kDebugMode
                      ? 'App Check debug provider (development build)'
                      : 'App Check with Play Integrity',
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),

            const GroupLabel('Account'),
            RowGroup(
              children: [
                ListRow(
                  icon: Icons.mail_outline,
                  title: 'Hospital invitations',
                  subtitle: 'Join a hospital team you were invited to',
                  onTap: () => context.push('/invitations'),
                ),
                ListRow(
                  icon: Icons.privacy_tip_outlined,
                  title: 'Your data',
                  subtitle: 'Download, correct or delete your data',
                  onTap: () => context.push('/privacy'),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),

            const GroupLabel('Legal'),
            const RowGroup(
              children: [
                ListRow(
                  icon: Icons.description_outlined,
                  title: 'Terms of Use & Integrity Charter',
                  subtitle: 'Version v1.0_2026',
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xl),

            AppSecondaryButton(
              label: 'Sign out',
              icon: Icons.logout_outlined,
              foregroundColor: AppColors.rose,
              onPressed: () async {
                await AuthRepository().signOut();
                if (context.mounted) context.go('/login');
              },
            ),
          ],
        ),
      ),
    );
  }
}
