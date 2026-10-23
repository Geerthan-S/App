/**
 * Status Badge Widget — a colored dot and label, no filled pill, so status
 * reads as information without competing with the content around it.
 */

import 'package:flutter/material.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_typography.dart';

class StatusBadge extends StatelessWidget {
  final String status;
  final Color? color;

  const StatusBadge({super.key, required this.status, this.color});

  /// Status color for known lifecycle states; null for neutral states.
  static Color? colorFor(String status) {
    final s = status.toLowerCase();
    if (s.contains('approved') ||
        s.contains('published') ||
        s.contains('confirmed') ||
        s.contains('verified') ||
        s.contains('completed')) {
      return AppColors.emerald;
    } else if (s.contains('review') ||
        s.contains('submitted') ||
        s.contains('pending') ||
        s.contains('offer') ||
        s.contains('selected')) {
      return AppColors.amber;
    } else if (s.contains('reject') ||
        s.contains('cancel') ||
        s.contains('expired')) {
      return AppColors.rose;
    }
    return null;
  }

  static String labelFor(String status) {
    final words = status.replaceAll('_', ' ').trim().toLowerCase();
    if (words.isEmpty) return words;
    return words[0].toUpperCase() + words.substring(1);
  }

  @override
  Widget build(BuildContext context) {
    final badgeColor =
        colorFor(status) ?? color ?? context.appColors.textSecondary;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: badgeColor, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(
          labelFor(status),
          style: AppTypography.labelBold(badgeColor).copyWith(fontSize: 12),
        ),
      ],
    );
  }
}
