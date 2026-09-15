/**
 * Hospital Info Screen
 * Read-only profile of the hospital/clinic a doctor is associated with.
 * Uses MockData.hospitalProfile — sample data until a real hospital
 * directory backend exists.
 */

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/mock_data.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';

class HospitalInfoScreen extends StatelessWidget {
  const HospitalInfoScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    const hospital = MockData.hospitalProfile;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text('Hospital Profile', style: AppTypography.headingMedium(colors.textPrimary)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(
                            color: AppColors.primary.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                          ),
                          child: const Icon(Icons.local_hospital_rounded, color: AppColors.primary, size: 28),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      hospital['name'] as String,
                                      style: AppTypography.headingSmall(colors.textPrimary),
                                    ),
                                  ),
                                  if (hospital['isVerified'] == true) ...[
                                    const SizedBox(width: 4),
                                    const Icon(Icons.verified_rounded, color: AppColors.emerald, size: 18),
                                  ],
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                hospital['orgType'] as String,
                                style: AppTypography.bodySmall(colors.textSecondary),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        const Icon(Icons.star_rounded, color: AppColors.amber, size: 18),
                        const SizedBox(width: 4),
                        Text(
                          '${hospital['rating']} rating',
                          style: AppTypography.labelBold(colors.textPrimary),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              Text('About', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Text(
                  hospital['about'] as String,
                  style: AppTypography.bodyMedium(colors.textSecondary),
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              Text('Contact & Location', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Column(
                  children: [
                    _infoRow(colors, Icons.location_on_outlined, hospital['address'] as String),
                    const Divider(),
                    _infoRow(colors, Icons.call_outlined, hospital['phone'] as String),
                    const Divider(),
                    _infoRow(colors, Icons.location_city_outlined, hospital['city'] as String),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.reviews_outlined, size: 18),
                  label: const Text('View Hospital Reviews'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primaryLight,
                    side: BorderSide(color: colors.border),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: () => context.push(
                    '/reviews',
                    extra: {
                      'title': 'Hospital Reviews',
                      'reviews': MockData.hospitalReviews,
                    },
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }

  Widget _infoRow(AppColorsExtension colors, IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, color: AppColors.primaryLight, size: 20),
          const SizedBox(width: AppSpacing.sm),
          Expanded(child: Text(text, style: AppTypography.bodyMedium(colors.textPrimary))),
        ],
      ),
    );
  }
}
