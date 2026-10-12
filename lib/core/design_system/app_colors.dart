/**
 * Design System — Curated Healthcare Color Palette
 *
 * Light, minimal medical palette: off-white canvas, white cards, charcoal
 * text and a single restrained blue accent. Blue is reserved for primary
 * actions, selected navigation, links and key highlights — never large
 * saturated surfaces.
 */

import 'package:flutter/material.dart';

class AppColors {
  // Brand & Accents
  static const Color primary = Color(0xFF356AE6);        // Medical Blue (primary accent)
  static const Color primaryDark = Color(0xFF2A56C2);
  static const Color primaryLight = Color(0xFF5B88EE);   // Readable lighter accent (icons, links)
  static const Color primarySoft = Color(0xFFEBF0FC);    // Tinted chip / selected background

  static const Color teal = Color(0xFF2A9D8F);           // Clinical Teal (secondary)
  static const Color emerald = Color(0xFF24A879);        // Success / Verified
  static const Color amber = Color(0xFFE8A23A);          // Warning / Pending
  static const Color rose = Color(0xFFD9534F);           // Error / Rejected

  // Dark Theme Surfaces (optional theme — light is the default)
  static const Color bgDark = Color(0xFF15171C);
  static const Color surfaceDark = Color(0xFF1E2128);
  static const Color surfaceElevatedDark = Color(0xFF272B33);
  static const Color borderDark = Color(0xFF30343D);

  // Light Theme Surfaces
  static const Color bgLight = Color(0xFFF7F8FA);        // Main background
  static const Color surfaceLight = Color(0xFFFFFFFF);   // Card background
  static const Color surfaceElevatedLight = Color(0xFFF0F3F8); // Muted icon / field background
  static const Color borderLight = Color(0xFFE8EBF0);    // Subtle borders & dividers

  // Text Neutral Tokens
  static const Color textDarkPrimary = Color(0xFFF1F2F4);
  static const Color textDarkSecondary = Color(0xFFA4A9B3);
  static const Color textDarkMuted = Color(0xFF7D828C);

  static const Color textLightPrimary = Color(0xFF202124); // Charcoal
  static const Color textLightSecondary = Color(0xFF747983); // Muted gray
  static const Color textLightMuted = Color(0xFF9CA1AA);

  // Shadow tint used for soft card elevation in the light theme.
  static const Color shadowLight = Color(0xFF1B2333);
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
  final Color accentSoft;
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
    accent: AppColors.primary,
    onAccent: Colors.white,
    accentSoft: AppColors.primarySoft,
    shadow: Color(0x0F1B2333),
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
    onAccent: Colors.white,
    accentSoft: Color(0xFF243150),
    shadow: Color(0x33000000),
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
      shadow: Color.lerp(shadow, other.shadow, t)!,
    );
  }
}

/// Convenience accessor so screens can write `context.appColors.textPrimary`
/// instead of `Theme.of(context).extension<AppColorsExtension>()!`.
extension AppColorsContextX on BuildContext {
  AppColorsExtension get appColors => Theme.of(this).extension<AppColorsExtension>()!;
}
