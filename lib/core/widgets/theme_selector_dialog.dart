/**
 * Theme Selector Bottom Sheet Modal
 * Lets the user choose Light / Dark / Default (system) appearance.
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_typography.dart';
import '../design_system/app_spacing.dart';
import '../design_system/theme_provider.dart';

class _ThemeOption {
  final ThemeMode mode;
  final String label;
  final String description;
  final IconData icon;

  const _ThemeOption({
    required this.mode,
    required this.label,
    required this.description,
    required this.icon,
  });
}

class ThemeSelectorDialog extends ConsumerWidget {
  const ThemeSelectorDialog({super.key});

  static const List<_ThemeOption> _options = [
    _ThemeOption(
      mode: ThemeMode.light,
      label: 'Light',
      description: "Always use the app's light appearance",
      icon: Icons.light_mode_rounded,
    ),
    _ThemeOption(
      mode: ThemeMode.dark,
      label: 'Dark',
      description: "Always use the app's dark appearance",
      icon: Icons.dark_mode_rounded,
    ),
    _ThemeOption(
      mode: ThemeMode.system,
      label: 'Default',
      description: 'Follow your device appearance setting',
      icon: Icons.brightness_auto_rounded,
    ),
  ];

  static void show(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) => const ThemeSelectorDialog(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.appColors;
    final currentMode = ref.watch(themeModeProvider);

    return SafeArea(
      child: Padding(
        padding: AppSpacing.paddingScreen,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Theme', style: AppTypography.headingSmall(colors.textPrimary)),
                IconButton(
                  icon: Icon(Icons.close_rounded, color: colors.textMuted),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            ..._options.map((option) {
              final isSelected = currentMode == option.mode;
              return InkWell(
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                onTap: () {
                  ref.read(themeModeProvider.notifier).setThemeMode(option.mode);
                  Navigator.pop(context);
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  decoration: BoxDecoration(
                    color: isSelected ? colors.accent.withOpacity(0.15) : colors.surfaceElevated,
                    borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    border: Border.all(color: isSelected ? colors.accent : colors.border),
                  ),
                  child: Row(
                    children: [
                      Icon(option.icon, color: isSelected ? colors.accent : colors.textSecondary, size: 20),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              option.label,
                              style: AppTypography.labelBold(isSelected ? colors.accent : colors.textPrimary),
                            ),
                            Text(option.description, style: AppTypography.bodySmall(colors.textMuted)),
                          ],
                        ),
                      ),
                      if (isSelected)
                        Icon(Icons.check_circle_rounded, color: colors.accent, size: 20),
                    ],
                  ),
                ),
              );
            }),
            const SizedBox(height: AppSpacing.sm),
          ],
        ),
      ),
    );
  }
}

/// Maps a [ThemeMode] to the human-readable label shown as the current
/// selection in the Settings list.
String themeModeLabel(ThemeMode mode) {
  switch (mode) {
    case ThemeMode.light:
      return 'Light';
    case ThemeMode.dark:
      return 'Dark';
    case ThemeMode.system:
      return 'Default';
  }
}
