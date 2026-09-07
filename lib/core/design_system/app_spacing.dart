/**
 * Design System — Spacing & Layout Tokens (8pt Grid)
 */

import 'package:flutter/material.dart';

class AppSpacing {
  static const double xxs = 4.0;
  static const double xs = 8.0;
  static const double sm = 12.0;
  static const double md = 16.0;
  static const double lg = 24.0;
  static const double xl = 32.0;
  static const double xxl = 48.0;

  // Radii
  static const double radiusSm = 8.0;
  static const double radiusMd = 12.0;
  static const double radiusLg = 16.0;
  static const double radiusPill = 999.0;

  // EdgeInsets Helpers
  static const EdgeInsets paddingScreen = EdgeInsets.all(md);
  static const EdgeInsets paddingCard = EdgeInsets.all(md);
  static const EdgeInsets paddingButton = EdgeInsets.symmetric(horizontal: lg, vertical: sm);
}
