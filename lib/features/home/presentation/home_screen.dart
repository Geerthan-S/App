import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/widgets/duty_post_card.dart';
import '../../../core/widgets/state_views.dart';
import '../../duty_marketplace/data/duty_repository.dart';
import '../../notifications/data/notification_repository.dart';
import '../../doctor_profile/data/doctor_repository.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return Scaffold(
      backgroundColor: colors.bg,
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
              sliver: SliverToBoxAdapter(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: StreamBuilder<Map<String, dynamic>?>(
                        stream: DoctorRepository.watchProfile(),
                        builder: (context, snap) {
                          final name = snap.data?['fullName'] as String? ?? 'Doctor';
                          return Text(
                            'Hello, $name',
                            style: AppTypography.headingLarge(colors.textPrimary),
                          );
                        },
                      ),
                    ),
                    _NotificationBell(),
                  ],
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              sliver: SliverToBoxAdapter(
                child: Text(
                  'Recommended For You',
                  style: AppTypography.headingSmall(colors.textPrimary),
                ),
              ),
            ),
            StreamBuilder<List<Map<String, dynamic>>>(
              stream: DutyRepository.watchPublished(),
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.all(32),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                  );
                }
                final duties = snap.data ?? [];
                if (duties.isEmpty) {
                  return const SliverToBoxAdapter(
                    child: EmptyStateView(
                      icon: Icons.work_outline_rounded,
                      title: 'No duties available',
                      description: 'New duty opportunities will appear here when hospitals post them.',
                    ),
                  );
                }
                return SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  sliver: SliverList.separated(
                    itemCount: duties.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                    itemBuilder: (context, index) => DutyPostCard(duty: duties[index]),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _NotificationBell extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return StreamBuilder<int>(
      stream: NotificationRepository.watchUnreadCount(),
      builder: (context, snap) {
        final count = snap.data ?? 0;
        return IconButton(
          onPressed: () => context.push('/notifications'),
          icon: Stack(
            clipBehavior: Clip.none,
            children: [
              Icon(Icons.notifications_outlined, color: colors.textPrimary),
              if (count > 0)
                Positioned(
                  right: -2,
                  top: -2,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    constraints: const BoxConstraints(minWidth: 16),
                    decoration: const BoxDecoration(
                      color: AppColors.rose,
                      borderRadius: BorderRadius.all(Radius.circular(AppSpacing.radiusPill)),
                    ),
                    child: Text(
                      '$count',
                      textAlign: TextAlign.center,
                      style: AppTypography.bodySmall(Colors.white)
                          .copyWith(fontSize: 10, fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}
