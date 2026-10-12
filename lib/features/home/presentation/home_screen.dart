import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/duty_post_card.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../duty_marketplace/data/duty_repository.dart';
import '../../notifications/data/notification_repository.dart';
import '../../doctor_profile/data/doctor_repository.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const String _all = 'All';
  String _specialty = _all;

  // Created once so rebuilds (e.g. changing the specialty chip) don't
  // re-subscribe to Firestore.
  final Stream<Map<String, dynamic>?> _profileStream = DoctorRepository.watchProfile();
  final Stream<List<Map<String, dynamic>>> _dutiesStream = DutyRepository.watchPublished();

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    const gutter = AppSpacing.gutter;

    return Scaffold(
      backgroundColor: colors.bg,
      body: SafeArea(
        bottom: false,
        child: StreamBuilder<List<Map<String, dynamic>>>(
          stream: _dutiesStream,
          builder: (context, snap) {
            final loading = snap.connectionState == ConnectionState.waiting;
            final duties = snap.data ?? [];
            final specialties = <String>{
              for (final d in duties)
                if ((d['specialtyName'] as String? ?? '').isNotEmpty) d['specialtyName'] as String,
            }.toList()
              ..sort();
            final selected = specialties.contains(_specialty) ? _specialty : _all;
            final visible = selected == _all
                ? duties
                : duties.where((d) => d['specialtyName'] == selected).toList();
            final openSlots = duties.fold<int>(
              0,
              (sum, d) => sum + ((d['remainingHeadcount'] as num?)?.toInt() ?? 0),
            );

            return CustomScrollView(
              slivers: [
                // Greeting + notifications
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(gutter, 16, gutter, 0),
                  sliver: SliverToBoxAdapter(
                    child: StreamBuilder<Map<String, dynamic>?>(
                      stream: _profileStream,
                      builder: (context, profileSnap) {
                        final name = profileSnap.data?['fullName'] as String? ?? 'Doctor';
                        return Row(
                          children: [
                            _Avatar(name: name),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _greeting(),
                                    style: AppTypography.bodySmall(colors.textSecondary),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    'Hello, $name',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: AppTypography.headingLarge(colors.textPrimary).copyWith(fontSize: 20),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            const _NotificationBell(),
                          ],
                        );
                      },
                    ),
                  ),
                ),

                // Search shortcut → Search tab
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(gutter, 20, gutter, 0),
                  sliver: SliverToBoxAdapter(
                    child: _SearchShortcut(onTap: () => context.go('/search')),
                  ),
                ),

                // Live availability summary
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(gutter, 16, gutter, 0),
                  sliver: SliverToBoxAdapter(
                    child: AppCard(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 14),
                      child: Row(
                        children: [
                          Expanded(
                            child: _SummaryStat(
                              icon: Icons.work_outline_outlined,
                              value: loading ? '—' : '${duties.length}',
                              label: 'Open duties',
                            ),
                          ),
                          Container(width: 1, height: 36, color: colors.border),
                          Expanded(
                            child: _SummaryStat(
                              icon: Icons.groups_outlined,
                              value: loading ? '—' : '$openSlots',
                              label: 'Positions',
                            ),
                          ),
                          Container(width: 1, height: 36, color: colors.border),
                          Expanded(
                            child: _SummaryStat(
                              icon: Icons.medical_services_outlined,
                              value: loading ? '—' : '${specialties.length}',
                              label: 'Specialties',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                // Specialty categories
                if (specialties.isNotEmpty)
                  SliverPadding(
                    padding: const EdgeInsets.only(top: AppSpacing.section),
                    sliver: SliverToBoxAdapter(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SectionHeader(
                            title: 'Browse by specialty',
                            padding: EdgeInsets.symmetric(horizontal: gutter),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          SizedBox(
                            height: 42,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              padding: const EdgeInsets.symmetric(horizontal: gutter, vertical: 2),
                              itemCount: specialties.length + 1,
                              separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.xs),
                              itemBuilder: (context, i) {
                                final label = i == 0 ? _all : specialties[i - 1];
                                return AppFilterChip(
                                  label: label,
                                  icon: i == 0 ? Icons.apps_outlined : null,
                                  selected: label == selected,
                                  onTap: () => setState(() => _specialty = label),
                                );
                              },
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                // Recommended opportunities
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(gutter, AppSpacing.section, gutter, AppSpacing.sm),
                  sliver: SliverToBoxAdapter(
                    child: SectionHeader(
                      title: 'Recommended For You',
                      actionLabel: 'View all',
                      onAction: () => context.go('/search'),
                    ),
                  ),
                ),
                if (loading)
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.all(32),
                      child: LoadingView(),
                    ),
                  )
                else if (visible.isEmpty)
                  const SliverToBoxAdapter(
                    child: EmptyStateView(
                      icon: Icons.work_outline_outlined,
                      title: 'No duties available',
                      description: 'New duty opportunities will appear here when hospitals post them.',
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(gutter, 0, gutter, 0),
                    sliver: SliverList.separated(
                      itemCount: visible.length,
                      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                      itemBuilder: (context, index) => DutyPostCard(duty: visible[index]),
                    ),
                  ),
                const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.navBarClearance)),
              ],
            );
          },
        ),
      ),
    );
  }

  static String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }
}

class _Avatar extends StatelessWidget {
  final String name;

  const _Avatar({required this.name});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    final initials = parts.isEmpty
        ? 'D'
        : (parts.length == 1 ? parts.first[0] : '${parts.first[0]}${parts.last[0]}').toUpperCase();
    return GestureDetector(
      onTap: () => context.go('/profile'),
      child: Container(
        width: 46,
        height: 46,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: colors.accentSoft,
          shape: BoxShape.circle,
          border: Border.all(color: colors.surface, width: 2),
          boxShadow: AppShadows.subtle(colors),
        ),
        child: Text(initials, style: AppTypography.labelBold(colors.accent).copyWith(fontSize: 15)),
      ),
    );
  }
}

class _SearchShortcut extends StatelessWidget {
  final VoidCallback onTap;

  const _SearchShortcut({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Material(
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        side: BorderSide(color: colors.border),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
          child: Row(
            children: [
              Icon(Icons.search_outlined, size: 20, color: colors.textMuted),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Search hospitals, specialties, cities',
                  style: AppTypography.bodyMedium(colors.textMuted),
                ),
              ),
              Icon(Icons.tune_outlined, size: 20, color: colors.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}

class _SummaryStat extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;

  const _SummaryStat({required this.icon, required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 16, color: colors.accent),
            const SizedBox(width: 6),
            Text(value, style: AppTypography.headingMedium(colors.textPrimary).copyWith(fontSize: 17)),
          ],
        ),
        const SizedBox(height: 2),
        Text(label, style: AppTypography.bodySmall(colors.textSecondary)),
      ],
    );
  }
}

class _NotificationBell extends StatelessWidget {
  const _NotificationBell();

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<int>(
      stream: NotificationRepository.watchUnreadCount(),
      builder: (context, snap) {
        final count = snap.data ?? 0;
        return CircleIconButton(
          icon: Icons.notifications_none_outlined,
          tooltip: 'Notifications',
          onPressed: () => context.push('/notifications'),
          badge: count > 0 ? CountBadge(count: count, color: AppColors.rose) : null,
        );
      },
    );
  }
}
