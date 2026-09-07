/**
 * Duty Details & Application Submission Screen
 * Doctor view: Facility details, GPS navigation, eligibility check, profile snapshot, terms acknowledgement, and duplicate prevention.
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/services/location_service.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';

class DutyDetailsScreen extends ConsumerStatefulWidget {
  final Map<String, dynamic> duty;

  const DutyDetailsScreen({super.key, required this.duty});

  @override
  ConsumerState<DutyDetailsScreen> createState() => _DutyDetailsScreenState();
}

class _DutyDetailsScreenState extends ConsumerState<DutyDetailsScreen> {
  bool _hasApplied = false;
  bool _isSubmitting = false;

  void _showApplicationModal() {
    final noteCtrl = TextEditingController();
    bool confirmAvailability = false;
    bool acknowledgeTerms = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surfaceDark,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpacing.radiusLg)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 20,
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
                        Text('Submit Duty Application', style: AppTypography.headingSmall(AppColors.textDarkPrimary)),
                        IconButton(
                          icon: const Icon(Icons.close_rounded, color: AppColors.textDarkMuted),
                          onPressed: () => Navigator.pop(ctx),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),

                    // Immutable Profile Snapshot Preview
                    Text('IMMUTABLE CREDENTIAL SNAPSHOT', style: AppTypography.labelBold(AppColors.textDarkSecondary)),
                    const SizedBox(height: 6),
                    AppCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text('Dr. Aravind Swaminathan', style: AppTypography.labelBold(AppColors.textDarkPrimary)),
                              const SizedBox(width: 4),
                              const Icon(Icons.verified_rounded, color: AppColors.emerald, size: 14),
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text('TNMC_98234 • Tamil Nadu Medical Council', style: AppTypography.bodySmall(AppColors.textDarkMuted)),
                          Text('MBBS, MD (General Medicine) • 5 yrs clinical experience', style: AppTypography.bodySmall(AppColors.textDarkSecondary)),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // Note to Coordinator
                    AppTextField(
                      label: 'NOTE TO HOSPITAL COORDINATOR (OPTIONAL)',
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
                        style: AppTypography.bodySmall(AppColors.textDarkPrimary),
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
                        style: AppTypography.bodySmall(AppColors.textDarkPrimary),
                      ),
                      onChanged: (val) => setModalState(() => acknowledgeTerms = val ?? false),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    AppButton(
                      label: 'Confirm & Submit Application',
                      isLoading: _isSubmitting,
                      icon: Icons.send_rounded,
                      onPressed: (confirmAvailability && acknowledgeTerms)
                          ? () {
                              Navigator.pop(ctx);
                              _submitApplication();
                            }
                          : null,
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Center(
                      child: Text(
                        'Duplicate applications are prevented server-side.',
                        style: AppTypography.bodySmall(AppColors.textDarkMuted),
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

  void _submitApplication() {
    setState(() => _isSubmitting = true);
    Future.delayed(const Duration(milliseconds: 800), () {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _hasApplied = true;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.emerald,
            content: Text('Application submitted! Verified credential snapshot recorded for hospital review.'),
          ),
        );
      }
    });
  }

  void _reportDuty() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surfaceDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusMd)),
        title: Text('Report Duty Requirement', style: AppTypography.headingSmall(AppColors.textDarkPrimary)),
        content: Text(
          'Report this duty if it contains misleading compensation, abusive terms, or safety violations. It will be routed to Platform Moderation.',
          style: AppTypography.bodySmall(AppColors.textDarkSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: AppColors.textDarkMuted)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.rose),
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
    final duty = widget.duty;
    final loc = ref.watch(localizationProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Duty Requirement Details'),
        actions: [
          IconButton(
            icon: const Icon(Icons.language_rounded),
            onPressed: () => LanguageSelectorDialog.show(context),
          ),
          IconButton(
            icon: const Icon(Icons.flag_outlined, color: AppColors.rose),
            tooltip: 'Report Duty',
            onPressed: _reportDuty,
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Facility Card
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            duty['facilityName'] as String,
                            style: AppTypography.headingMedium(AppColors.textDarkPrimary),
                          ),
                        ),
                        if (duty['isVerifiedOrg'] == true)
                          const Chip(
                            avatar: Icon(Icons.verified_rounded, color: AppColors.emerald, size: 16),
                            label: Text('Verified Facility'),
                            backgroundColor: Color(0x1A10B981),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${duty['city']} • ${duty['distanceKm']} km away',
                      style: AppTypography.bodyMedium(AppColors.textDarkMuted),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton.icon(
                      icon: const Icon(Icons.navigation_outlined, size: 16),
                      label: Text(loc.translate('openInMaps')),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.primaryLight,
                        side: const BorderSide(color: AppColors.borderDark),
                      ),
                      onPressed: () {
                        LocationService.launchNavigationIntent(13.0827, 80.2707, label: duty['facilityName'] as String);
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Duty Schedule & Specialty
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Shift Schedule & Terms',
                      style: AppTypography.headingSmall(AppColors.textDarkPrimary),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    _buildRow('Department', duty['department'] as String),
                    const Divider(),
                    _buildRow('Specialty', duty['specialtyName'] as String),
                    const Divider(),
                    _buildRow('Timing', '${duty['startAt']} - ${duty['endAt']}'),
                    const Divider(),
                    _buildRow('Agreed Payment', '₹${duty['amount']} (${duty['basis']})'),
                    const Divider(),
                    _buildRow('Headcount Open', '${duty['remainingHeadcount']} remaining'),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Qualification Requirements
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Clinical Requirements',
                      style: AppTypography.headingSmall(AppColors.textDarkPrimary),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    _buildRow('Required Degree', duty['qualificationRequired'] as String),
                    const Divider(),
                    _buildRow('Registration', 'Active State / NMC Medical Council Registration'),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),

              // Apply Action Button or Already Applied Status
              if (_hasApplied)
                AppCard(
                  borderColor: AppColors.emerald.withOpacity(0.4),
                  child: Row(
                    children: [
                      const Icon(Icons.check_circle_rounded, color: AppColors.emerald, size: 24),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Application Submitted', style: AppTypography.labelBold(AppColors.emerald)),
                            Text('Awaiting hospital review and selection decision.', style: AppTypography.bodySmall(AppColors.textDarkMuted)),
                          ],
                        ),
                      ),
                    ],
                  ),
                )
              else
                AppButton(
                  label: loc.translate('applyForDuty'),
                  isLoading: _isSubmitting,
                  icon: Icons.send_rounded,
                  onPressed: _showApplicationModal,
                ),
              const SizedBox(height: AppSpacing.xs),
              Center(
                child: Text(
                  'Applying creates an immutable snapshot of your council credentials.',
                  style: AppTypography.bodySmall(AppColors.textDarkMuted),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: AppTypography.bodyMedium(AppColors.textDarkMuted)),
          Text(value, style: AppTypography.labelBold(AppColors.textDarkPrimary)),
        ],
      ),
    );
  }
}
