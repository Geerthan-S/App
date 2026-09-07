/**
 * In-App Notifications Inbox Screen
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifications = [
      {
        'title': 'Duty Offer Received!',
        'body': 'You have been selected for General Medicine duty at Apollo Specialty Hospital.',
        'time': '10 mins ago',
        'isRead': false,
      },
      {
        'title': 'Verification In Progress',
        'body': 'Your medical council registration document has been claimed by a platform verifier.',
        'time': '2 hours ago',
        'isRead': true,
      },
      {
        'title': 'New Nearby Duty Matching Your Specialty',
        'body': 'Emergency & Critical Care duty published at Fortis Hospital, Bengaluru.',
        'time': 'Yesterday',
        'isRead': true,
      },
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications Inbox'),
      ),
      body: SafeArea(
        child: ListView.separated(
          padding: AppSpacing.paddingScreen,
          itemCount: notifications.length,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
          itemBuilder: (context, index) {
            final notif = notifications[index];
            final isUnread = notif['isRead'] == false;

            return AppCard(
              borderColor: isUnread ? AppColors.primary.withOpacity(0.5) : null,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: isUnread ? AppColors.primary.withOpacity(0.15) : AppColors.surfaceElevatedDark,
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    ),
                    child: Icon(
                      Icons.notifications_active_rounded,
                      size: 20,
                      color: isUnread ? AppColors.primary : AppColors.textDarkMuted,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          notif['title'] as String,
                          style: AppTypography.headingSmall(AppColors.textDarkPrimary).copyWith(fontSize: 14),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          notif['body'] as String,
                          style: AppTypography.bodyMedium(AppColors.textDarkSecondary),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          notif['time'] as String,
                          style: AppTypography.bodySmall(AppColors.textDarkMuted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
