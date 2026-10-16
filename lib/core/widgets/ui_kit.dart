/**
 * UI Kit — shared building blocks for the warm minimal design: section
 * headers, grouped row lists, label/value rows, date blocks, the shift
 * timeline, filter chips and small status marks. Screens compose these
 * instead of hand-styling, so spacing and hierarchy stay consistent.
 */

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_typography.dart';
import '../design_system/app_spacing.dart';

final NumberFormat _inrFormat = NumberFormat.decimalPattern('en_IN');
final DateFormat _timeFormat = DateFormat('h:mm a');
final DateFormat _dayTimeFormat = DateFormat('EEE d MMM, h:mm a');

/// Formats a rupee amount with Indian digit grouping, e.g. `₹12,500`.
String formatInr(Object? amount) {
  if (amount is num) return '₹${_inrFormat.format(amount)}';
  final parsed = num.tryParse('${amount ?? ''}');
  return parsed == null ? '₹${amount ?? 0}' : '₹${_inrFormat.format(parsed)}';
}

/// Human label for a payment basis such as `per_shift` → `shift`.
String basisLabel(Object? basis) {
  final raw = '${basis ?? 'per_shift'}'
      .replaceAll('per_', '')
      .replaceAll('_', ' ')
      .trim();
  return raw.isEmpty ? 'shift' : raw;
}

/// Parses an ISO-8601 string into local time; null when absent or invalid.
DateTime? parseIsoLocal(Object? iso) {
  if (iso is! String || iso.isEmpty) return null;
  return DateTime.tryParse(iso)?.toLocal();
}

/// `9:56 PM`
String formatTime(DateTime dt) => _timeFormat.format(dt);

/// `Tue 13 Oct, 9:56 PM`
String formatDayTime(DateTime dt) => _dayTimeFormat.format(dt);

/// Shift timing line for a duty, e.g. `9:56 PM, 12 hrs`. Falls back to the
/// preformatted start string when the raw timestamps are unavailable.
String shiftTimingLabel(Map<String, dynamic> duty) {
  final start = parseIsoLocal(duty['startAtIso']);
  final end = parseIsoLocal(duty['endAtIso']);
  if (start == null) return '${duty['startAt'] ?? ''}';
  if (end == null) return formatTime(start);
  final hours = end.difference(start).inMinutes / 60;
  final hoursLabel = hours == hours.roundToDouble()
      ? '${hours.round()}'
      : hours.toStringAsFixed(1);
  return '${formatTime(start)}, $hoursLabel hrs';
}

/// Section title with an optional trailing text action ("See all").
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
            child: Text(
              title,
              style: AppTypography.headingMedium(
                colors.textPrimary,
              ).copyWith(fontSize: 17),
            ),
          ),
          if (actionLabel != null)
            GestureDetector(
              onTap: onAction,
              behavior: HitTestBehavior.opaque,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Text(
                  actionLabel!,
                  style: AppTypography.labelBold(colors.textSecondary),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Small caption above a grouped list ("Terms", "Account").
class GroupLabel extends StatelessWidget {
  final String text;

  const GroupLabel(this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.xs),
      child: Text(
        text,
        style: AppTypography.labelBold(context.appColors.textSecondary),
      ),
    );
  }
}

/// A flat surface holding rows separated by hairline dividers. Used for
/// settings, account links and other grouped lists.
class RowGroup extends StatelessWidget {
  final List<Widget> children;
  final EdgeInsetsGeometry padding;

  const RowGroup({
    super.key,
    required this.children,
    this.padding = const EdgeInsets.symmetric(horizontal: AppSpacing.md),
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final items = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      if (i > 0) items.add(Divider(height: 1, color: colors.border));
      items.add(children[i]);
    }
    return Material(
      color: colors.surface,
      borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: padding,
        child: Column(mainAxisSize: MainAxisSize.min, children: items),
      ),
    );
  }
}

/// Tappable list row: optional outline icon, title, optional subtitle and a
/// trailing widget (chevron by default when tappable).
class ListRow extends StatelessWidget {
  final IconData? icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  /// Tints the icon and title (destructive rows such as Log out).
  final Color? color;

  /// Tints only the icon (status rows such as verification).
  final Color? iconColor;

  const ListRow({
    super.key,
    this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.color,
    this.iconColor,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final fg = color ?? colors.textPrimary;
    final row = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 56),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            if (icon != null) ...[
              Icon(
                icon,
                size: 20,
                color: iconColor ?? color ?? colors.textSecondary,
              ),
              const SizedBox(width: 14),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: AppTypography.bodyLarge(fg).copyWith(fontSize: 14.5),
                  ),
                  if (subtitle != null && subtitle!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      style: AppTypography.bodySmall(colors.textSecondary),
                    ),
                  ],
                ],
              ),
            ),
            if (trailing != null) ...[
              const SizedBox(width: AppSpacing.sm),
              trailing!,
            ] else if (onTap != null) ...[
              const SizedBox(width: AppSpacing.sm),
              Icon(
                Icons.chevron_right_outlined,
                size: 20,
                color: colors.textMuted,
              ),
            ],
          ],
        ),
      ),
    );
    if (onTap == null) return row;
    return InkWell(onTap: onTap, child: row);
  }
}

/// Label / value row: muted label on the left, value on the right.
class DetailRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const DetailRow({
    super.key,
    required this.label,
    required this.value,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 13),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppTypography.bodyMedium(
              colors.textSecondary,
            ).copyWith(fontSize: 14),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: AppTypography.labelBold(
                valueColor ?? colors.textPrimary,
              ).copyWith(fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}

/// Day-of-month over short month (`13` / `OCT`), the leading anchor of duty
/// and assignment rows.
class DateBlock extends StatelessWidget {
  final DateTime? date;

  const DateBlock({super.key, required this.date});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return SizedBox(
      width: 44,
      child: Column(
        children: [
          Text(
            date == null ? '—' : '${date!.day}',
            style: AppTypography.amount(colors.textPrimary, fontSize: 20),
          ),
          const SizedBox(height: 3),
          Text(
            date == null ? '' : DateFormat('MMM').format(date!).toUpperCase(),
            style: AppTypography.overline(
              colors.textSecondary,
            ).copyWith(letterSpacing: 0.5),
          ),
        ],
      ),
    );
  }
}

/// Start → end on a two-point vertical rail.
class ShiftTimeline extends StatelessWidget {
  final String startLabel;
  final String endLabel;

  const ShiftTimeline({
    super.key,
    required this.startLabel,
    required this.endLabel,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    Widget point(String caption, String value) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(caption, style: AppTypography.bodySmall(colors.textSecondary)),
        const SizedBox(height: 2),
        Text(value, style: AppTypography.headingSmall(colors.textPrimary)),
      ],
    );
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 5, bottom: 22),
            child: Column(
              children: [
                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    color: colors.accent,
                    shape: BoxShape.circle,
                  ),
                ),
                Expanded(
                  child: Container(
                    width: 2,
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    color: colors.border,
                  ),
                ),
                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: colors.accent, width: 2),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                point('Starts', startLabel),
                const SizedBox(height: 16),
                point('Ends', endLabel),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Lime pill for the single most important status on a screen.
class HighlightTag extends StatelessWidget {
  final String label;

  const HighlightTag(this.label, {super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: colors.highlight,
        borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppTypography.labelBold(
          colors.onHighlight,
        ).copyWith(fontSize: 11.5),
      ),
    );
  }
}

/// Small green "verified" seal shown next to names backed by verified data.
class VerifiedMark extends StatelessWidget {
  final double size;

  const VerifiedMark({super.key, this.size = 15});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Verified',
      child: Icon(Icons.verified, size: size, color: AppColors.emerald),
    );
  }
}

/// Compact metadata chip: optional outline icon + short label on a muted fill.
class InfoChip extends StatelessWidget {
  final IconData? icon;
  final String label;
  final Color? color;

  const InfoChip({super.key, this.icon, required this.label, this.color});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final fg = color ?? colors.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color != null
            ? color!.withValues(alpha: 0.1)
            : colors.surfaceElevated,
        borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: fg),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.bodySmall(
                fg,
              ).copyWith(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// Pill filter chip. Selected state is a solid ink fill; unselected chips are
/// flat surfaces so a row of filters stays quiet.
class AppFilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const AppFilterChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final fg = selected ? colors.onAccent : colors.textSecondary;
    return Semantics(
      selected: selected,
      button: true,
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOut,
          constraints: const BoxConstraints(minHeight: 36),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: selected ? colors.accent : colors.surface,
            borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
          ),
          child: Text(
            label,
            style: AppTypography.bodySmall(
              fg,
            ).copyWith(fontWeight: FontWeight.w600, fontSize: 13),
          ),
        ),
      ),
    );
  }
}

/// Round surface icon button (back, notifications, report…).
class CircleIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;
  final Color? iconColor;
  final double size;
  final Widget? badge;
  final Color? background;

  const CircleIconButton({
    super.key,
    required this.icon,
    this.onPressed,
    this.tooltip,
    this.iconColor,
    this.size = 44,
    this.badge,
    this.background,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final button = Material(
      color: background ?? colors.surface,
      shape: const CircleBorder(),
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
            children: [
              button,
              Positioned(right: -2, top: -2, child: badge!),
            ],
          );
    final semantic = Semantics(button: true, label: tooltip, child: withBadge);
    return tooltip == null
        ? semantic
        : Tooltip(message: tooltip!, child: semantic);
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
        style: AppTypography.bodySmall(
          Colors.white,
        ).copyWith(fontSize: 10, fontWeight: FontWeight.w700, height: 1.1),
      ),
    );
  }
}

/// Initials avatar on a muted fill.
class InitialsAvatar extends StatelessWidget {
  final String name;
  final double size;
  final String fallback;

  const InitialsAvatar({
    super.key,
    required this.name,
    this.size = 40,
    this.fallback = 'D',
  });

  static String initialsOf(String name, {String fallback = 'D'}) {
    final parts = name
        .replaceFirst(RegExp(r'^dr\.?\s+', caseSensitive: false), '')
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return fallback;
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: colors.surfaceElevated,
        shape: BoxShape.circle,
      ),
      child: Text(
        initialsOf(name, fallback: fallback),
        style: AppTypography.labelBold(
          colors.textPrimary,
        ).copyWith(fontSize: size * 0.34),
      ),
    );
  }
}

/// Sticky bottom container for a screen's primary action. Sits in
/// `Scaffold.bottomNavigationBar`, so the body scrolls above it and the
/// system navigation inset is respected.
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
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.gutter,
            12,
            AppSpacing.gutter,
            12,
          ),
          child: child,
        ),
      ),
    );
  }
}

/// Header row used at the top of bottom sheets: title plus a close action.
class SheetHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final VoidCallback onClose;

  const SheetHeader({
    super.key,
    required this.title,
    this.subtitle,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: AppTypography.headingMedium(colors.textPrimary),
              ),
              if (subtitle != null) ...[
                const SizedBox(height: 2),
                Text(
                  subtitle!,
                  style: AppTypography.bodySmall(colors.textSecondary),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        CircleIconButton(
          icon: Icons.close_outlined,
          tooltip: 'Close',
          size: 40,
          background: colors.surfaceElevated,
          onPressed: onClose,
        ),
      ],
    );
  }
}
