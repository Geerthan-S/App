import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/state_views.dart';
import '../data/notification_repository.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  static const Map<String, IconData> _icons = {
    'message': Icons.chat_bubble_outline_rounded,
    'confirmed': Icons.check_circle_outline_rounded,
    'new_duty': Icons.local_hospital_outlined,
    'verification': Icons.shield_outlined,
    'info': Icons.info_outline_rounded,
  };

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text('Notifications', style: AppTypography.headingMedium(colors.textPrimary)),
      ),
      body: SafeArea(
        child: StreamBuilder<List<Map<String, dynamic>>>(
          stream: NotificationRepository.watchAll(),
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            final notifications = snap.data ?? [];
            if (notifications.isEmpty) {
              return const EmptyStateView(
                icon: Icons.notifications_none_rounded,
                title: 'No notifications yet',
                description: 'Updates about your duties and verifications will appear here.',
              );
            }
            return ListView.separated(
              padding: AppSpacing.paddingScreen,
              itemCount: notifications.length,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, index) =>
                  _NotificationCard(notification: notifications[index]),
            );
          },
        ),
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  final Map<String, dynamic> notification;
  const _NotificationCard({required this.notification});

  Future<void> _open(BuildContext context) async {
    final id = notification['notificationId'] as String;
    NotificationRepository.markRead(id).ignore();

    final dutyId = notification['dutyId'] as String?;
    if (dutyId != null && dutyId.isNotEmpty) {
      try {
        final doc = await FirebaseFirestore.instance.collection('duties').doc(dutyId).get();
        if (doc.exists && context.mounted) {
          context.push('/duty-details', extra: Map<String, dynamic>.from(doc.data()!));
          return;
        }
      } catch (_) {}
    }
    // No navigation target — just marking read is enough
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final isUnread = notification['isRead'] == false;
    final icon = NotificationsScreen._icons[notification['type']] ??
        Icons.notifications_active_rounded;

    return AppCard(
      onTap: () => _open(context),
      borderColor: isUnread ? AppColors.primary.withValues(alpha: 0.5) : null,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: isUnread
                  ? AppColors.primary.withValues(alpha: 0.15)
                  : colors.surfaceElevated,
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
                Text(notification['title'] as String,
                    style: AppTypography.labelBold(colors.textPrimary)),
                const SizedBox(height: 2),
                Text(notification['body'] as String,
                    style: AppTypography.bodyMedium(colors.textSecondary)),
                const SizedBox(height: 4),
                Text(notification['time'] as String,
                    style: AppTypography.bodySmall(colors.textMuted)),
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
