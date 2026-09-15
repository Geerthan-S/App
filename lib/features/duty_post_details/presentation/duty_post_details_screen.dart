/**
 * Duty Post Details Screen
 * Shown between a Home/Search recommendation and Chat: Home/Search →
 * Duty Details → Chat. Reuses the same duty map (MockData.duties schema)
 * already used by DutyPostCard — no new data model.
 */

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/mock_data.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/status_badge.dart';

class DutyPostDetailsScreen extends StatelessWidget {
  final Map<String, dynamic> duty;

  const DutyPostDetailsScreen({super.key, required this.duty});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: Text('Duty Details', style: AppTypography.headingMedium(AppColors.textLightPrimary)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Hospital / Clinic + duty type header
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: AppColors.primary.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                          ),
                          child: const Icon(Icons.local_hospital_rounded, color: AppColors.primary, size: 26),
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
                                      duty['facilityName'] as String,
                                      style: AppTypography.headingSmall(AppColors.textLightPrimary),
                                    ),
                                  ),
                                  if (duty['isVerifiedOrg'] == true) ...[
                                    const SizedBox(width: 4),
                                    const Icon(Icons.verified_rounded, color: AppColors.emerald, size: 18),
                                  ],
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                duty['specialtyName'] as String,
                                style: AppTypography.bodyMedium(AppColors.textLightSecondary),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        StatusBadge(status: duty['status'] as String),
                        const SizedBox(width: AppSpacing.sm),
                        const Icon(Icons.location_on_outlined, size: 14, color: AppColors.textLightMuted),
                        const SizedBox(width: 2),
                        Text(
                          '${duty['city']} • ${duty['distanceKm']} km away',
                          style: AppTypography.bodySmall(AppColors.textLightMuted),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              Text('Schedule & Compensation', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Column(
                  children: [
                    _buildRow('Duty Type', duty['shiftType'] as String),
                    const Divider(),
                    _buildRow('Department', duty['department'] as String),
                    const Divider(),
                    _buildRow('Starts', duty['startAt'] as String),
                    const Divider(),
                    _buildRow('Ends', duty['endAt'] as String),
                    const Divider(),
                    _buildRow('Compensation', '₹${duty['amount']} (${duty['basis']})', valueColor: AppColors.emerald),
                    const Divider(),
                    _buildRow('Open Positions', '${duty['remainingHeadcount']} of ${duty['headcount']}'),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              Text('Description', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Text(
                  '${duty['shiftType']} covering ${duty['department']} at ${duty['facilityName']}, ${duty['city']}.',
                  style: AppTypography.bodyMedium(AppColors.textLightSecondary),
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              Text('Requirements / Qualifications', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Row(
                  children: [
                    const Icon(Icons.school_outlined, color: AppColors.primaryLight, size: 20),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        duty['qualificationRequired'] as String,
                        style: AppTypography.bodyMedium(AppColors.textLightPrimary),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),

              AppButton(
                label: 'Interested / Chat',
                icon: Icons.chat_bubble_outline_rounded,
                onPressed: () => context.push('/chat', extra: MockData.conversationForDuty(duty)),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: AppTypography.bodyMedium(AppColors.textLightMuted)),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: AppTypography.labelBold(valueColor ?? AppColors.textLightPrimary),
            ),
          ),
        ],
      ),
    );
  }
}
