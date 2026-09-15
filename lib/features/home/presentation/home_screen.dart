/**
 * Home Screen
 * Greets the doctor and surfaces recommended duty posts that open into chat.
 */

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/mock_data.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/widgets/duty_post_card.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Future<void> _openNotifications() async {
    await context.push('/notifications');
    if (mounted) setState(() {}); // Refresh the unread badge on return.
  }

  @override
  Widget build(BuildContext context) {
    final duties = MockData.duties;

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            'Hello, ${MockData.currentDoctorName}',
                            style: AppTypography.headingLarge(AppColors.textLightPrimary),
                          ),
                        ),
                        _buildNotificationBell(),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${duties.length} duty opportunities recommended for you',
                      style: AppTypography.bodyMedium(AppColors.textLightSecondary),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Text(
                      'Recommended For You',
                      style: AppTypography.headingSmall(AppColors.textLightPrimary),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                  ],
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              sliver: SliverList.separated(
                itemCount: duties.length,
                separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                itemBuilder: (context, index) => DutyPostCard(duty: duties[index]),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNotificationBell() {
    final unreadCount = MockData.unreadNotificationCount;

    return IconButton(
      onPressed: _openNotifications,
      icon: Stack(
        clipBehavior: Clip.none,
        children: [
          const Icon(Icons.notifications_outlined, color: AppColors.textLightPrimary),
          if (unreadCount > 0)
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
                  '$unreadCount',
                  textAlign: TextAlign.center,
                  style: AppTypography.bodySmall(Colors.white).copyWith(fontSize: 10, fontWeight: FontWeight.w700),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
