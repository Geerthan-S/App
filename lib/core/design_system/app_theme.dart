/**
 * Design System — Unified ThemeData Configuration
 *
 * Native minimalism: off-white canvas, white surfaces with hairline borders,
 * restrained blue accent, outline icons, and generous rounded geometry.
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
        overlayStyle: SystemUiOverlayStyle.light.copyWith(
          statusBarColor: Colors.transparent,
        ),
      );

  static ThemeData get lightTheme => _build(
        brightness: Brightness.light,
        colors: AppColorsExtension.light,
        overlayStyle: SystemUiOverlayStyle.dark.copyWith(
          statusBarColor: Colors.transparent,
        ),
      );

  static ThemeData _build({
    required Brightness brightness,
    required AppColorsExtension colors,
    required SystemUiOverlayStyle overlayStyle,
  }) {
    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: colors.accent,
      onPrimary: colors.onAccent,
      primaryContainer: colors.accentSoft,
      onPrimaryContainer: colors.accent,
      secondary: AppColors.teal,
      onSecondary: Colors.white,
      surface: colors.surface,
      onSurface: colors.textPrimary,
      onSurfaceVariant: colors.textSecondary,
      surfaceContainerHighest: colors.surfaceElevated,
      error: AppColors.rose,
      onError: Colors.white,
      outline: colors.border,
      outlineVariant: colors.border,
    );

    final inputBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
      borderSide: BorderSide(color: colors.border),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: colors.bg,
      canvasColor: colors.bg,
      primaryColor: AppColors.primary,
      colorScheme: colorScheme,
      extensions: [colors],
      splashFactory: InkSparkle.splashFactory,
      textTheme: TextTheme(
        headlineMedium: AppTypography.display(colors.textPrimary),
        headlineSmall: AppTypography.headingLarge(colors.textPrimary),
        titleLarge: AppTypography.headingMedium(colors.textPrimary),
        titleMedium: AppTypography.headingSmall(colors.textPrimary),
        titleSmall: AppTypography.labelBold(colors.textPrimary),
        bodyLarge: AppTypography.bodyLarge(colors.textPrimary),
        bodyMedium: AppTypography.bodyMedium(colors.textSecondary),
        bodySmall: AppTypography.bodySmall(colors.textMuted),
        labelLarge: AppTypography.labelBold(colors.textPrimary),
        labelMedium: AppTypography.bodySmall(colors.textSecondary),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: colors.bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        titleTextStyle: AppTypography.headingSmall(colors.textPrimary).copyWith(fontSize: 16),
        iconTheme: IconThemeData(color: colors.textPrimary, size: 22),
        actionsIconTheme: IconThemeData(color: colors.textSecondary, size: 22),
        systemOverlayStyle: overlayStyle,
      ),
      iconTheme: IconThemeData(color: colors.textSecondary, size: 22),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: colors.textSecondary,
          highlightColor: colors.accentSoft,
        ),
      ),
      cardTheme: CardThemeData(
        color: colors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
          side: BorderSide(color: colors.border),
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: colors.textSecondary,
        textColor: colors.textPrimary,
        titleTextStyle: AppTypography.bodyLarge(colors.textPrimary).copyWith(fontSize: 14),
        subtitleTextStyle: AppTypography.bodySmall(colors.textSecondary),
        contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusMd)),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: colors.surface,
        selectedItemColor: colors.accent,
        unselectedItemColor: colors.textMuted,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      dividerTheme: DividerThemeData(
        color: colors.border,
        thickness: 1,
        space: 1,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          disabledBackgroundColor: colors.border,
          disabledForegroundColor: colors.textMuted,
          minimumSize: const Size(0, 44),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          textStyle: AppTypography.labelBold(Colors.white),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
          elevation: 0,
          shadowColor: Colors.transparent,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          minimumSize: const Size(0, 44),
          textStyle: AppTypography.labelBold(Colors.white),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: colors.textPrimary,
          backgroundColor: colors.surface,
          minimumSize: const Size(0, 44),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          textStyle: AppTypography.labelBold(colors.textPrimary),
          side: BorderSide(color: colors.border),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: colors.accent,
          textStyle: AppTypography.labelBold(colors.accent),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          ),
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        elevation: 2,
        highlightElevation: 4,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusLg)),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: colors.surface,
        selectedColor: colors.accentSoft,
        disabledColor: colors.surfaceElevated,
        side: BorderSide(color: colors.border),
        labelStyle: AppTypography.bodySmall(colors.textSecondary).copyWith(fontWeight: FontWeight.w500),
        secondaryLabelStyle: AppTypography.bodySmall(colors.accent).copyWith(fontWeight: FontWeight.w600),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusPill)),
        checkmarkColor: colors.accent,
        iconTheme: IconThemeData(color: colors.textSecondary, size: 16),
      ),
      inputDecorationTheme: InputDecorationTheme(
        hintStyle: AppTypography.bodyMedium(colors.textMuted),
        labelStyle: AppTypography.bodyMedium(colors.textSecondary),
        floatingLabelStyle: AppTypography.bodyMedium(colors.accent),
        prefixIconColor: colors.textMuted,
        suffixIconColor: colors.textMuted,
        filled: true,
        fillColor: colors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: inputBorder,
        enabledBorder: inputBorder,
        disabledBorder: inputBorder,
        focusedBorder: inputBorder.copyWith(
          borderSide: BorderSide(color: colors.accent, width: 1.4),
        ),
        errorBorder: inputBorder.copyWith(
          borderSide: const BorderSide(color: AppColors.rose),
        ),
        focusedErrorBorder: inputBorder.copyWith(
          borderSide: const BorderSide(color: AppColors.rose, width: 1.4),
        ),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? colors.accent : Colors.transparent,
        ),
        checkColor: WidgetStatePropertyAll(colors.onAccent),
        side: BorderSide(color: colors.textMuted, width: 1.4),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? colors.accent : colors.textMuted,
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: colors.accent,
        linearTrackColor: colors.surfaceElevated,
        circularTrackColor: Colors.transparent,
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: colors.accent,
        unselectedLabelColor: colors.textSecondary,
        labelStyle: AppTypography.labelBold(colors.accent),
        unselectedLabelStyle: AppTypography.labelBold(colors.textSecondary),
        indicatorColor: colors.accent,
        indicatorSize: TabBarIndicatorSize.label,
        dividerColor: colors.border,
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          backgroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected) ? colors.accentSoft : colors.surface,
          ),
          foregroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected) ? colors.accent : colors.textSecondary,
          ),
          side: WidgetStatePropertyAll(BorderSide(color: colors.border)),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusMd)),
          ),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: colors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 6,
        shadowColor: colors.shadow,
        textStyle: AppTypography.bodyMedium(colors.textPrimary),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          side: BorderSide(color: colors.border),
        ),
      ),
      dropdownMenuTheme: DropdownMenuThemeData(
        textStyle: AppTypography.bodyMedium(colors.textPrimary),
        menuStyle: MenuStyle(
          backgroundColor: WidgetStatePropertyAll(colors.surface),
          surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusMd)),
          ),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: colors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 8,
        shadowColor: colors.shadow,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusXl),
        ),
        titleTextStyle: AppTypography.headingMedium(colors.textPrimary),
        contentTextStyle: AppTypography.bodyMedium(colors.textSecondary),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: colors.surface,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        dragHandleColor: colors.border,
        dragHandleSize: const Size(36, 4),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpacing.radiusXl)),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.textLightPrimary,
        contentTextStyle: AppTypography.bodyMedium(Colors.white),
        actionTextColor: AppColors.primaryLight,
        behavior: SnackBarBehavior.floating,
        elevation: 0,
        insetPadding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 0, AppSpacing.gutter, AppSpacing.md),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        ),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? Colors.white : colors.textMuted,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? colors.accent : colors.surfaceElevated,
        ),
        trackOutlineColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? colors.accent : colors.border,
        ),
      ),
    );
  }
}
