/**
 * Status Badge Widget — subtle tinted pill with a status dot.
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

  static Color colorFor(String status, {Color? fallback}) {
    final s = status.toLowerCase();
    if (s.contains('approved') || s.contains('published') || s.contains('confirmed') ||
        s.contains('verified') || s.contains('completed')) {
      return AppColors.emerald;
    } else if (s.contains('review') || s.contains('submitted') || s.contains('pending') ||
        s.contains('offer') || s.contains('selected')) {
      return AppColors.amber;
    } else if (s.contains('reject') || s.contains('cancel') || s.contains('expired')) {
      return AppColors.rose;
    }
    return fallback ?? AppColors.primary;
  }

  static String labelFor(String status) {
    final words = status.replaceAll('_', ' ').trim().toLowerCase();
    if (words.isEmpty) return words;
    return words[0].toUpperCase() + words.substring(1);
  }

  @override
  Widget build(BuildContext context) {
    final badgeColor = colorFor(status, fallback: color);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: badgeColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: badgeColor, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            labelFor(status),
            style: AppTypography.labelBold(badgeColor).copyWith(fontSize: 11),
          ),
        ],
      ),
    );
  }
}
