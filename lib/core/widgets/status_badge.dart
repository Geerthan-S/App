/**
 * Status Badge Widget
 */

import 'package:flutter/material.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_typography.dart';
import '../design_system/app_spacing.dart';

class StatusBadge extends StatelessWidget {
  final String status;
  final Color? color;

  const StatusBadge({
    super.key,
    required this.status,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    Color badgeColor = color ?? AppColors.primary;
    if (status.toLowerCase().contains('approved') || status.toLowerCase().contains('published') || status.toLowerCase().contains('confirmed')) {
      badgeColor = AppColors.emerald;
    } else if (status.toLowerCase().contains('review') || status.toLowerCase().contains('submitted') || status.toLowerCase().contains('pending')) {
      badgeColor = AppColors.amber;
    } else if (status.toLowerCase().contains('reject') || status.toLowerCase().contains('cancel')) {
      badgeColor = AppColors.rose;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: badgeColor.withOpacity(0.15),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: badgeColor.withOpacity(0.3)),
      ),
      child: Text(
        status.toUpperCase().replaceAll('_', ' '),
        style: AppTypography.labelBold(badgeColor).copyWith(fontSize: 10),
      ),
    );
  }
}
