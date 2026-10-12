/**
 * UI Kit — small shared building blocks for the minimal light design:
 * section headers, info chips, filter chips, icon tiles, detail rows and
 * round icon buttons. Screens compose these instead of hand-styling.
 */

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_typography.dart';
import '../design_system/app_spacing.dart';

final NumberFormat _inrFormat = NumberFormat.decimalPattern('en_IN');

/// Formats a rupee amount with Indian digit grouping, e.g. `₹12,500`.
String formatInr(Object? amount) {
  if (amount is num) return '₹${_inrFormat.format(amount)}';
  final parsed = num.tryParse('${amount ?? ''}');
  return parsed == null ? '₹${amount ?? 0}' : '₹${_inrFormat.format(parsed)}';
}

/// Human label for a payment basis such as `per_shift` → `shift`.
String basisLabel(Object? basis) {
  final raw = '${basis ?? 'per_shift'}'.replaceAll('per_', '').replaceAll('_', ' ').trim();
  return raw.isEmpty ? 'shift' : raw;
}

/// Section title with an optional trailing link action ("View all").
class SectionHeader extends StatelessWidget {
  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;
  final EdgeInsetsGeometry padding;

  const SectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
    this.padding = EdgeInsets.zero,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Text(title, style: AppTypography.headingMedium(colors.textPrimary).copyWith(fontSize: 17)),
          ),
          if (actionLabel != null)
            GestureDetector(
              onTap: onAction,
              behavior: HitTestBehavior.opaque,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text(actionLabel!, style: AppTypography.labelBold(colors.accent)),
              ),
            ),
        ],
      ),
    );
  }
}

/// Muted rounded-square tile holding an outline icon.
class IconTile extends StatelessWidget {
  final IconData icon;
  final double size;
  final Color? iconColor;
  final Color? background;

  const IconTile({
    super.key,
    required this.icon,
    this.size = 44,
    this.iconColor,
    this.background,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: background ?? colors.surfaceElevated,
        borderRadius: BorderRadius.circular(size * 0.32),
      ),
      child: Icon(icon, size: size * 0.5, color: iconColor ?? colors.accent),
    );
  }
}

/// Compact metadata chip: outline icon + short label on a muted background.
class InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color? color;

  const InfoChip({super.key, required this.icon, required this.label, this.color});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final fg = color ?? colors.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color != null ? color!.withValues(alpha: 0.1) : colors.surfaceElevated,
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: fg),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.bodySmall(fg).copyWith(fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}

/// Pill filter / category chip. Selected state uses a soft accent tint and a
/// gentle raised shadow (restrained soft-material) rather than a solid fill.
class AppFilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  const AppFilterChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final fg = selected ? colors.accent : colors.textSecondary;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: selected ? colors.accentSoft : colors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
          border: Border.all(color: selected ? colors.accent.withValues(alpha: 0.35) : colors.border),
          boxShadow: selected ? AppShadows.subtle(colors) : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 15, color: fg),
              const SizedBox(width: 6),
            ],
            Text(
              label,
              style: AppTypography.bodySmall(fg).copyWith(
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Label / value row used inside detail cards, with an optional leading icon.
class DetailRow extends StatelessWidget {
  final String label;
  final String value;
  final IconData? icon;
  final Color? valueColor;

  const DetailRow({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          if (icon != null) ...[
            IconTile(icon: icon!, size: 34, iconColor: colors.textSecondary),
            const SizedBox(width: AppSpacing.sm),
          ],
          Text(label, style: AppTypography.bodyMedium(colors.textSecondary)),
          const SizedBox(width: AppSpacing.sm),
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

/// Round white icon button with a hairline border (back, notifications…).
class CircleIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;
  final Color? iconColor;
  final double size;
  final Widget? badge;

  const CircleIconButton({
    super.key,
    required this.icon,
    this.onPressed,
    this.tooltip,
    this.iconColor,
    this.size = 44,
    this.badge,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final button = Material(
      color: colors.surface,
      shape: CircleBorder(side: BorderSide(color: colors.border)),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(icon, size: 20, color: iconColor ?? colors.textPrimary),
        ),
      ),
    );
    final withBadge = badge == null
        ? button
        : Stack(
            clipBehavior: Clip.none,
            children: [button, Positioned(right: -2, top: -2, child: badge!)],
          );
    return tooltip == null ? withBadge : Tooltip(message: tooltip!, child: withBadge);
  }
}

/// Small count badge (unread counts on bells, tabs, conversations).
class CountBadge extends StatelessWidget {
  final int count;
  final Color? color;

  const CountBadge({super.key, required this.count, this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
      decoration: BoxDecoration(
        color: color ?? AppColors.rose,
        borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
        border: Border.all(color: context.appColors.surface, width: 2),
      ),
      alignment: Alignment.center,
      child: Text(
        count > 99 ? '99+' : '$count',
        style: AppTypography.bodySmall(Colors.white).copyWith(fontSize: 10, fontWeight: FontWeight.w700, height: 1.1),
      ),
    );
  }
}

/// Compact stat tile (icon, value, label) shown in a row on detail heroes.
class StatTile extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;
  final Color? valueColor;

  const StatTile({
    super.key,
    required this.icon,
    required this.value,
    required this.label,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: colors.border),
        boxShadow: AppShadows.subtle(colors),
      ),
      child: Column(
        children: [
          IconTile(icon: icon, size: 32),
          const SizedBox(height: 8),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTypography.headingSmall(valueColor ?? colors.textPrimary).copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTypography.bodySmall(colors.textSecondary).copyWith(fontSize: 11),
          ),
        ],
      ),
    );
  }
}

/// Sticky bottom container for a screen's primary action.
class BottomActionBar extends StatelessWidget {
  final Widget child;

  const BottomActionBar({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 12, AppSpacing.gutter, 12),
          child: child,
        ),
      ),
    );
  }
}
