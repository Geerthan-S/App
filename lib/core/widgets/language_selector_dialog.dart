/**
 * Language Selector Bottom Sheet Modal
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../constants/app_constants.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_typography.dart';
import '../design_system/app_spacing.dart';
import '../localization/language_provider.dart';

class LanguageSelectorDialog extends ConsumerWidget {
  const LanguageSelectorDialog({super.key});

  static void show(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) => const LanguageSelectorDialog(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.appColors;
    final currentLang = ref.watch(languageProvider);
    final loc = ref.watch(localizationProvider);

    return Padding(
      padding: AppSpacing.paddingScreen,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                loc.translate('selectLanguage'),
                style: AppTypography.headingSmall(colors.textPrimary),
              ),
              IconButton(
                icon: Icon(Icons.close_rounded, color: colors.textMuted),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          ...AppConstants.supportedLanguages.entries.map((entry) {
            final isSelected = currentLang == entry.key;
            return InkWell(
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              onTap: () {
                ref.read(languageProvider.notifier).setLanguage(entry.key);
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Language set to ${entry.value}'),
                    duration: const Duration(seconds: 1),
                  ),
                );
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                margin: const EdgeInsets.symmetric(vertical: 4),
                decoration: BoxDecoration(
                  color: isSelected ? colors.accent.withOpacity(0.15) : colors.surfaceElevated,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  border: Border.all(
                    color: isSelected ? colors.accent : colors.border,
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      entry.value,
                      style: AppTypography.labelBold(
                        isSelected ? colors.accent : colors.textPrimary,
                      ),
                    ),
                    if (isSelected)
                      Icon(Icons.check_circle_rounded, color: colors.accent, size: 20),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: AppSpacing.lg),
        ],
      ),
    );
  }
}
