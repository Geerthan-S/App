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
import 'ui_kit.dart';

class DutyPostCard extends StatelessWidget {
  final Map<String, dynamic> duty;

  const DutyPostCard({super.key, required this.duty});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final specialty = duty['specialtyName'] as String? ?? '';
    final department = duty['department'] as String? ?? '';
    final city = duty['city'] as String? ?? '';
    final distance = duty['distanceKm'];
    final remaining = duty['remainingHeadcount'] ?? 1;
    final shiftType = duty['shiftType'] as String?;

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      onTap: () => context.push('/duty-details', extra: duty),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const IconTile(icon: Icons.local_hospital_outlined, size: 48),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            duty['facilityName'] as String? ?? '—',
                            style: AppTypography.headingSmall(colors.textPrimary),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (duty['isVerifiedOrg'] == true) ...[
                          const SizedBox(width: 4),
                          const Icon(Icons.verified_outlined, color: AppColors.emerald, size: 16),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [specialty, department].where((s) => s.isNotEmpty).join(' · '),
                      style: AppTypography.bodySmall(colors.accent).copyWith(fontWeight: FontWeight.w500),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              // Feeds only list published duties, so the badge is shown only
              // when a duty is in some other state.
              if ((duty['status'] as String? ?? 'published') != 'published') ...[
                const SizedBox(width: AppSpacing.xs),
                StatusBadge(status: duty['status'] as String),
              ],
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.xs,
            runSpacing: AppSpacing.xs,
            children: [
              if (shiftType != null && shiftType.isNotEmpty)
                InfoChip(icon: Icons.schedule_outlined, label: shiftType),
              InfoChip(
                icon: Icons.location_on_outlined,
                label: distance != null ? '$city · $distance km' : (city.isEmpty ? 'Location TBA' : city),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Icon(Icons.calendar_today_outlined, size: 14, color: colors.textMuted),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${duty['startAt']}  →  ${duty['endAt']}',
                  style: AppTypography.bodySmall(colors.textSecondary),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            child: Divider(color: colors.border, height: 1),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: formatInr(duty['amount']),
                      style: AppTypography.headingSmall(colors.textPrimary).copyWith(fontSize: 16, fontWeight: FontWeight.w700),
                    ),
                    TextSpan(
                      text: ' / ${basisLabel(duty['basis'])}',
                      style: AppTypography.bodySmall(colors.textMuted),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              Text(
                '$remaining ${remaining == 1 ? 'slot' : 'slots'} open',
                style: AppTypography.bodySmall(AppColors.emerald).copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(width: 4),
              Icon(Icons.chevron_right_outlined, size: 18, color: colors.textMuted),
            ],
          ),
        ],
      ),
    );
  }
}
