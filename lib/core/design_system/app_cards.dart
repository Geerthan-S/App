/**
 * Design System — Reusable Card Containers
 *
 * Flat white surface on the warm canvas with a 20px radius. No border or
 * shadow by default; pass [borderColor] for an outlined variant or
 * [elevated] for the rare floating surface.
 */

import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'app_spacing.dart';

class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final Color? borderColor;
  final EdgeInsetsGeometry? margin;
  final Color? color;

  /// Soft shadow elevation, reserved for surfaces that float above content.
  final bool elevated;

  const AppCard({
    super.key,
    required this.child,
    this.padding,
    this.onTap,
    this.borderColor,
    this.margin,
    this.color,
    this.elevated = false,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final radius = BorderRadius.circular(AppSpacing.radiusLg);

    final Widget content = DecoratedBox(
      decoration: BoxDecoration(
        color: color ?? colors.surface,
        borderRadius: radius,
        border: borderColor != null ? Border.all(color: borderColor!) : null,
        boxShadow: elevated ? AppShadows.soft(colors) : null,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: radius,
          splashColor: colors.accentSoft,
          highlightColor: colors.accentSoft.withValues(alpha: 0.6),
          child: Padding(
            padding: padding ?? AppSpacing.paddingCard,
            child: child,
          ),
        ),
      ),
    );

    if (margin != null) {
      return Padding(padding: margin!, child: content);
    }

    return content;
  }
}
