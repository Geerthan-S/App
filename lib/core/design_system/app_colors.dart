/**
 * Design System — Warm Neutral Palette
 *
 * Warm off-white canvas, white surfaces, near-black ink for primary actions
 * and the one hero surface per screen, and a lime highlight used sparingly
 * (selected status tags, the most urgent item). Status colors are muted so
 * they read as information rather than decoration.
 */

import 'package:flutter/material.dart';

class AppColors {
  // Brand
  static const Color ink = Color(0xFF15171B); // Primary actions, hero surfaces
  static const Color lime = Color(0xFFD6F25E); // Sparing highlight
  static const Color onLime = Color(0xFF15171B);

  // Status
  static const Color emerald = Color(0xFF1F8A5B); // Success / Verified
  static const Color amber = Color(0xFFB7791F); // Warning / Pending / Scarcity
  static const Color rose = Color(0xFFD64545); // Error / Rejected

  // Dark Theme Surfaces (optional theme — light is the default)
  static const Color bgDark = Color(0xFF121315);
  static const Color surfaceDark = Color(0xFF1B1C1F);
  static const Color surfaceElevatedDark = Color(0xFF25262A);
  static const Color borderDark = Color(0xFF2E2F33);

  // Light Theme Surfaces
  static const Color bgLight = Color(0xFFF4F4F1); // Warm canvas
  static const Color surfaceLight = Color(0xFFFFFFFF); // Surfaces
  static const Color surfaceElevatedLight = Color(
    0xFFEBEBE6,
  ); // Muted fills (fields, avatars, tracks)
  static const Color borderLight = Color(0xFFE4E4DF); // Hairline dividers

  // Text Neutral Tokens
  static const Color textDarkPrimary = Color(0xFFF2F2EE);
  static const Color textDarkSecondary = Color(0xFFA3A5AA);
  static const Color textDarkMuted = Color(0xFF75777D);

  static const Color textLightPrimary = Color(0xFF15171B);
  static const Color textLightSecondary = Color(0xFF6B6E75);
  static const Color textLightMuted = Color(0xFF9A9DA3);
}

/// Theme-aware tokens that flip between the light and dark palettes above.
/// `accent` is the ink used for primary actions and selection (near-black in
/// light, near-white in dark); `highlight` is the lime used sparingly. Status
/// colors (emerald, amber, rose) stay constant and come from [AppColors].
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
  final Color accentSoft;
  final Color highlight;
  final Color onHighlight;
  final Color shadow;

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
    required this.accentSoft,
    required this.highlight,
    required this.onHighlight,
    required this.shadow,
  });

  static const light = AppColorsExtension(
    bg: AppColors.bgLight,
    surface: AppColors.surfaceLight,
    surfaceElevated: AppColors.surfaceElevatedLight,
    border: AppColors.borderLight,
    textPrimary: AppColors.textLightPrimary,
    textSecondary: AppColors.textLightSecondary,
    textMuted: AppColors.textLightMuted,
    accent: AppColors.ink,
    onAccent: Colors.white,
    accentSoft: Color(0xFFE6E6E0),
    highlight: AppColors.lime,
    onHighlight: AppColors.onLime,
    shadow: Color(0x0F15171B),
  );

  static const dark = AppColorsExtension(
    bg: AppColors.bgDark,
    surface: AppColors.surfaceDark,
    surfaceElevated: AppColors.surfaceElevatedDark,
    border: AppColors.borderDark,
    textPrimary: AppColors.textDarkPrimary,
    textSecondary: AppColors.textDarkSecondary,
    textMuted: AppColors.textDarkMuted,
    // Inverted ink: primary actions are near-white with dark labels.
    accent: AppColors.textDarkPrimary,
    onAccent: AppColors.ink,
    accentSoft: Color(0xFF2A2B2F),
    highlight: AppColors.lime,
    onHighlight: AppColors.onLime,
    shadow: Color(0x40000000),
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
    Color? accentSoft,
    Color? highlight,
    Color? onHighlight,
    Color? shadow,
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
      accentSoft: accentSoft ?? this.accentSoft,
      highlight: highlight ?? this.highlight,
      onHighlight: onHighlight ?? this.onHighlight,
      shadow: shadow ?? this.shadow,
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
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
      highlight: Color.lerp(highlight, other.highlight, t)!,
      onHighlight: Color.lerp(onHighlight, other.onHighlight, t)!,
      shadow: Color.lerp(shadow, other.shadow, t)!,
    );
  }
}

/// Convenience accessor so screens can write `context.appColors.textPrimary`
/// instead of `Theme.of(context).extension<AppColorsExtension>()!`.
extension AppColorsContextX on BuildContext {
  AppColorsExtension get appColors =>
      Theme.of(this).extension<AppColorsExtension>()!;
}
