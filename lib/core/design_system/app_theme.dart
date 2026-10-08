/**
 * Design System — Unified ThemeData Configuration
 */

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_colors.dart';
import 'app_typography.dart';
import 'app_spacing.dart';

class AppTheme {
  static ThemeData get darkTheme => _build(
        brightness: Brightness.dark,
        colors: AppColorsExtension.dark,
        overlayStyle: SystemUiOverlayStyle.light,
      );

  static ThemeData get lightTheme => _build(
        brightness: Brightness.light,
        colors: AppColorsExtension.light,
        overlayStyle: SystemUiOverlayStyle.dark,
      );

  static ThemeData _build({
    required Brightness brightness,
    required AppColorsExtension colors,
    required SystemUiOverlayStyle overlayStyle,
  }) {
    final colorScheme = brightness == Brightness.dark
        ? ColorScheme.dark(
            primary: colors.accent,
            onPrimary: colors.onAccent,
            secondary: AppColors.teal,
            onSecondary: Colors.white,
            surface: colors.surface,
            onSurface: colors.textPrimary,
            error: AppColors.rose,
            onError: Colors.white,
            outline: colors.border,
          )
        : ColorScheme.light(
            primary: colors.accent,
            onPrimary: colors.onAccent,
            secondary: AppColors.teal,
            onSecondary: Colors.white,
            surface: colors.surface,
            onSurface: colors.textPrimary,
            error: AppColors.rose,
            onError: Colors.white,
            outline: colors.border,
          );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: colors.bg,
      primaryColor: AppColors.primary,
      colorScheme: colorScheme,
      extensions: [colors],
      textTheme: TextTheme(
        headlineSmall: AppTypography.headingLarge(colors.textPrimary),
        titleLarge: AppTypography.headingMedium(colors.textPrimary),
        titleMedium: AppTypography.headingSmall(colors.textPrimary),
        bodyLarge: AppTypography.bodyLarge(colors.textPrimary),
        bodyMedium: AppTypography.bodyMedium(colors.textSecondary),
        bodySmall: AppTypography.bodySmall(colors.textMuted),
        labelLarge: AppTypography.labelBold(colors.textPrimary),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: colors.surface,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: AppTypography.headingMedium(colors.textPrimary),
        iconTheme: IconThemeData(color: colors.textPrimary),
        systemOverlayStyle: overlayStyle,
      ),
      iconTheme: IconThemeData(color: colors.textSecondary),
      cardTheme: CardThemeData(
        color: colors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          side: BorderSide(color: colors.border),
        ),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: colors.surfaceElevated,
        selectedItemColor: AppColors.primary,
        unselectedItemColor: colors.textSecondary,
        type: BottomNavigationBarType.fixed,
        elevation: 8,
      ),
      dividerTheme: DividerThemeData(
        color: colors.border,
        thickness: 1,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          disabledBackgroundColor: colors.border,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          ),
          elevation: 0,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: colors.accent,
          side: BorderSide(color: colors.border),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: colors.accent,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        hintStyle: AppTypography.bodyMedium(colors.textMuted),
        filled: true,
        fillColor: colors.surfaceElevated,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          borderSide: BorderSide(color: colors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          borderSide: BorderSide(color: colors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          borderSide: BorderSide(color: AppColors.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          borderSide: const BorderSide(color: AppColors.rose),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: colors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        ),
        titleTextStyle: AppTypography.headingSmall(colors.textPrimary),
        contentTextStyle: AppTypography.bodyMedium(colors.textSecondary),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: colors.surface,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpacing.radiusLg)),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: colors.surfaceElevated,
        contentTextStyle: AppTypography.bodyMedium(colors.textPrimary),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        ),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? AppColors.primary : colors.textMuted,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? AppColors.primary.withOpacity(0.4)
              : colors.border,
        ),
      ),
      dialogBackgroundColor: colors.surface,
    );
  }
}
