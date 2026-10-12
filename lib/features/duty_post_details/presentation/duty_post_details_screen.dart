import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/ui_kit.dart';

class DutyPostDetailsScreen extends StatelessWidget {
  final Map<String, dynamic> duty;

  const DutyPostDetailsScreen({super.key, required this.duty});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: const Text('Duty Details'),
      ),
      bottomNavigationBar: BottomActionBar(
        child: AppButton(
          label: 'Apply for this Duty',
          icon: Icons.send_outlined,
          onPressed: () => context.push('/duty-details', extra: duty),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AppCard(
              padding: const EdgeInsets.all(AppSpacing.lg - 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const IconTile(icon: Icons.local_hospital_outlined, size: 56),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    duty['facilityName'] as String? ?? '—',
                                    style: AppTypography.headingLarge(colors.textPrimary).copyWith(fontSize: 20),
                                  ),
                                ),
                                if (duty['isVerifiedOrg'] == true) ...[
                                  const SizedBox(width: 6),
                                  const Icon(Icons.verified_outlined, color: AppColors.emerald, size: 18),
                                ],
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              duty['specialtyName'] as String? ?? '—',
                              style: AppTypography.bodyMedium(colors.accent).copyWith(fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Wrap(
                    spacing: AppSpacing.xs,
                    runSpacing: AppSpacing.xs,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      StatusBadge(status: duty['status'] as String? ?? 'published'),
                      if ((duty['city'] as String? ?? '').isNotEmpty)
                        InfoChip(icon: Icons.location_on_outlined, label: duty['city'] as String),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: StatTile(
                    icon: Icons.payments_outlined,
                    value: formatInr(duty['amount']),
                    label: 'Per ${basisLabel(duty['basis'])}',
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: StatTile(
                    icon: Icons.groups_outlined,
                    value: '${duty['remainingHeadcount'] ?? 1} of ${duty['headcount'] ?? 1}',
                    label: 'Open positions',
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.section),

            const SectionHeader(title: 'Schedule & Compensation'),
            const SizedBox(height: AppSpacing.sm),
            AppCard(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 4),
              child: Column(
                children: [
                  DetailRow(icon: Icons.apartment_outlined, label: 'Department', value: duty['department'] as String? ?? '—'),
                  const Divider(),
                  DetailRow(icon: Icons.login_outlined, label: 'Starts', value: duty['startAt'] as String? ?? '—'),
                  const Divider(),
                  DetailRow(icon: Icons.logout_outlined, label: 'Ends', value: duty['endAt'] as String? ?? '—'),
                  const Divider(),
                  DetailRow(
                    icon: Icons.payments_outlined,
                    label: 'Compensation',
                    value: '${formatInr(duty['amount'])} / ${basisLabel(duty['basis'])}',
                    valueColor: AppColors.emerald,
                  ),
                  const Divider(),
                  DetailRow(
                    icon: Icons.groups_outlined,
                    label: 'Open Positions',
                    value: '${duty['remainingHeadcount'] ?? 1} of ${duty['headcount'] ?? 1}',
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.section),

            const SectionHeader(title: 'Requirements'),
            const SizedBox(height: AppSpacing.sm),
            AppCard(
              child: Row(
                children: [
                  const IconTile(icon: Icons.school_outlined, size: 40),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      duty['qualificationRequired'] as String? ?? '—',
                      style: AppTypography.bodyLarge(colors.textPrimary).copyWith(fontSize: 14),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
