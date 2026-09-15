/**
 * Authentication — Professional Consent & Privacy Notice
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';

class ConsentScreen extends ConsumerWidget {
  const ConsentScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Terms & Privacy'),
      ),
      body: SafeArea(
        child: Padding(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Healthcare Integrity Consent',
                style: AppTypography.headingLarge(AppColors.textLightPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Please review our professional operational terms before selecting your role.',
                style: AppTypography.bodyMedium(AppColors.textLightSecondary),
              ),
              const SizedBox(height: AppSpacing.lg),
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    children: [
                      AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '1. Verified Medical Identity',
                              style: AppTypography.headingSmall(AppColors.textLightPrimary),
                            ),
                            const SizedBox(height: AppSpacing.xs),
                            Text(
                              'All doctors must hold active, valid registration with the National Medical Commission (NMC) or relevant State Medical Council. False claims result in permanent revocation.',
                              style: AppTypography.bodyMedium(AppColors.textLightSecondary),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '2. Atomic Shift Contract',
                              style: AppTypography.headingSmall(AppColors.textLightPrimary),
                            ),
                            const SizedBox(height: AppSpacing.xs),
                            Text(
                              'Confirmed duty shifts represent binding operational commitments. Contact details are released strictly after mutual confirmation.',
                              style: AppTypography.bodyMedium(AppColors.textLightSecondary),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '3. Privacy & Clinical Record Policy',
                              style: AppTypography.headingSmall(AppColors.textLightPrimary),
                            ),
                            const SizedBox(height: AppSpacing.xs),
                            Text(
                              'This platform is strictly for duty staffing coordination. No patient clinical records, diagnoses, or prescriptions are stored or processed.',
                              style: AppTypography.bodyMedium(AppColors.textLightSecondary),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              AppButton(
                label: 'I Accept & Agree',
                onPressed: () => context.go('/role-selection'),
              ),
              const SizedBox(height: AppSpacing.xs),
            ],
          ),
        ),
      ),
    );
  }
}
