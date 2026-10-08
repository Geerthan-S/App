import 'package:flutter/material.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';

class ChatScreen extends StatelessWidget {
  final Map<String, dynamic> conversation;
  const ChatScreen({super.key, required this.conversation});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final hospitalName = conversation['hospitalName'] as String? ?? 'Hospital';

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text(hospitalName, style: AppTypography.headingMedium(colors.textPrimary)),
      ),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: AppSpacing.paddingScreen,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.chat_bubble_outline_rounded, size: 64, color: colors.textMuted),
                const SizedBox(height: AppSpacing.md),
                Text('Direct Messaging Coming Soon', style: AppTypography.headingSmall(colors.textPrimary)),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Real-time chat between doctors and hospitals will be available in a future update. '
                  'Use the hospital contact released via your confirmed assignment to coordinate.',
                  style: AppTypography.bodyMedium(colors.textSecondary),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.xl),
                OutlinedButton.icon(
                  icon: const Icon(Icons.arrow_back_rounded, size: 18),
                  label: const Text('Go Back'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primaryLight,
                    side: BorderSide(color: colors.border),
                    padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 24),
                  ),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
