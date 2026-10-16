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
      appBar: AppBar(title: Text(hospitalName)),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: AppSpacing.paddingScreen,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 76,
                  height: 76,
                  decoration: BoxDecoration(
                    color: colors.surfaceElevated,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.chat_bubble_outline_outlined,
                    size: 32,
                    color: colors.accent,
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  'Direct Messaging Coming Soon',
                  style: AppTypography.headingSmall(colors.textPrimary),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Real-time chat between doctors and hospitals will be available in a future update. '
                  'Use the hospital contact released via your confirmed assignment to coordinate.',
                  style: AppTypography.bodyMedium(colors.textSecondary),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.xl),
                OutlinedButton.icon(
                  icon: const Icon(Icons.arrow_back_outlined, size: 18),
                  label: const Text('Go Back'),
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
