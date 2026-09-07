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

class RoleSelectionScreen extends ConsumerWidget {
  const RoleSelectionScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
                style: AppTypography.headingLarge(AppColors.textDarkPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Select your primary operational role on the platform.',
                style: AppTypography.bodyMedium(AppColors.textDarkSecondary),
              ),
              const SizedBox(height: AppSpacing.xl),
              AppCard(
                onTap: () => context.go('/doctor-onboarding'),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                      ),
                      child: const Icon(Icons.medical_services_rounded, color: AppColors.primary, size: 32),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Licensed Doctor / Consultant',
                            style: AppTypography.headingSmall(AppColors.textDarkPrimary),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Find verified hospital duties, shifts, and immediate on-demand coverage.',
                            style: AppTypography.bodySmall(AppColors.textDarkSecondary),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.arrow_forward_ios_rounded, color: AppColors.textDarkMuted, size: 16),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              AppCard(
                onTap: () => context.go('/hospital-dashboard'),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.teal.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                      ),
                      child: const Icon(Icons.local_hospital_rounded, color: AppColors.teal, size: 32),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Hospital / Clinic Coordinator',
                            style: AppTypography.headingSmall(AppColors.textDarkPrimary),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Post genuine duty requirements, review verified doctors, and assign atomically.',
                            style: AppTypography.bodySmall(AppColors.textDarkSecondary),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.arrow_forward_ios_rounded, color: AppColors.textDarkMuted, size: 16),
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
