import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/widgets/duty_row.dart';
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
  final Stream<Map<String, dynamic>?> _profileStream =
      DoctorRepository.watchProfile();
  final Stream<List<Map<String, dynamic>>> _dutiesStream =
      DutyRepository.watchPublished();
  final Stream<List<Map<String, dynamic>>> _assignmentsStream =
      DoctorRepository.watchAssignments();

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
                if ((d['specialtyName'] as String? ?? '').isNotEmpty)
                  d['specialtyName'] as String,
            }.toList()..sort();
            final selected = specialties.contains(_specialty)
                ? _specialty
                : _all;
            final visible = selected == _all
                ? duties
                : duties.where((d) => d['specialtyName'] == selected).toList();
            final openSlots = duties.fold<int>(
              0,
              (sum, d) =>
                  sum + ((d['remainingHeadcount'] as num?)?.toInt() ?? 0),
            );

            return CustomScrollView(
              slivers: [
                // Avatar + notifications
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(gutter, 12, gutter, 0),
                  sliver: SliverToBoxAdapter(
                    child: StreamBuilder<Map<String, dynamic>?>(
                      stream: _profileStream,
                      builder: (context, profileSnap) {
                        final name =
                            profileSnap.data?['fullName'] as String? ?? '';
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Semantics(
                                  button: true,
                                  label: 'Profile',
                                  child: GestureDetector(
                                    onTap: () => context.go('/profile'),
                                    child: InitialsAvatar(name: name, size: 44),
                                  ),
                                ),
                                const Spacer(),
                                const _NotificationBell(),
                              ],
                            ),
                            const SizedBox(height: 20),
                            Text(
                              name.isEmpty
                                  ? _greeting()
                                  : '${_greeting()}, $name',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppTypography.bodyMedium(
                                colors.textSecondary,
                              ).copyWith(fontSize: 14),
                            ),
                          ],
                        );
                      },
                    ),
                  ),
                ),

                // Headline built from live counts
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(gutter, 4, gutter, 0),
                  sliver: SliverToBoxAdapter(
                    child: Text.rich(
                      TextSpan(
                        children: loading
                            ? [const TextSpan(text: 'Finding open duties…')]
                            : duties.isEmpty
                            ? [
                                const TextSpan(text: 'No open duties\n'),
                                TextSpan(
                                  text: 'right now',
                                  style: TextStyle(color: colors.textMuted),
                                ),
                              ]
                            : [
                                TextSpan(
                                  text:
                                      '${duties.length} ${duties.length == 1 ? 'duty' : 'duties'} open\n',
                                ),
                                TextSpan(
                                  text:
                                      '$openSlots ${openSlots == 1 ? 'position' : 'positions'}'
                                      ' · ${specialties.length} ${specialties.length == 1 ? 'specialty' : 'specialties'}',
                                  style: TextStyle(color: colors.textMuted),
                                ),
                              ],
                      ),
                      style: AppTypography.display(colors.textPrimary),
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

                // Most relevant offer / next shift
                SliverToBoxAdapter(
                  child: StreamBuilder<List<Map<String, dynamic>>>(
                    stream: _assignmentsStream,
                    builder: (context, asgSnap) {
                      final focus = _focusAssignment(asgSnap.data ?? const []);
                      if (focus == null) return const SizedBox.shrink();
                      return Padding(
                        padding: const EdgeInsets.fromLTRB(
                          gutter,
                          20,
                          gutter,
                          0,
                        ),
                        child: _HeroCard(assignment: focus),
                      );
                    },
                  ),
                ),

                // Open duties
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    gutter,
                    AppSpacing.section,
                    gutter,
                    AppSpacing.sm,
                  ),
                  sliver: SliverToBoxAdapter(
                    child: SectionHeader(
                      title: 'Open duties',
                      actionLabel: 'See all',
                      onAction: () => context.go('/search'),
                    ),
                  ),
                ),
                if (specialties.isNotEmpty)
                  SliverToBoxAdapter(
                    child: SizedBox(
                      height: 40,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(
                          horizontal: gutter,
                          vertical: 2,
                        ),
                        itemCount: specialties.length + 1,
                        separatorBuilder: (_, __) =>
                            const SizedBox(width: AppSpacing.xs),
                        itemBuilder: (context, i) {
                          final label = i == 0 ? _all : specialties[i - 1];
                          return AppFilterChip(
                            label: label,
                            selected: label == selected,
                            onTap: () => setState(() => _specialty = label),
                          );
                        },
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
                      description:
                          'New duty opportunities will appear here when hospitals post them.',
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(gutter, 4, gutter, 0),
                    sliver: SliverToBoxAdapter(
                      child: DutyList(duties: visible),
                    ),
                  ),
                const SliverToBoxAdapter(
                  child: SizedBox(height: AppSpacing.navBarClearance),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  /// The assignment that most needs attention: the pending offer expiring
  /// soonest, otherwise the next confirmed or in-progress shift.
  static Map<String, dynamic>? _focusAssignment(
    List<Map<String, dynamic>> assignments,
  ) {
    final now = DateTime.now();
    final offers =
        assignments.where((a) {
          if (a['status'] != 'selected') return false;
          final expires = parseIsoLocal(a['expiresAt']);
          return expires == null || expires.isAfter(now);
        }).toList()..sort((a, b) {
          final ea = parseIsoLocal(a['expiresAt']);
          final eb = parseIsoLocal(b['expiresAt']);
          if (ea == null || eb == null) return ea == null ? 1 : -1;
          return ea.compareTo(eb);
        });
    if (offers.isNotEmpty) return offers.first;

    final upcoming =
        assignments.where((a) {
          if (a['status'] == 'in_progress') return true;
          if (a['status'] != 'confirmed') return false;
          final end =
              parseIsoLocal(a['endAtIso']) ?? parseIsoLocal(a['startAtIso']);
          return end == null || end.isAfter(now);
        }).toList()..sort((a, b) {
          final sa = parseIsoLocal(a['startAtIso']);
          final sb = parseIsoLocal(b['startAtIso']);
          if (sa == null || sb == null) return sa == null ? 1 : -1;
          return sa.compareTo(sb);
        });
    return upcoming.isEmpty ? null : upcoming.first;
  }

  static String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }
}

/// Dark hero surface for the one assignment that needs attention. Actions
/// (accept / decline / contact) stay in My Duties, which this card opens.
class _HeroCard extends StatelessWidget {
  final Map<String, dynamic> assignment;

  const _HeroCard({required this.assignment});

  String _expiryLabel() {
    final expires = parseIsoLocal(assignment['expiresAt']);
    if (expires == null) return 'Offer';
    final diff = expires.difference(DateTime.now());
    if (diff.inHours > 0) {
      return 'Offer · expires in ${diff.inHours}h ${diff.inMinutes % 60}m';
    }
    return 'Offer · expires in ${diff.inMinutes.clamp(0, 59)}m';
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final isOffer = assignment['status'] == 'selected';
    final isLive = assignment['status'] == 'in_progress';
    final start = parseIsoLocal(assignment['startAtIso']);
    final fg = colors.onAccent;
    final fgMuted = colors.onAccent.withValues(alpha: 0.6);
    final subtitle = [
      assignment['specialtyName'] as String? ?? '',
      assignment['department'] as String? ?? '',
    ].where((s) => s.isNotEmpty).join(' · ');

    return Material(
      color: colors.accent,
      borderRadius: BorderRadius.circular(AppSpacing.radiusXl),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.go('/messages'),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: isOffer
                          ? HighlightTag(_expiryLabel())
                          : Text(
                              isLive ? 'Shift in progress' : 'Next shift',
                              style: AppTypography.labelBold(fgMuted),
                            ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  if (start != null)
                    Text(
                      DateFormat('d MMM').format(start),
                      style: AppTypography.bodySmall(
                        fgMuted,
                      ).copyWith(fontSize: 13),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              Text(
                assignment['facilityName'] as String? ?? '—',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.headingLarge(fg).copyWith(fontSize: 20),
              ),
              if (subtitle.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.bodySmall(
                    fgMuted,
                  ).copyWith(fontSize: 13),
                ),
              ],
              const SizedBox(height: 16),
              Divider(height: 1, color: fg.withValues(alpha: 0.12)),
              const SizedBox(height: 14),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  _HeroFact(
                    label: 'Pay',
                    value: formatInr(assignment['amount']),
                  ),
                  const SizedBox(width: 24),
                  if (start != null)
                    Flexible(
                      child: _HeroFact(
                        label: 'Starts',
                        value: formatTime(start),
                      ),
                    ),
                  const Spacer(),
                  Material(
                    color: colors.surface,
                    borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(
                        AppSpacing.radiusPill,
                      ),
                      onTap: () => context.go('/messages'),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 10,
                        ),
                        child: Text(
                          isOffer ? 'Review offer' : 'View duty',
                          style: AppTypography.labelBold(colors.textPrimary),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HeroFact extends StatelessWidget {
  final String label;
  final String value;

  const _HeroFact({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final fg = context.appColors.onAccent;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: AppTypography.bodySmall(
            fg.withValues(alpha: 0.55),
          ).copyWith(fontSize: 11),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppTypography.amount(fg, fontSize: 15),
        ),
      ],
    );
  }
}

class _SearchShortcut extends StatelessWidget {
  final VoidCallback onTap;

  const _SearchShortcut({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Semantics(
      button: true,
      label: 'Search duties',
      child: Material(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
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
                    'Hospital, specialty or city',
                    style: AppTypography.bodyMedium(
                      colors.textMuted,
                    ).copyWith(fontSize: 14),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
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
          badge: count > 0
              ? CountBadge(count: count, color: AppColors.rose)
              : null,
        );
      },
    );
  }
}
