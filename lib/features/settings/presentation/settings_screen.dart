/**
 * App Settings & Session Management Screen
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/theme_provider.dart';
import '../../../core/widgets/theme_selector_dialog.dart';
import '../../auth/data/auth_repository.dart';
import '../../../core/services/push_registration_service.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.appColors;
    final themeMode = ref.watch(themeModeProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings & Security'),
      ),
      body: SafeArea(
        child: Padding(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Security & Preferences', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.sm),
              AppCard(
                child: Column(
                  children: [
                    _buildSettingTile(
                      colors: colors,
                      icon: Icons.shield_outlined,
                      title: 'App Integrity Status',
                      subtitle: 'Play Integrity Active (Production Mode)',
                      trailing: const Icon(Icons.check_circle_rounded, color: AppColors.emerald, size: 20),
                    ),
                    Divider(color: colors.border),
                    _buildSettingTile(
                      colors: colors,
                      icon: Icons.notifications_none_rounded,
                      title: 'Urgent Duty Push Alerts',
                      subtitle: 'Transactional SMS & FCM notifications',
                      trailing: Switch(value: true, onChanged: (_) {}),
                    ),
                    Divider(color: colors.border),
                    _buildSettingTile(
                      colors: colors,
                      icon: Icons.brightness_6_outlined,
                      title: 'Theme',
                      subtitle: themeModeLabel(themeMode),
                      trailing: Icon(Icons.arrow_forward_ios_rounded, color: colors.textMuted, size: 16),
                      onTap: () => ThemeSelectorDialog.show(context),
                    ),
                    Divider(color: colors.border),
                    ValueListenableBuilder<PushRegistrationStatus>(
                      valueListenable: PushRegistrationService.status,
                      builder: (context, status, _) => _buildSettingTile(
                        colors: colors,
                        icon: Icons.notifications_active_outlined,
                        title: 'Push Notifications',
                        subtitle: switch (status) {
                          PushRegistrationStatus.registered => 'This device is registered',
                          PushRegistrationStatus.permissionDenied => 'Blocked in system settings',
                          PushRegistrationStatus.failed => 'Registration failed — tap to retry',
                          PushRegistrationStatus.unknown => 'Not registered yet — tap to register',
                        },
                        trailing: Icon(
                          status == PushRegistrationStatus.registered
                              ? Icons.check_circle_rounded
                              : Icons.refresh_rounded,
                          color: status == PushRegistrationStatus.registered ? AppColors.emerald : colors.textMuted,
                          size: 18,
                        ),
                        onTap: status == PushRegistrationStatus.registered
                            ? null
                            : () => PushRegistrationService.register(),
                      ),
                    ),
                    Divider(color: colors.border),
                    _buildSettingTile(
                      colors: colors,
                      icon: Icons.description_outlined,
                      title: 'Terms of Use & Integrity Charter',
                      subtitle: 'Version v1.0_2026',
                      trailing: Icon(Icons.arrow_forward_ios_rounded, color: colors.textMuted, size: 16),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.rose,
                    side: const BorderSide(color: AppColors.rose),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: () async {
                    await AuthRepository().signOut();
                    if (context.mounted) context.go('/login');
                  },
                  child: const Text('Sign Out of Account', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSettingTile({
    required AppColorsExtension colors,
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget trailing,
    VoidCallback? onTap,
  }) {
    final tile = Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, color: colors.accent, size: 22),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppTypography.labelBold(colors.textPrimary)),
                Text(subtitle, style: AppTypography.bodySmall(colors.textMuted)),
              ],
            ),
          ),
          trailing,
        ],
      ),
    );

    if (onTap == null) return tile;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      child: tile,
    );
  }
}
