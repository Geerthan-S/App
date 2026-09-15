/**
 * Confirmed Assignments & Active Duty Shift Screen
 * Lifecycle: Confirmed -> Start Shift (Check-in) -> Mark Completed -> Payment Acknowledgement -> Structured Feedback
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/services/location_service.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';

class AssignmentsScreen extends ConsumerStatefulWidget {
  const AssignmentsScreen({super.key});

  @override
  ConsumerState<AssignmentsScreen> createState() => _AssignmentsScreenState();
}

class _AssignmentsScreenState extends ConsumerState<AssignmentsScreen> {
  String _shiftStatus = 'confirmed';
  String? _checkInTime;
  String? _completedTime;
  bool _paymentAcknowledged = false;
  bool _feedbackSubmitted = false;

  int _ratingPreparedness = 5;
  int _ratingSupport = 5;
  int _ratingCoordination = 5;

  void _startShift() {
    final now = DateTime.now();
    setState(() {
      _shiftStatus = 'in_progress';
      _checkInTime = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: AppColors.emerald,
        content: Text('Shift started! Verified check-in recorded at $_checkInTime.'),
      ),
    );
  }

  void _completeShift() {
    final now = DateTime.now();
    setState(() {
      _shiftStatus = 'completed';
      _completedTime = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      _paymentAcknowledged = true;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: AppColors.emerald,
        content: Text('Shift completed at $_completedTime! Attendance logged and payment acknowledged.'),
      ),
    );
  }

  void _submitFeedback() {
    setState(() => _feedbackSubmitted = true);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        backgroundColor: AppColors.emerald,
        content: Text('Structured clinical feedback submitted successfully.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final loc = ref.watch(localizationProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.translate('assignments')),
        actions: [
          IconButton(
            icon: const Icon(Icons.language_rounded),
            onPressed: () => LanguageSelectorDialog.show(context),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Shift Card
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Apollo Specialty Hospital',
                          style: AppTypography.headingMedium(colors.textPrimary),
                        ),
                        StatusBadge(status: _shiftStatus),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'General Medicine • ICU & Emergency Triage',
                      style: AppTypography.bodyMedium(colors.textSecondary),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      'Today, 08:00 AM - 04:00 PM (8 hrs)',
                      style: AppTypography.labelBold(AppColors.primaryLight),
                    ),
                    if (_checkInTime != null) ...[
                      const SizedBox(height: 4),
                      Text('Checked in at: $_checkInTime', style: AppTypography.bodySmall(AppColors.emerald)),
                    ],
                    if (_completedTime != null) ...[
                      const SizedBox(height: 2),
                      Text('Completed at: $_completedTime', style: AppTypography.bodySmall(AppColors.emerald)),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Released Contact Card
              AppCard(
                borderColor: AppColors.emerald.withOpacity(0.4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.lock_open_rounded, color: AppColors.emerald, size: 20),
                        const SizedBox(width: 8),
                        Text(
                          'Direct Hospital Contact Released',
                          style: AppTypography.labelBold(AppColors.emerald),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    _buildRow(colors, 'Hospital Coordinator', 'Dr. Ramesh Nathan (Medical Supt)'),
                    const Divider(),
                    _buildRow(colors, 'Duty Desk Direct Line', '+91 44 2829 0200'),
                    const Divider(),
                    _buildRow(colors, 'Facility Address', '21 Greams Lane, Thousand Lights, Chennai'),
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton.icon(
                      icon: const Icon(Icons.navigation_outlined, size: 16),
                      label: Text(loc.translate('openInMaps')),
                      onPressed: () {
                        LocationService.launchNavigationIntent(13.0604, 80.2496, label: 'Apollo Specialty Hospital');
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Payment Terms & Acknowledgement
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Frozen Terms & Settlement', style: AppTypography.headingSmall(colors.textPrimary)),
                    const SizedBox(height: AppSpacing.sm),
                    _buildRow(colors, 'Agreed Compensation', '₹6,500 per shift'),
                    const Divider(),
                    _buildRow(colors, 'Payment Schedule', 'Immediate post-shift acknowledgment'),
                    const Divider(),
                    _buildRow(
                      colors,
                      'Payment Status',
                      _paymentAcknowledged ? '✅ Acknowledged by Hospital Finance' : 'Pending Shift Completion',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              // Shift Execution Action
              if (_shiftStatus == 'confirmed')
                AppButton(
                  label: loc.translate('startShift'),
                  icon: Icons.play_arrow_rounded,
                  onPressed: _startShift,
                )
              else if (_shiftStatus == 'in_progress')
                AppButton(
                  label: loc.translate('completeShift'),
                  backgroundColor: AppColors.emerald,
                  icon: Icons.check_circle_outline_rounded,
                  onPressed: _completeShift,
                ),

              // Structured Feedback Form (Visible upon completion)
              if (_shiftStatus == 'completed') ...[
                const SizedBox(height: AppSpacing.md),
                Text('Structured Shift Feedback', style: AppTypography.headingSmall(colors.textPrimary)),
                const SizedBox(height: AppSpacing.xs),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_feedbackSubmitted) ...[
                        const Center(
                          child: Padding(
                            padding: EdgeInsets.symmetric(vertical: 16),
                            child: Column(
                              children: [
                                Icon(Icons.check_circle_rounded, color: AppColors.emerald, size: 40),
                                SizedBox(height: 8),
                                Text('Thank you! Your feedback has been recorded in the platform audit trail.'),
                              ],
                            ),
                          ),
                        ),
                      ] else ...[
                        Text(
                          'Provide objective feedback on clinical readiness and facility support.',
                          style: AppTypography.bodySmall(colors.textSecondary),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        _buildRatingRow(colors, 'Clinical Handover & Triage', _ratingPreparedness, (r) => setState(() => _ratingPreparedness = r)),
                        const Divider(),
                        _buildRatingRow(colors, 'Facility Infrastructure Support', _ratingSupport, (r) => setState(() => _ratingSupport = r)),
                        const Divider(),
                        _buildRatingRow(colors, 'Staff Coordination & Punctuality', _ratingCoordination, (r) => setState(() => _ratingCoordination = r)),
                        const SizedBox(height: AppSpacing.md),
                        AppButton(
                          label: 'Submit Shift Feedback',
                          backgroundColor: colors.surfaceElevated,
                          onPressed: _submitFeedback,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
              const SizedBox(height: AppSpacing.xl),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRatingRow(AppColorsExtension colors, String title, int currentRating, ValueChanged<int> onRatingChanged) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(child: Text(title, style: AppTypography.bodySmall(colors.textPrimary))),
          Row(
            children: List.generate(5, (index) {
              final star = index + 1;
              return InkWell(
                onTap: () => onRatingChanged(star),
                child: Icon(
                  star <= currentRating ? Icons.star_rounded : Icons.star_outline_rounded,
                  color: star <= currentRating ? AppColors.amber : colors.textMuted,
                  size: 22,
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  Widget _buildRow(AppColorsExtension colors, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: AppTypography.bodyMedium(colors.textMuted)),
          Text(value, style: AppTypography.labelBold(colors.textPrimary)),
        ],
      ),
    );
  }
}
