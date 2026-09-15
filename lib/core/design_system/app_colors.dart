/**
 * Design System — Curated Healthcare Color Palette
 */

import 'package:flutter/material.dart';

class AppColors {
  // Brand & Accents
  static const Color primary = Color(0xFF2563EB);        // Royal Medical Blue
  static const Color primaryDark = Color(0xFF1D4ED8);
  static const Color primaryLight = Color(0xFF60A5FA);

  static const Color teal = Color(0xFF0D9488);           // Clinical Teal
  static const Color emerald = Color(0xFF10B981);        // Verified Green
  static const Color amber = Color(0xFFF59E0B);          // Review / Pending Amber
  static const Color rose = Color(0xFFEF4444);           // Alert / Rejected Red

  // Dark Theme Surfaces
  static const Color bgDark = Color(0xFF0B0F17);
  static const Color surfaceDark = Color(0xFF121826);
  static const Color surfaceElevatedDark = Color(0xFF1A2234);
  static const Color borderDark = Color(0xFF232E47);

  // Light Theme Surfaces
  static const Color bgLight = Color(0xFFF8FAFC);
  static const Color surfaceLight = Color(0xFFFFFFFF);
  static const Color surfaceElevatedLight = Color(0xFFF1F5F9);
  static const Color borderLight = Color(0xFFE2E8F0);

  // Text Neutral Tokens
  static const Color textDarkPrimary = Color(0xFFF1F5F9);
  static const Color textDarkSecondary = Color(0xFF94A3B8);
  static const Color textDarkMuted = Color(0xFF64748B);

  static const Color textLightPrimary = Color(0xFF0F172A);
  static const Color textLightSecondary = Color(0xFF475569);
  static const Color textLightMuted = Color(0xFF94A3B8);
}

/// Theme-aware neutral tokens (background/surface/text/accent) that flip
/// between the light and dark palettes above. Brand/status colors
/// (primary, teal, emerald, amber, rose) stay constant across themes and
/// are used directly from [AppColors] — only surfaces, text, and the
/// on-background accent shade need to adapt.
class AppColorsExtension extends ThemeExtension<AppColorsExtension> {
  final Color bg;
  final Color surface;
  final Color surfaceElevated;
  final Color border;
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color accent;
  final Color onAccent;

  const AppColorsExtension({
    required this.bg,
    required this.surface,
    required this.surfaceElevated,
    required this.border,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.accent,
    required this.onAccent,
  });

  static const light = AppColorsExtension(
    bg: AppColors.bgLight,
    surface: AppColors.surfaceLight,
    surfaceElevated: AppColors.surfaceElevatedLight,
    border: AppColors.borderLight,
    textPrimary: AppColors.textLightPrimary,
    textSecondary: AppColors.textLightSecondary,
    textMuted: AppColors.textLightMuted,
    accent: AppColors.primary,
    onAccent: Colors.white,
  );

  static const dark = AppColorsExtension(
    bg: AppColors.bgDark,
    surface: AppColors.surfaceDark,
    surfaceElevated: AppColors.surfaceElevatedDark,
    border: AppColors.borderDark,
    textPrimary: AppColors.textDarkPrimary,
    textSecondary: AppColors.textDarkSecondary,
    textMuted: AppColors.textDarkMuted,
    // Lighter accent shade so the primary blue keeps proper contrast when
    // used as bare icon/text color directly on a dark surface.
    accent: AppColors.primaryLight,
    onAccent: AppColors.bgDark,
  );

  @override
  AppColorsExtension copyWith({
    Color? bg,
    Color? surface,
    Color? surfaceElevated,
    Color? border,
    Color? textPrimary,
    Color? textSecondary,
    Color? textMuted,
    Color? accent,
    Color? onAccent,
  }) {
    return AppColorsExtension(
      bg: bg ?? this.bg,
      surface: surface ?? this.surface,
      surfaceElevated: surfaceElevated ?? this.surfaceElevated,
      border: border ?? this.border,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textMuted: textMuted ?? this.textMuted,
      accent: accent ?? this.accent,
      onAccent: onAccent ?? this.onAccent,
    );
  }

  @override
  AppColorsExtension lerp(ThemeExtension<AppColorsExtension>? other, double t) {
    if (other is! AppColorsExtension) return this;
    return AppColorsExtension(
      bg: Color.lerp(bg, other.bg, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceElevated: Color.lerp(surfaceElevated, other.surfaceElevated, t)!,
      border: Color.lerp(border, other.border, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textMuted: Color.lerp(textMuted, other.textMuted, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      onAccent: Color.lerp(onAccent, other.onAccent, t)!,
    );
  }
}

/// Convenience accessor so screens can write `context.appColors.textPrimary`
/// instead of `Theme.of(context).extension<AppColorsExtension>()!`.
extension AppColorsContextX on BuildContext {
  AppColorsExtension get appColors => Theme.of(this).extension<AppColorsExtension>()!;
}
