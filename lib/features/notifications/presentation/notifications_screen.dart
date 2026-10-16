import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/widgets/state_views.dart';
import '../../duty_marketplace/data/duty_repository.dart';
import '../data/notification_repository.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  static const Map<String, IconData> _icons = {
    'message': Icons.chat_bubble_outline_outlined,
    'confirmed': Icons.check_circle_outline_outlined,
    'new_duty': Icons.work_outline,
    'verification': Icons.shield_outlined,
    'info': Icons.info_outline,
  };

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: const Text('Notifications')),
      body: SafeArea(
        child: StreamBuilder<List<Map<String, dynamic>>>(
          stream: NotificationRepository.watchAll(),
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const LoadingView();
            }
            final notifications = snap.data ?? [];
            if (notifications.isEmpty) {
              return const EmptyStateView(
                icon: Icons.notifications_none_outlined,
                title: 'No notifications yet',
                description:
                    'Updates about your duties and verifications will appear here.',
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.gutter,
                4,
                AppSpacing.gutter,
                AppSpacing.lg,
              ),
              itemCount: notifications.length,
              separatorBuilder: (_, __) =>
                  Divider(height: 1, color: colors.border),
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
        final doc = await FirebaseFirestore.instance
            .collection('duties')
            .doc(dutyId)
            .get();
        if (doc.exists && context.mounted) {
          context.push(
            '/duty-details',
            extra: DutyRepository.toUiMap(doc.id, doc.data()!),
          );
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
    final icon =
        NotificationsScreen._icons[notification['type']] ??
        Icons.notifications_none_outlined;

    return InkWell(
      onTap: () => _open(context),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Icon(
                icon,
                size: 20,
                color: isUnread ? colors.textPrimary : colors.textMuted,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          notification['title'] as String,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: AppTypography.headingSmall(colors.textPrimary)
                              .copyWith(
                                fontSize: 14,
                                fontWeight: isUnread
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                              ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      Text(
                        notification['time'] as String,
                        style: AppTypography.bodySmall(colors.textMuted),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    notification['body'] as String,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.bodyMedium(colors.textSecondary),
                  ),
                ],
              ),
            ),
            if (isUnread) ...[
              const SizedBox(width: AppSpacing.sm),
              Semantics(
                label: 'Unread',
                child: Container(
                  width: 8,
                  height: 8,
                  margin: const EdgeInsets.only(top: 6),
                  decoration: BoxDecoration(
                    color: colors.accent,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
