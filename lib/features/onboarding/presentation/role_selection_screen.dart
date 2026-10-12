/**
 * Onboarding — Role Selection Screen (Doctor vs Hospital Staff)
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/ui_kit.dart';

class RoleSelectionScreen extends ConsumerWidget {
  const RoleSelectionScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.appColors;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Choose Account Type'),
      ),
      body: SafeArea(
        child: Padding(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'How will you use HealthForce?',
                style: AppTypography.headingLarge(colors.textPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Select your primary operational role on the platform.',
                style: AppTypography.bodyMedium(colors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.xl),
              AppCard(
                onTap: () => context.go('/doctor-onboarding'),
                child: Row(
                  children: [
                    const IconTile(icon: Icons.medical_services_outlined, size: 52),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Licensed Doctor / Consultant',
                            style: AppTypography.headingSmall(colors.textPrimary),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Find verified hospital duties, shifts, and immediate on-demand coverage.',
                            style: AppTypography.bodySmall(colors.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.chevron_right_outlined, color: colors.textMuted, size: 20),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              AppCard(
                onTap: () => context.go('/hospital-dashboard'),
                child: Row(
                  children: [
                    const IconTile(icon: Icons.local_hospital_outlined, size: 52, iconColor: AppColors.teal, background: Color(0x142A9D8F)),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Hospital / Clinic Coordinator',
                            style: AppTypography.headingSmall(colors.textPrimary),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Post genuine duty requirements, review verified doctors, and assign atomically.',
                            style: AppTypography.bodySmall(colors.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.chevron_right_outlined, color: colors.textMuted, size: 20),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
