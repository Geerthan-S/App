/**
 * Create Duty Requirement Screen (Hospital Coordinator)
 * Flow: Facility -> Specialty -> Qualification -> Date -> Time -> Department -> Headcount -> Terms -> Notes
 * Actions: Save as Draft -> Validate -> Preview -> Publish
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';

class CreateDutyScreen extends ConsumerStatefulWidget {
  const CreateDutyScreen({super.key});

  @override
  ConsumerState<CreateDutyScreen> createState() => _CreateDutyScreenState();
}

class _CreateDutyScreenState extends ConsumerState<CreateDutyScreen> {
  final _formKey = GlobalKey<FormState>();

  String _selectedFacility = 'Apollo Main Hospital - Greams Road';
  final List<String> _facilities = [
    'Apollo Main Hospital - Greams Road',
    'Apollo Specialty Hospital - OMR Perungudi',
    'Apollo Children Hospital - Thousand Lights',
  ];

  String _selectedSpecialty = AppConstants.specialties.first;
  final _departmentController = TextEditingController(text: 'Casualty & ICU Emergency');
  final _qualificationController = TextEditingController(text: 'MBBS, MD / DNB');
  final _amountController = TextEditingController(text: '6500');
  final _headcountController = TextEditingController(text: '2');
  final _notesController = TextEditingController(text: 'Report to Medical Admin Desk 15 mins prior to shift.');

  DateTime _selectedDate = DateTime.now().add(const Duration(days: 1));
  TimeOfDay _startTime = const TimeOfDay(hour: 8, minute: 0);
  TimeOfDay _endTime = const TimeOfDay(hour: 16, minute: 0);

  bool _isPublishing = false;
  bool _isSavingDraft = false;

  void _saveDraft() {
    setState(() => _isSavingDraft = true);
    Future.delayed(const Duration(milliseconds: 600), () {
      if (mounted) {
        setState(() => _isSavingDraft = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.surfaceElevatedDark,
            content: Text('Duty requirement saved as Draft in hospital workspace.'),
          ),
        );
      }
    });
  }

  bool _validateForm() {
    if (_departmentController.text.trim().isEmpty) {
      _showToast('Department is required');
      return false;
    }
    final headcount = int.tryParse(_headcountController.text.trim()) ?? 0;
    if (headcount <= 0) {
      _showToast('Headcount must be at least 1');
      return false;
    }
    final amount = double.tryParse(_amountController.text.trim()) ?? 0;
    if (amount <= 0) {
      _showToast('Compensation amount must be greater than zero');
      return false;
    }
    return true;
  }

  void _showToast(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(backgroundColor: AppColors.rose, content: Text(msg)),
    );
  }

  void _previewDuty() {
    if (!_validateForm()) return;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surfaceDark,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpacing.radiusLg)),
      ),
      builder: (ctx) {
        return Padding(
          padding: AppSpacing.paddingScreen,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Duty Preview (Doctor View)', style: AppTypography.headingSmall(AppColors.textDarkPrimary)),
                  const StatusBadge(status: 'published'),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_selectedFacility, style: AppTypography.headingSmall(AppColors.textDarkPrimary)),
                    const SizedBox(height: 2),
                    Text('${_selectedSpecialty} • ${_departmentController.text}', style: AppTypography.bodyMedium(AppColors.textDarkSecondary)),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      'Timing: ${_startTime.format(context)} - ${_endTime.format(context)} (8 hrs)',
                      style: AppTypography.labelBold(AppColors.primaryLight),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Compensation: ₹${_amountController.text} / shift', style: AppTypography.labelBold(AppColors.emerald)),
                        Text('${_headcountController.text} open positions', style: AppTypography.bodySmall(AppColors.amber)),
                      ],
                    ),
                    const Divider(),
                    Text('Qualification: ${_qualificationController.text}', style: AppTypography.bodySmall(AppColors.textDarkMuted)),
                    if (_notesController.text.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text('Notes: ${_notesController.text}', style: AppTypography.bodySmall(AppColors.textDarkMuted)),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              AppButton(
                label: 'Confirm & Publish Duty',
                icon: Icons.send_rounded,
                onPressed: () {
                  Navigator.pop(ctx);
                  _publishDuty();
                },
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        );
      },
    );
  }

  void _publishDuty() {
    if (!_validateForm()) return;

    setState(() => _isPublishing = true);
    Future.delayed(const Duration(milliseconds: 900), () {
      if (mounted) {
        setState(() => _isPublishing = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.emerald,
            content: Text('Duty published successfully! Notifying eligible verified doctors via FCM.'),
          ),
        );
        context.pop();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final loc = ref.watch(localizationProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.translate('postDuty')),
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
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Post Clinical Duty Requirement',
                  style: AppTypography.headingLarge(AppColors.textDarkPrimary),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Published requirements are matched atomically with verified doctors.',
                  style: AppTypography.bodyMedium(AppColors.textDarkSecondary),
                ),
                const SizedBox(height: AppSpacing.lg),

                // 1. Facility Selector
                Text('HOSPITAL FACILITY / BRANCH', style: AppTypography.labelBold(AppColors.textDarkSecondary)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  value: _selectedFacility,
                  isExpanded: true,
                  dropdownColor: AppColors.surfaceElevatedDark,
                  style: AppTypography.bodyLarge(AppColors.textDarkPrimary),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: AppColors.surfaceElevatedDark,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                      borderSide: const BorderSide(color: AppColors.borderDark),
                    ),
                  ),
                  items: _facilities.map((f) => DropdownMenuItem(value: f, child: Text(f, overflow: TextOverflow.ellipsis))).toList(),
                  onChanged: (val) => setState(() => _selectedFacility = val!),
                ),
                const SizedBox(height: AppSpacing.md),

                // 2. Specialty & Department
                Text('SPECIALTY REQUIRED', style: AppTypography.labelBold(AppColors.textDarkSecondary)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  value: _selectedSpecialty,
                  isExpanded: true,
                  dropdownColor: AppColors.surfaceElevatedDark,
                  style: AppTypography.bodyLarge(AppColors.textDarkPrimary),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: AppColors.surfaceElevatedDark,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                      borderSide: const BorderSide(color: AppColors.borderDark),
                    ),
                  ),
                  items: AppConstants.specialties.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                  onChanged: (val) => setState(() => _selectedSpecialty = val!),
                ),
                const SizedBox(height: AppSpacing.md),
                AppTextField(
                  label: 'DEPARTMENT / WARD',
                  controller: _departmentController,
                ),
                const SizedBox(height: AppSpacing.md),

                // 3. Qualification & Headcount
                AppTextField(
                  label: 'MINIMUM QUALIFICATION',
                  controller: _qualificationController,
                ),
                const SizedBox(height: AppSpacing.md),
                AppTextField(
                  label: 'REQUIRED DOCTOR HEADCOUNT',
                  controller: _headcountController,
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: AppSpacing.md),

                // 4. Shift Date & Times
                Text('SHIFT SCHEDULE', style: AppTypography.labelBold(AppColors.textDarkSecondary)),
                const SizedBox(height: 6),
                AppCard(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Shift Date', style: AppTypography.bodySmall(AppColors.textDarkMuted)),
                          Text('${_selectedDate.day}/${_selectedDate.month}/${_selectedDate.year}', style: AppTypography.labelBold(AppColors.textDarkPrimary)),
                        ],
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Hours', style: AppTypography.bodySmall(AppColors.textDarkMuted)),
                          Text('${_startTime.format(context)} - ${_endTime.format(context)}', style: AppTypography.labelBold(AppColors.primaryLight)),
                        ],
                      ),
                      OutlinedButton(
                        style: OutlinedButton.styleFrom(foregroundColor: AppColors.primaryLight),
                        onPressed: () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: _selectedDate,
                            firstDate: DateTime.now(),
                            lastDate: DateTime.now().add(const Duration(days: 90)),
                          );
                          if (picked != null) setState(() => _selectedDate = picked);
                        },
                        child: const Text('Change'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                // 5. Compensation Terms
                AppTextField(
                  label: 'AGREED COMPENSATION AMOUNT (INR)',
                  controller: _amountController,
                  keyboardType: TextInputType.number,
                  prefixIcon: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                    child: Text('₹', style: TextStyle(color: AppColors.textDarkPrimary, fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                // 6. Instructions
                AppTextField(
                  label: 'ADDITIONAL INSTRUCTIONS / NOTES',
                  controller: _notesController,
                  maxLines: 3,
                ),
                const SizedBox(height: AppSpacing.xl),

                // Actions: Draft, Preview, Publish
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.drafts_outlined, size: 18),
                        label: Text(loc.translate('saveDraft')),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.textDarkSecondary,
                          side: const BorderSide(color: AppColors.borderDark),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        onPressed: _isSavingDraft ? null : _saveDraft,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.remove_red_eye_outlined, size: 18),
                        label: Text(loc.translate('previewDuty')),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.primaryLight,
                          side: const BorderSide(color: AppColors.primary),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        onPressed: _previewDuty,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                AppButton(
                  label: loc.translate('publishDuty'),
                  isLoading: _isPublishing,
                  icon: Icons.send_rounded,
                  onPressed: _publishDuty,
                ),
                const SizedBox(height: AppSpacing.lg),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
