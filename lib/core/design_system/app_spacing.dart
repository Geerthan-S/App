/**
 * Design System — Spacing, Radius & Elevation Tokens (8pt Grid)
 */

import 'package:flutter/material.dart';
import 'app_colors.dart';

class AppSpacing {
  static const double xxs = 4.0;
  static const double xs = 8.0;
  static const double sm = 12.0;
  static const double md = 16.0;
  static const double lg = 24.0;
  static const double xl = 32.0;
  static const double xxl = 48.0;

  /// Horizontal page gutter used by every screen.
  static const double gutter = 20.0;

  /// Vertical gap between major page sections.
  static const double section = 28.0;

  // Radii
  static const double radiusSm = 10.0;   // chips, badges, small tiles
  static const double radiusMd = 14.0;   // inputs, buttons, icon tiles
  static const double radiusLg = 18.0;   // cards
  static const double radiusXl = 24.0;   // sheets, hero surfaces
  static const double radiusPill = 999.0;

  // EdgeInsets Helpers
  static const EdgeInsets paddingScreen = EdgeInsets.symmetric(horizontal: gutter, vertical: md);
  static const EdgeInsets paddingCard = EdgeInsets.all(md);
  static const EdgeInsets paddingButton = EdgeInsets.symmetric(horizontal: lg, vertical: sm);

  /// Extra bottom padding so scrolling content clears the bottom navigation bar.
  static const double navBarClearance = 96.0;
}

/// Soft, low-contrast elevation. Cards rely mainly on a hairline border plus
/// a very diffuse shadow — never heavy drop shadows.
class AppShadows {
  static List<BoxShadow> soft(AppColorsExtension colors) => [
        BoxShadow(
          color: colors.shadow,
          blurRadius: 18,
          offset: const Offset(0, 6),
        ),
      ];

  static List<BoxShadow> subtle(AppColorsExtension colors) => [
        BoxShadow(
          color: colors.shadow.withValues(alpha: colors.shadow.a * 0.6),
          blurRadius: 10,
          offset: const Offset(0, 2),
        ),
      ];
}
