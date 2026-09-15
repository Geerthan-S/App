/**
 * In-App Notifications Inbox Screen
 * Reuses MockData.notifications, MockData.conversations and MockData.duties
 * — no separate notifications model. Tapping a notification marks it read
 * and opens the relevant Chat or Duty Details screen.
 */

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/mock_data.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/state_views.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  static const Map<String, IconData> _iconByType = {
    'message': Icons.chat_bubble_outline_rounded,
    'confirmed': Icons.check_circle_outline_rounded,
    'new_duty': Icons.local_hospital_outlined,
    'verification': Icons.shield_outlined,
  };

  void _openNotification(Map<String, dynamic> notification) {
    setState(() => notification['isRead'] = true);

    final conversationId = notification['conversationId'] as String?;
    if (conversationId != null) {
      final conversation = MockData.conversations.firstWhere(
        (c) => c['conversationId'] == conversationId,
        orElse: () => <String, dynamic>{},
      );
      if (conversation.isNotEmpty) {
        context.push('/chat', extra: conversation);
        return;
      }
    }

    final dutyId = notification['dutyId'] as String?;
    if (dutyId != null) {
      final duty = MockData.duties.firstWhere(
        (d) => d['dutyId'] == dutyId,
        orElse: () => <String, dynamic>{},
      );
      if (duty.isNotEmpty) {
        context.push('/post-details', extra: duty);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final notifications = MockData.notifications;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text('Notifications', style: AppTypography.headingMedium(colors.textPrimary)),
      ),
      body: SafeArea(
        child: notifications.isEmpty
            ? const EmptyStateView(
                icon: Icons.notifications_none_rounded,
                title: 'No notifications yet',
                description: 'Updates about your duties and chats will appear here.',
              )
            : ListView.separated(
                padding: AppSpacing.paddingScreen,
                itemCount: notifications.length,
                separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                itemBuilder: (context, index) => _buildNotificationCard(notifications[index]),
              ),
      ),
    );
  }

  Widget _buildNotificationCard(Map<String, dynamic> notification) {
    final colors = context.appColors;
    final isUnread = notification['isRead'] == false;
    final icon = _iconByType[notification['type']] ?? Icons.notifications_active_rounded;

    return AppCard(
      onTap: () => _openNotification(notification),
      borderColor: isUnread ? AppColors.primary.withOpacity(0.5) : null,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: isUnread ? AppColors.primary.withOpacity(0.15) : colors.surfaceElevated,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            ),
            child: Icon(
              icon,
              size: 20,
              color: isUnread ? AppColors.primary : colors.textMuted,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  notification['title'] as String,
                  style: AppTypography.labelBold(colors.textPrimary),
                ),
                const SizedBox(height: 2),
                Text(
                  notification['body'] as String,
                  style: AppTypography.bodyMedium(colors.textSecondary),
                ),
                const SizedBox(height: 4),
                Text(
                  notification['time'] as String,
                  style: AppTypography.bodySmall(colors.textMuted),
                ),
              ],
            ),
          ),
          if (isUnread) ...[
            const SizedBox(width: AppSpacing.xs),
            Container(
              width: 8,
              height: 8,
              margin: const EdgeInsets.only(top: 4),
              decoration: const BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
