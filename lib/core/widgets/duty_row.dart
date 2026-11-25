/**
 * Duty Row
 * Shared list row for a duty — used by Home, Search and the Marketplace.
 * Date on the left, hospital / specialty / timing in the middle, pay on the
 * right. Rows are flat and separated by dividers (see [DutyList]); tapping
 * opens Duty Details.
 */

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_typography.dart';
import '../design_system/app_spacing.dart';
import 'status_badge.dart';
import 'ui_kit.dart';

class DutyRow extends StatelessWidget {
  final Map<String, dynamic> duty;

  const DutyRow({super.key, required this.duty});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final specialty = duty['specialtyName'] as String? ?? '';
    final city = duty['city'] as String? ?? '';
    final distance = duty['distanceKm'];
    final remaining = (duty['remainingHeadcount'] as num?)?.toInt() ?? 1;
    final status = duty['status'] as String? ?? 'published';
    final details = [
      shiftTimingLabel(duty),
      if (city.isNotEmpty) city,
      if (distance != null) '$distance km',
    ].where((s) => s.isNotEmpty).join(' · ');

    return InkWell(
      onTap: () => context.push('/duty-details', extra: duty),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DateBlock(date: parseIsoLocal(duty['startAtIso'])),
            const SizedBox(width: 14),
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
                        const SizedBox(width: 5),
                        const VerifiedMark(size: 14),
                      ],
                    ],
                  ),
                  const SizedBox(height: 3),
                  if (specialty.isNotEmpty)
                    Text(
                      specialty,
                      style: AppTypography.bodySmall(
                        colors.textSecondary,
                      ).copyWith(fontSize: 12.5),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  if (details.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      details,
                      style: AppTypography.bodySmall(
                        colors.textSecondary,
                      ).copyWith(fontSize: 12.5),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  // Feeds only list published duties, so status is shown
                  // only when a duty is in some other state.
                  if (status != 'published') ...[
                    const SizedBox(height: 6),
                    StatusBadge(status: status),
                  ],
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatInr(duty['amount']),
                  style: AppTypography.amount(colors.textPrimary),
                ),
                const SizedBox(height: 4),
                Text(
                  remaining == 1 ? '1 slot left' : '$remaining slots',
                  style: remaining == 1
                      ? AppTypography.bodySmall(
                          AppColors.amber,
                        ).copyWith(fontWeight: FontWeight.w600)
                      : AppTypography.bodySmall(colors.textSecondary),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A non-scrolling column of [DutyRow]s separated by hairline dividers, for
/// embedding inside an outer scroll view.
class DutyList extends StatelessWidget {
  final List<Map<String, dynamic>> duties;

  const DutyList({super.key, required this.duties});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Column(
      children: [
        for (var i = 0; i < duties.length; i++) ...[
          if (i > 0) Divider(height: 1, color: colors.border),
          DutyRow(duty: duties[i]),
        ],
      ],
    );
  }
}
