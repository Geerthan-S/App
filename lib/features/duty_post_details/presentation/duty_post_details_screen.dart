import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
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
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text('Duty Details', style: AppTypography.headingMedium(colors.textPrimary)),
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
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: AppColors.primary.withValues(alpha: 0.12),
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
                                      duty['facilityName'] as String? ?? '—',
                                      style: AppTypography.headingSmall(colors.textPrimary),
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
                                duty['specialtyName'] as String? ?? '—',
                                style: AppTypography.bodyMedium(colors.textSecondary),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        StatusBadge(status: duty['status'] as String? ?? 'published'),
                        const SizedBox(width: AppSpacing.sm),
                        Icon(Icons.location_on_outlined, size: 14, color: colors.textMuted),
                        const SizedBox(width: 2),
                        Text(
                          duty['city'] as String? ?? '',
                          style: AppTypography.bodySmall(colors.textMuted),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              Text('Schedule & Compensation', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Column(
                  children: [
                    _buildRow(colors, 'Department', duty['department'] as String? ?? '—'),
                    const Divider(),
                    _buildRow(colors, 'Starts', duty['startAt'] as String? ?? '—'),
                    const Divider(),
                    _buildRow(colors, 'Ends', duty['endAt'] as String? ?? '—'),
                    const Divider(),
                    _buildRow(colors, 'Compensation', '₹${duty['amount']} / ${duty['basis'] ?? 'shift'}', valueColor: AppColors.emerald),
                    const Divider(),
                    _buildRow(colors, 'Open Positions', '${duty['remainingHeadcount'] ?? 1} of ${duty['headcount'] ?? 1}'),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              Text('Requirements', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Row(
                  children: [
                    const Icon(Icons.school_outlined, color: AppColors.primaryLight, size: 20),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        duty['qualificationRequired'] as String? ?? '—',
                        style: AppTypography.bodyMedium(colors.textPrimary),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),

              AppButton(
                label: 'Apply for this Duty',
                icon: Icons.send_rounded,
                onPressed: () => context.push('/duty-details', extra: duty),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRow(AppColorsExtension colors, String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: AppTypography.bodyMedium(colors.textMuted)),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: AppTypography.labelBold(valueColor ?? colors.textPrimary),
            ),
          ),
        ],
      ),
    );
  }
}
