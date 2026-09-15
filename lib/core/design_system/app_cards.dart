/**
 * Design System — Reusable Card Containers
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

  const AppCard({
    super.key,
    required this.child,
    this.padding,
    this.onTap,
    this.borderColor,
    this.margin,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final cardWidget = Container(
      padding: padding ?? AppSpacing.paddingCard,
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(
          color: borderColor ?? colors.border,
          width: 1,
        ),
      ),
      child: child,
    );

    final Widget content = onTap != null
        ? InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            child: cardWidget,
          )
        : cardWidget;

    if (margin != null) {
      return Padding(padding: margin!, child: content);
    }

    return content;
  }
}
