/**
 * Duty Post Card
 * Shared recommendation/result tile for a duty post — used by Home and Search.
 * Tapping opens the Duty Details screen, which then leads into chat.
 */

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_typography.dart';
import '../design_system/app_spacing.dart';
import '../design_system/app_cards.dart';
import 'status_badge.dart';

class DutyPostCard extends StatelessWidget {
  final Map<String, dynamic> duty;

  const DutyPostCard({super.key, required this.duty});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return AppCard(
      onTap: () => context.push('/duty-details', extra: duty),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                ),
                child: const Icon(Icons.local_hospital_rounded, color: AppColors.primary, size: 24),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            duty['facilityName'] as String,
                            style: AppTypography.headingSmall(colors.textPrimary),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (duty['isVerifiedOrg'] == true) ...[
                          const SizedBox(width: 4),
                          const Icon(Icons.verified_rounded, color: AppColors.emerald, size: 16),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${duty['specialtyName']} • ${duty['city']}',
                      style: AppTypography.bodySmall(colors.textMuted),
                    ),
                  ],
                ),
              ),
              StatusBadge(status: duty['status'] as String),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: colors.surfaceElevated,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            ),
            child: Row(
              children: [
                Icon(Icons.access_time_rounded, size: 14, color: colors.textMuted),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    '${duty['startAt']} - ${duty['endAt']}',
                    style: AppTypography.bodySmall(colors.textSecondary),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(
                  '₹${duty['amount']} / shift',
                  style: AppTypography.labelBold(AppColors.emerald),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Row(
            children: [
              Icon(Icons.location_on_outlined, size: 14, color: colors.textMuted),
              const SizedBox(width: 4),
              Text(
                duty['distanceKm'] != null ? '${duty['distanceKm']} km away' : duty['city'] as String? ?? '',
                style: AppTypography.bodySmall(colors.textMuted),
              ),
              const Spacer(),
              Text(
                '${duty['remainingHeadcount']} slot open',
                style: AppTypography.bodySmall(AppColors.amber),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
