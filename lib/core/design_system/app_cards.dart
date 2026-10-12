/**
 * Design System — Reusable Card Containers
 *
 * White surface, 18px radius, hairline border and a very diffuse shadow
 * (soft-material elevation used sparingly).
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

  /// Soft shadow elevation. Disable for cards nested inside other surfaces.
  final bool elevated;

  const AppCard({
    super.key,
    required this.child,
    this.padding,
    this.onTap,
    this.borderColor,
    this.margin,
    this.color,
    this.elevated = true,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final radius = BorderRadius.circular(AppSpacing.radiusLg);

    final Widget content = DecoratedBox(
      decoration: BoxDecoration(
        color: color ?? colors.surface,
        borderRadius: radius,
        border: Border.all(color: borderColor ?? colors.border, width: 1),
        boxShadow: elevated ? AppShadows.soft(colors) : null,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: radius,
          splashColor: colors.accentSoft,
          highlightColor: colors.accentSoft.withValues(alpha: 0.5),
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
