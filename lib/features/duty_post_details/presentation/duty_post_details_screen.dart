import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/ui_kit.dart';

/// Read-only view of a duty post; Apply hands over to Duty Details, which
/// owns the application flow.
class DutyPostDetailsScreen extends StatelessWidget {
  final Map<String, dynamic> duty;

  const DutyPostDetailsScreen({super.key, required this.duty});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final city = duty['city'] as String? ?? '';
    final department = duty['department'] as String? ?? '';
    final specialty = duty['specialtyName'] as String? ?? '';
    final qualification = duty['qualificationRequired'] as String? ?? '';
    final start = parseIsoLocal(duty['startAtIso']);
    final end = parseIsoLocal(duty['endAtIso']);
    final headcount = (duty['headcount'] as num?)?.toInt();
    final remaining = (duty['remainingHeadcount'] as num?)?.toInt();

    final rows = <Widget>[
      if (department.isNotEmpty)
        DetailRow(label: 'Department', value: department),
      DetailRow(
        label: 'Payment',
        value: '${formatInr(duty['amount'])} per ${basisLabel(duty['basis'])}',
      ),
      if (headcount != null && remaining != null)
        DetailRow(label: 'Positions', value: '$remaining of $headcount open'),
      if (qualification.isNotEmpty)
        DetailRow(label: 'Qualification', value: qualification),
    ];

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(),
      bottomNavigationBar: BottomActionBar(
        child: AppButton(
          label: 'Apply for this duty',
          onPressed: () => context.push('/duty-details', extra: duty),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.gutter,
          8,
          AppSpacing.gutter,
          AppSpacing.lg,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: formatInr(duty['amount'])),
                  TextSpan(
                    text: '  / ${basisLabel(duty['basis'])}',
                    style: AppTypography.bodyMedium(
                      colors.textSecondary,
                    ).copyWith(fontSize: 16, letterSpacing: 0),
                  ),
                ],
              ),
              style: AppTypography.amount(colors.textPrimary, fontSize: 44),
            ),
            const SizedBox(height: AppSpacing.lg),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: colors.surface,
                borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          duty['facilityName'] as String? ?? '—',
                          style: AppTypography.headingLarge(
                            colors.textPrimary,
                          ).copyWith(fontSize: 19),
                        ),
                      ),
                      if (duty['isVerifiedOrg'] == true) ...[
                        const SizedBox(width: 6),
                        const VerifiedMark(size: 16),
                      ],
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    [specialty, city].where((s) => s.isNotEmpty).join(' · '),
                    style: AppTypography.bodySmall(
                      colors.textSecondary,
                    ).copyWith(fontSize: 13),
                  ),
                  const SizedBox(height: 12),
                  StatusBadge(status: duty['status'] as String? ?? 'published'),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: colors.surface,
                borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
              ),
              child: ShiftTimeline(
                startLabel: start != null
                    ? formatDayTime(start)
                    : '${duty['startAt'] ?? '—'}',
                endLabel: end != null
                    ? formatDayTime(end)
                    : '${duty['endAt'] ?? '—'}',
              ),
            ),
            const SizedBox(height: AppSpacing.section),
            const GroupLabel('Terms & requirements'),
            for (final row in rows) ...[
              row,
              Divider(height: 1, color: colors.border),
            ],
          ],
        ),
      ),
    );
  }
}
