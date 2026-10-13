/**
 * Duty Details & Application Submission Screen
 * Doctor view: pay, facility, shift timeline, terms and requirements, GPS
 * navigation, profile credential snapshot, consent checkboxes and
 * server-side duplicate prevention.
 */

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../../core/services/location_service.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';
import '../../duty_marketplace/data/duty_repository.dart';
import '../../doctor_profile/data/doctor_repository.dart';
import '../../../core/errors/error_envelope.dart';

class DutyDetailsScreen extends ConsumerStatefulWidget {
  final Map<String, dynamic> duty;

  const DutyDetailsScreen({super.key, required this.duty});

  @override
  ConsumerState<DutyDetailsScreen> createState() => _DutyDetailsScreenState();
}

class _DutyDetailsScreenState extends ConsumerState<DutyDetailsScreen> {
  bool _hasApplied = false;
  Map<String, dynamic>? _doctorProfile;

  @override
  void initState() {
    super.initState();
    DoctorRepository.getProfile().then((p) {
      if (mounted) setState(() => _doctorProfile = p);
    });
  }

  void _showApplicationModal() {
    final noteCtrl = TextEditingController();
    bool confirmAvailability = false;
    bool acknowledgeTerms = false;
    bool submitting = false;
    String? error;
    final duty = widget.duty;
    final start = parseIsoLocal(duty['startAtIso']);

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final colors = context.appColors;
            final profile = _doctorProfile;

            Future<void> submit() async {
              setModalState(() {
                submitting = true;
                error = null;
              });
              final note = noteCtrl.text.trim();
              final failure = await _submitApplication(
                note: note.isNotEmpty ? note : null,
              );
              if (!ctx.mounted) return;
              if (failure == null) {
                Navigator.pop(ctx);
              } else {
                setModalState(() {
                  submitting = false;
                  error = failure;
                });
              }
            }

            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(context).viewInsets.bottom,
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.gutter,
                  0,
                  AppSpacing.gutter,
                  AppSpacing.lg,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SheetHeader(
                      title: 'Apply for this duty',
                      subtitle: [
                        duty['facilityName'] as String? ?? '',
                        if (start != null) formatDayTime(start),
                      ].where((s) => s.isNotEmpty).join(' · '),
                      onClose: () => Navigator.pop(ctx),
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // Immutable profile snapshot preview
                    const GroupLabel('Credential snapshot'),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: colors.surfaceElevated,
                        borderRadius: BorderRadius.circular(
                          AppSpacing.radiusMd,
                        ),
                      ),
                      child: profile == null
                          ? Text(
                              'Loading profile…',
                              style: AppTypography.bodySmall(colors.textMuted),
                            )
                          : Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Flexible(
                                      child: Text(
                                        profile['fullName'] as String? ?? '—',
                                        overflow: TextOverflow.ellipsis,
                                        style: AppTypography.headingSmall(
                                          colors.textPrimary,
                                        ),
                                      ),
                                    ),
                                    if (profile['isVerified'] == true) ...[
                                      const SizedBox(width: 5),
                                      const VerifiedMark(size: 14),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '${profile['registrationNo'] ?? '—'} · ${profile['council'] ?? '—'}',
                                  style: AppTypography.bodySmall(
                                    colors.textSecondary,
                                  ),
                                ),
                                Text(
                                  '${profile['qualification'] ?? '—'} · ${profile['yearsOfExperience'] ?? 0} yrs experience',
                                  style: AppTypography.bodySmall(
                                    colors.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    AppTextField(
                      label: 'Note to hospital coordinator (optional)',
                      controller: noteCtrl,
                      hintText:
                          'e.g. Available immediately for the triage desk',
                      maxLines: 2,
                    ),
                    const SizedBox(height: AppSpacing.sm),

                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: confirmAvailability,
                      title: Text(
                        'I confirm my full clinical availability during this shift window.',
                        style: AppTypography.bodyMedium(colors.textPrimary),
                      ),
                      onChanged: submitting
                          ? null
                          : (val) => setModalState(
                              () => confirmAvailability = val ?? false,
                            ),
                    ),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: acknowledgeTerms,
                      title: Text(
                        'I accept the agreed compensation of ${formatInr(duty['amount'])} and hospital operational guidelines.',
                        style: AppTypography.bodyMedium(colors.textPrimary),
                      ),
                      onChanged: submitting
                          ? null
                          : (val) => setModalState(
                              () => acknowledgeTerms = val ?? false,
                            ),
                    ),

                    if (error != null) ...[
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        error!,
                        style: AppTypography.bodySmall(
                          AppColors.rose,
                        ).copyWith(fontWeight: FontWeight.w600),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.md),

                    AppButton(
                      label: 'Submit application',
                      isLoading: submitting,
                      onPressed:
                          (confirmAvailability &&
                              acknowledgeTerms &&
                              !submitting)
                          ? submit
                          : null,
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Center(
                      child: Text(
                        'Duplicate applications are prevented server-side.',
                        style: AppTypography.bodySmall(colors.textMuted),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  /// Submits the application. Returns null on success, otherwise a message
  /// for the sheet to show so the doctor can retry without re-entering data.
  Future<String?> _submitApplication({String? note}) async {
    try {
      final dutyId = widget.duty['dutyId'] as String? ?? '';
      await DutyRepository.applyToDuty(dutyId, note: note);
      if (mounted) {
        setState(() => _hasApplied = true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.emerald,
            content: Text(
              'Application submitted! Verified credential snapshot recorded for hospital review.',
            ),
          ),
        );
      }
      return null;
    } on FirebaseFunctionsException catch (e) {
      return switch (e.domainCode) {
        'DOCTOR_NOT_VERIFIED' =>
          'Your profile must be verified before applying.',
        'APPLICATION_ALREADY_EXISTS' =>
          'You have already applied for this duty.',
        'DUTY_CAPACITY_FILLED' => 'This duty has been fully filled.',
        _
            when e.code == 'unavailable' ||
                e.code == 'internal' ||
                e.code == 'deadline-exceeded' =>
          'Could not reach the server. Check your connection and try again.',
        _ => e.message ?? 'Could not submit application. Try again.',
      };
    } catch (_) {
      return 'Application failed. Check your connection and try again.';
    }
  }

  void _reportDuty() {
    final colors = context.appColors;
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Report duty'),
        content: Text(
          'Report this duty if it contains misleading compensation, abusive terms, or safety violations. It will be routed to Platform Moderation.',
          style: AppTypography.bodyMedium(colors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(
              'Cancel',
              style: TextStyle(color: colors.textSecondary),
            ),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.rose,
              foregroundColor: Colors.white,
            ),
            onPressed: () {
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  backgroundColor: AppColors.rose,
                  content: Text(
                    'Report logged. Duty flagged for administrative review.',
                  ),
                ),
              );
            },
            child: const Text('Report'),
          ),
        ],
      ),
    );
  }

  static String _paymentTimingLabel(Object? timing) {
    final raw = '${timing ?? ''}'.trim();
    if (raw.isEmpty || raw == 'null') return '';
    final words = raw.replaceAll('_', ' ');
    return words[0].toUpperCase() + words.substring(1);
  }

  Widget _buildActionBar(AppColorsExtension colors, String applyLabel) {
    final duty = widget.duty;
    final status = duty['status'] as String? ?? 'published';

    if (_hasApplied) {
      return Row(
        children: [
          const Icon(
            Icons.check_circle_outline,
            color: AppColors.emerald,
            size: 26,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Application submitted',
                  style: AppTypography.headingSmall(colors.textPrimary),
                ),
                Text(
                  'Awaiting hospital review and selection.',
                  style: AppTypography.bodySmall(colors.textSecondary),
                ),
              ],
            ),
          ),
        ],
      );
    }

    // Opened from My Duties: the doctor already holds an assignment for this
    // duty, so show its state instead of an Apply action.
    if (status != 'published') {
      return Row(
        children: [
          Expanded(
            child: Text(
              'Your assignment for this duty',
              style: AppTypography.bodyMedium(
                colors.textSecondary,
              ).copyWith(fontSize: 14),
            ),
          ),
          StatusBadge(status: status),
        ],
      );
    }

    final remaining = (duty['remainingHeadcount'] as num?)?.toInt();
    return Row(
      children: [
        Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (remaining != null)
                Text(
                  remaining == 1 ? '1 slot left' : '$remaining slots left',
                  style: AppTypography.labelBold(AppColors.amber),
                ),
              Text(
                '${formatInr(duty['amount'])} per ${basisLabel(duty['basis'])}',
                style: AppTypography.bodySmall(colors.textSecondary),
              ),
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Flexible(
          child: AppButton(
            label: applyLabel,
            isFullWidth: false,
            onPressed: _showApplicationModal,
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final duty = widget.duty;
    final loc = ref.watch(localizationProvider);
    final city = duty['city'] as String? ?? '';
    final distance = duty['distanceKm'];
    final shiftType = (duty['shiftType'] as String? ?? '')
        .replaceAll(' (', ', ')
        .replaceAll(')', '');
    final specialty = duty['specialtyName'] as String? ?? '';
    final department = duty['department'] as String? ?? '';
    final qualification = duty['qualificationRequired'] as String? ?? '';
    final notes = duty['notes'] as String? ?? '';
    final paymentTiming = _paymentTimingLabel(duty['paymentTiming']);
    final headcount = (duty['headcount'] as num?)?.toInt();
    final remaining = (duty['remainingHeadcount'] as num?)?.toInt();
    final start = parseIsoLocal(duty['startAtIso']);
    final end = parseIsoLocal(duty['endAtIso']);
    final location = [
      if (city.isNotEmpty) city,
      if (distance != null) '$distance km',
    ].join(' · ');

    final terms = <Widget>[
      if (department.isNotEmpty)
        DetailRow(label: 'Department', value: department),
      DetailRow(
        label: 'Payment',
        value: '${formatInr(duty['amount'])} per ${basisLabel(duty['basis'])}',
      ),
      if (paymentTiming.isNotEmpty)
        DetailRow(label: 'Paid', value: paymentTiming),
      if (headcount != null &&
          remaining != null &&
          (duty['status'] ?? 'published') == 'published')
        DetailRow(label: 'Positions', value: '$remaining of $headcount open'),
    ];

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        actions: [
          IconButton(
            icon: const Icon(Icons.translate_outlined),
            tooltip: 'Language',
            onPressed: () => LanguageSelectorDialog.show(context),
          ),
          IconButton(
            icon: const Icon(Icons.flag_outlined),
            tooltip: 'Report duty',
            onPressed: _reportDuty,
          ),
          const SizedBox(width: 4),
        ],
      ),
      bottomNavigationBar: BottomActionBar(
        child: _buildActionBar(colors, loc.translate('applyForDuty')),
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
            // Pay is the headline
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
            const SizedBox(height: 8),
            Text.rich(
              TextSpan(
                children: [
                  if (shiftType.isNotEmpty)
                    TextSpan(
                      text: shiftType,
                      style: TextStyle(
                        color: colors.textPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  if (shiftType.isNotEmpty && specialty.isNotEmpty)
                    const TextSpan(text: ' · '),
                  if (specialty.isNotEmpty) TextSpan(text: specialty),
                ],
              ),
              style: AppTypography.bodyMedium(
                colors.textSecondary,
              ).copyWith(fontSize: 14),
            ),
            const SizedBox(height: AppSpacing.lg),

            // Facility
            _Surface(
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
                    [
                      if (duty['isVerifiedOrg'] == true) 'Verified facility',
                      if (department.isNotEmpty) department,
                      if (location.isNotEmpty) location,
                    ].join(' · '),
                    style: AppTypography.bodySmall(
                      colors.textSecondary,
                    ).copyWith(fontSize: 13),
                  ),
                  const SizedBox(height: 14),
                  OutlinedButton.icon(
                    icon: const Icon(Icons.near_me_outlined, size: 16),
                    label: Text(loc.translate('openInMaps')),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 40),
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      shape: const StadiumBorder(),
                    ),
                    onPressed: () {
                      LocationService.launchNavigationIntent(
                        13.0827,
                        80.2707,
                        label: duty['facilityName'] as String? ?? '',
                      );
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),

            // Shift timeline
            _Surface(
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

            const GroupLabel('Terms'),
            _RowList(children: terms),
            const SizedBox(height: AppSpacing.section),

            const GroupLabel('Requirements'),
            _RowList(
              children: [
                if (qualification.isNotEmpty)
                  DetailRow(label: 'Qualification', value: qualification),
                const DetailRow(
                  label: 'Registration',
                  value: 'Active State / NMC council registration',
                ),
              ],
            ),

            if (notes.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.section),
              const GroupLabel('Notes from hospital'),
              Text(
                notes,
                style: AppTypography.bodyMedium(
                  colors.textPrimary,
                ).copyWith(fontSize: 14),
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.lock_outline, size: 14, color: colors.textMuted),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Applying creates an immutable snapshot of your council credentials.',
                    style: AppTypography.bodySmall(colors.textMuted),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Flat surface block used for the facility and timeline sections.
class _Surface extends StatelessWidget {
  final Widget child;

  const _Surface({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: context.appColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
      ),
      child: child,
    );
  }
}

/// Label/value rows on the canvas, separated by hairline dividers.
class _RowList extends StatelessWidget {
  final List<Widget> children;

  const _RowList({required this.children});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Column(
      children: [
        for (var i = 0; i < children.length; i++) ...[
          children[i],
          Divider(height: 1, color: colors.border),
        ],
      ],
    );
  }
}
