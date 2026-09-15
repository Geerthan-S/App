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
import '../../auth/data/auth_repository.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
              Text('Security & Preferences', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
              const SizedBox(height: AppSpacing.sm),
              AppCard(
                child: Column(
                  children: [
                    _buildSettingTile(
                      icon: Icons.shield_outlined,
                      title: 'App Integrity Status',
                      subtitle: 'Play Integrity Active (Production Mode)',
                      trailing: const Icon(Icons.check_circle_rounded, color: AppColors.emerald, size: 20),
                    ),
                    const Divider(),
                    _buildSettingTile(
                      icon: Icons.notifications_none_rounded,
                      title: 'Urgent Duty Push Alerts',
                      subtitle: 'Transactional SMS & FCM notifications',
                      trailing: Switch(value: true, onChanged: (_) {}),
                    ),
                    const Divider(),
                    _buildSettingTile(
                      icon: Icons.description_outlined,
                      title: 'Terms of Use & Integrity Charter',
                      subtitle: 'Version v1.0_2026',
                      trailing: const Icon(Icons.arrow_forward_ios_rounded, color: AppColors.textLightMuted, size: 16),
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
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget trailing,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, color: AppColors.primary, size: 22),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppTypography.labelBold(AppColors.textLightPrimary)),
                Text(subtitle, style: AppTypography.bodySmall(AppColors.textLightMuted)),
              ],
            ),
          ),
          trailing,
        ],
      ),
    );
  }
}
