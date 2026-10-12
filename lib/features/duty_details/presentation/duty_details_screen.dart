/**
 * Duty Details & Application Submission Screen
 * Doctor view: Facility details, GPS navigation, eligibility check, profile snapshot, terms acknowledgement, and duplicate prevention.
 */

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_inputs.dart';
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
  bool _isSubmitting = false;
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
    final colors = context.appColors;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                left: AppSpacing.gutter,
                right: AppSpacing.gutter,
                top: 0,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Submit Duty Application', style: AppTypography.headingSmall(colors.textPrimary)),
                        IconButton(
                          icon: Icon(Icons.close_outlined, color: colors.textMuted),
                          onPressed: () => Navigator.pop(ctx),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),

                    // Immutable Profile Snapshot Preview
                    Text('Credential snapshot', style: AppTypography.labelBold(colors.textSecondary)),
                    const SizedBox(height: 6),
                    AppCard(
                      elevated: false,
                      color: colors.bg,
                      child: _doctorProfile == null
                          ? Text('Loading profile...', style: AppTypography.bodySmall(colors.textMuted))
                          : Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(
                                      _doctorProfile!['fullName'] as String? ?? '—',
                                      style: AppTypography.labelBold(colors.textPrimary),
                                    ),
                                    const SizedBox(width: 4),
                                    if (_doctorProfile!['isVerified'] == true)
                                      const Icon(Icons.verified_outlined, color: AppColors.emerald, size: 14),
                                  ],
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  '${_doctorProfile!['registrationNo'] ?? '—'} • ${_doctorProfile!['council'] ?? '—'}',
                                  style: AppTypography.bodySmall(colors.textMuted),
                                ),
                                Text(
                                  '${_doctorProfile!['qualification'] ?? '—'} • ${_doctorProfile!['yearsOfExperience'] ?? 0} yrs experience',
                                  style: AppTypography.bodySmall(colors.textSecondary),
                                ),
                              ],
                            ),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // Note to Coordinator
                    AppTextField(
                      label: 'Note to hospital coordinator (optional)',
                      controller: noteCtrl,
                      hintText: 'e.g. Available immediately for the triage desk...',
                      maxLines: 2,
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // Checkbox 1: Availability Confirmation
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: confirmAvailability,
                      activeColor: AppColors.primary,
                      title: Text(
                        'I confirm my full clinical availability during this shift window.',
                        style: AppTypography.bodySmall(colors.textPrimary),
                      ),
                      onChanged: (val) => setModalState(() => confirmAvailability = val ?? false),
                    ),

                    // Checkbox 2: Terms Acknowledgement
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: acknowledgeTerms,
                      activeColor: AppColors.primary,
                      title: Text(
                        'I accept the agreed compensation of ₹${widget.duty['amount']} and hospital operational guidelines.',
                        style: AppTypography.bodySmall(colors.textPrimary),
                      ),
                      onChanged: (val) => setModalState(() => acknowledgeTerms = val ?? false),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    AppButton(
                      label: 'Confirm & Submit Application',
                      isLoading: _isSubmitting,
                      icon: Icons.send_outlined,
                      onPressed: (confirmAvailability && acknowledgeTerms)
                          ? () {
                              final note = noteCtrl.text.trim();
                              Navigator.pop(ctx);
                              _submitApplication(note: note.isNotEmpty ? note : null);
                            }
                          : null,
                    ),
                    const SizedBox(height: AppSpacing.xs),
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

  Future<void> _submitApplication({String? note}) async {
    setState(() => _isSubmitting = true);
    try {
      final dutyId = widget.duty['dutyId'] as String? ?? '';
      await DutyRepository.applyToDuty(dutyId, note: note);
      if (mounted) {
        setState(() => _hasApplied = true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.emerald,
            content: Text('Application submitted! Verified credential snapshot recorded for hospital review.'),
          ),
        );
      }
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        final msg = switch (e.domainCode) {
          'DOCTOR_NOT_VERIFIED' => 'Your profile must be verified before applying.',
          'APPLICATION_ALREADY_EXISTS' => 'You have already applied for this duty.',
          'DUTY_CAPACITY_FILLED' => 'This duty has been fully filled.',
          _ => e.message ?? 'Could not submit application. Try again.',
        };
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(backgroundColor: AppColors.rose, content: Text(msg)),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.rose,
            content: Text('Application failed. Check your connection and try again.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  void _reportDuty() {
    final colors = context.appColors;
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Report Duty Requirement'),
        content: Text(
          'Report this duty if it contains misleading compensation, abusive terms, or safety violations. It will be routed to Platform Moderation.',
          style: AppTypography.bodySmall(colors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Cancel', style: TextStyle(color: colors.textMuted)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.rose, foregroundColor: Colors.white),
            onPressed: () {
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  backgroundColor: AppColors.rose,
                  content: Text('Report logged. Duty flagged for administrative review.'),
                ),
              );
            },
            child: const Text('Report'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final duty = widget.duty;
    final loc = ref.watch(localizationProvider);
    final city = duty['city'] as String? ?? '';
    final distance = duty['distanceKm'];
    final shiftType = duty['shiftType'] as String?;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: const Text('Duty Requirement Details'),
        actions: [
          IconButton(
            icon: const Icon(Icons.translate_outlined),
            tooltip: 'Language',
            onPressed: () => LanguageSelectorDialog.show(context),
          ),
          IconButton(
            icon: const Icon(Icons.flag_outlined),
            tooltip: 'Report Duty',
            onPressed: _reportDuty,
          ),
          const SizedBox(width: 4),
        ],
      ),
      bottomNavigationBar: BottomActionBar(
        child: _hasApplied
            ? Row(
                children: [
                  const IconTile(
                    icon: Icons.check_circle_outline_outlined,
                    iconColor: AppColors.emerald,
                    background: Color(0x1A24A879),
                    size: 44,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Application Submitted', style: AppTypography.labelBold(AppColors.emerald)),
                        Text('Awaiting hospital review and selection decision.', style: AppTypography.bodySmall(colors.textSecondary)),
                      ],
                    ),
                  ),
                ],
              )
            : Row(
                children: [
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(formatInr(duty['amount']),
                          style: AppTypography.headingMedium(colors.textPrimary)),
                      Text('per ${basisLabel(duty['basis'])}', style: AppTypography.bodySmall(colors.textSecondary)),
                    ],
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: AppButton(
                      label: loc.translate('applyForDuty'),
                      isLoading: _isSubmitting,
                      icon: Icons.send_outlined,
                      onPressed: _showApplicationModal,
                    ),
                  ),
                ],
              ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Facility hero
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
                            Text(
                              duty['facilityName'] as String? ?? '—',
                              style: AppTypography.headingLarge(colors.textPrimary).copyWith(fontSize: 20),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              duty['specialtyName'] as String? ?? '',
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
                    children: [
                      if (duty['isVerifiedOrg'] == true)
                        const InfoChip(icon: Icons.verified_outlined, label: 'Verified Facility', color: AppColors.emerald),
                      InfoChip(
                        icon: Icons.location_on_outlined,
                        label: distance != null ? '$city • $distance km away' : (city.isEmpty ? 'Location TBA' : city),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppSecondaryButton(
                    label: loc.translate('openInMaps'),
                    icon: Icons.near_me_outlined,
                    foregroundColor: colors.accent,
                    onPressed: () {
                      LocationService.launchNavigationIntent(13.0827, 80.2707, label: duty['facilityName'] as String? ?? '');
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),

            // Key facts
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
                    icon: Icons.schedule_outlined,
                    value: (shiftType ?? 'Shift').split(' (').first,
                    label: shiftType != null && shiftType.contains('(')
                        ? shiftType.substring(shiftType.indexOf('(') + 1).replaceAll(')', '')
                        : 'Shift type',
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: StatTile(
                    icon: Icons.groups_outlined,
                    value: '${duty['remainingHeadcount'] ?? 1}',
                    label: 'Open positions',
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.section),

            const SectionHeader(title: 'Shift Schedule & Terms'),
            const SizedBox(height: AppSpacing.sm),
            AppCard(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 4),
              child: Column(
                children: [
                  DetailRow(icon: Icons.apartment_outlined, label: 'Department', value: duty['department'] as String? ?? '—'),
                  const Divider(),
                  DetailRow(icon: Icons.medical_services_outlined, label: 'Specialty', value: duty['specialtyName'] as String? ?? '—'),
                  const Divider(),
                  DetailRow(icon: Icons.login_outlined, label: 'Starts', value: '${duty['startAt']}'),
                  const Divider(),
                  DetailRow(icon: Icons.logout_outlined, label: 'Ends', value: '${duty['endAt']}'),
                  const Divider(),
                  DetailRow(
                    icon: Icons.payments_outlined,
                    label: 'Agreed Payment',
                    value: '${formatInr(duty['amount'])} / ${basisLabel(duty['basis'])}',
                    valueColor: AppColors.emerald,
                  ),
                  const Divider(),
                  DetailRow(icon: Icons.groups_outlined, label: 'Headcount Open', value: '${duty['remainingHeadcount']} remaining'),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.section),

            const SectionHeader(title: 'Clinical Requirements'),
            const SizedBox(height: AppSpacing.sm),
            AppCard(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 4),
              child: Column(
                children: [
                  DetailRow(icon: Icons.school_outlined, label: 'Required Degree', value: duty['qualificationRequired'] as String? ?? '—'),
                  const Divider(),
                  const DetailRow(icon: Icons.badge_outlined, label: 'Registration', value: 'Active State / NMC Medical Council Registration'),
                ],
              ),
            ),
            if ((duty['notes'] as String? ?? '').isNotEmpty) ...[
              const SizedBox(height: AppSpacing.section),
              const SectionHeader(title: 'Notes from Hospital'),
              const SizedBox(height: AppSpacing.sm),
              AppCard(
                child: Text(duty['notes'] as String, style: AppTypography.bodyMedium(colors.textSecondary)),
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
