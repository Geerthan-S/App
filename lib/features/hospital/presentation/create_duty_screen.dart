import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
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
import '../../duty_marketplace/data/duty_repository.dart';

class CreateDutyScreen extends ConsumerStatefulWidget {
  const CreateDutyScreen({super.key});

  @override
  ConsumerState<CreateDutyScreen> createState() => _CreateDutyScreenState();
}

class _CreateDutyScreenState extends ConsumerState<CreateDutyScreen> {
  final _functions = FirebaseFunctions.instance;
  final _formKey = GlobalKey<FormState>();

  List<Map<String, dynamic>> _organizations = [];
  String? _selectedOrgId;
  List<Map<String, dynamic>> _facilities = [];
  Map<String, dynamic>? _selectedFacility;

  String _selectedSpecialty = AppConstants.specialties.first;
  final _departmentController = TextEditingController();
  final _qualificationController = TextEditingController(text: 'MBBS');
  final _amountController = TextEditingController(text: '6500');
  final _headcountController = TextEditingController(text: '1');
  final _notesController = TextEditingController();
  final _expController = TextEditingController(text: '0');

  DateTime _selectedDate = DateTime.now().add(const Duration(days: 1));
  TimeOfDay _startTime = const TimeOfDay(hour: 8, minute: 0);
  TimeOfDay _endTime = const TimeOfDay(hour: 16, minute: 0);

  bool _isPublishing = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadOrganizations();
  }

  @override
  void dispose() {
    _departmentController.dispose();
    _qualificationController.dispose();
    _amountController.dispose();
    _headcountController.dispose();
    _notesController.dispose();
    _expController.dispose();
    super.dispose();
  }

  Future<void> _loadOrganizations() async {
    try {
      final result = await _functions
          .httpsCallable('getMyOrganizations')
          .call<Map<String, dynamic>>();
      final orgs = (result.data['organizations'] as List<dynamic>? ?? [])
          .map((o) => Map<String, dynamic>.from(o as Map))
          .toList();
      if (!mounted) return;
      setState(() {
        _organizations = orgs;
        if (orgs.isNotEmpty && _selectedOrgId == null) {
          _selectedOrgId = orgs.first['organizationId'] as String?;
          _loadFacilities(_selectedOrgId!);
        }
      });
    } catch (_) {
      if (mounted) setState(() => _errorMessage = 'Could not load organizations. Make sure you are signed in as hospital staff.');
    }
  }

  Future<void> _loadFacilities(String orgId) async {
    setState(() => _facilities = []);
    try {
      final snap = await FirebaseFirestore.instance
          .collection('organizations')
          .doc(orgId)
          .collection('facilities')
          .limit(20)
          .get();
      if (!mounted) return;
      final facs = snap.docs.map((d) => d.data()).toList();
      setState(() {
        _facilities = facs;
        _selectedFacility = facs.isNotEmpty ? facs.first : null;
      });
    } catch (_) {}
  }

  bool _validateForm() {
    if (_selectedOrgId == null) { _toast('Select an organization first.'); return false; }
    if (_selectedFacility == null) { _toast('Add a facility to your organization first.'); return false; }
    if (_departmentController.text.trim().isEmpty) { _toast('Department is required.'); return false; }
    if ((int.tryParse(_headcountController.text.trim()) ?? 0) < 1) { _toast('Headcount must be at least 1.'); return false; }
    if ((double.tryParse(_amountController.text.trim()) ?? 0) <= 0) { _toast('Compensation must be greater than zero.'); return false; }
    return true;
  }

  void _toast(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(backgroundColor: AppColors.rose, content: Text(msg)),
    );
  }

  DateTime _toDateTime(DateTime date, TimeOfDay time) =>
      DateTime(date.year, date.month, date.day, time.hour, time.minute);

  void _previewDuty() {
    if (!_validateForm()) return;
    final colors = context.appColors;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: colors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpacing.radiusLg)),
      ),
      builder: (ctx) => Padding(
        padding: AppSpacing.paddingScreen,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Duty Preview (Doctor View)', style: AppTypography.headingSmall(colors.textPrimary)),
                const StatusBadge(status: 'published'),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_selectedFacility!['name'] as String, style: AppTypography.headingSmall(colors.textPrimary)),
                  const SizedBox(height: 2),
                  Text('$_selectedSpecialty • ${_departmentController.text}', style: AppTypography.bodyMedium(colors.textSecondary)),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'Timing: ${_startTime.format(context)} - ${_endTime.format(context)}',
                    style: AppTypography.labelBold(AppColors.primaryLight),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('₹${_amountController.text} / shift', style: AppTypography.labelBold(AppColors.emerald)),
                      Text('${_headcountController.text} positions', style: AppTypography.bodySmall(AppColors.amber)),
                    ],
                  ),
                  const Divider(),
                  Text('Qualification: ${_qualificationController.text}', style: AppTypography.bodySmall(colors.textMuted)),
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
      ),
    );
  }

  Future<void> _publishDuty() async {
    if (!_validateForm()) return;
    final fac = _selectedFacility!;
    final startAt = _toDateTime(_selectedDate, _startTime);
    final endAt = _toDateTime(_selectedDate, _endTime);
    if (!endAt.isAfter(startAt)) {
      _toast('End time must be after start time.');
      return;
    }
    setState(() { _isPublishing = true; _errorMessage = null; });
    try {
      await DutyRepository.createAndPublish(
        organizationId: _selectedOrgId!,
        facilityId: fac['facilityId'] as String? ?? fac['name'] as String,
        facilityName: fac['name'] as String,
        city: fac['city'] as String? ?? '',
        department: _departmentController.text.trim(),
        specialtyName: _selectedSpecialty,
        qualificationRequired: _qualificationController.text.trim(),
        experienceMinYears: int.tryParse(_expController.text.trim()) ?? 0,
        startAt: startAt,
        endAt: endAt,
        amount: double.parse(_amountController.text.trim()),
        headcount: int.parse(_headcountController.text.trim()),
        notes: _notesController.text.trim(),
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.emerald,
            content: Text('Duty published! Verified doctors will be notified.'),
          ),
        );
        context.pop();
      }
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        setState(() => _errorMessage = switch (e.code) {
          'HOSPITAL_NOT_VERIFIED' => 'Your organization must be verified before publishing duties.',
          'INVALID_STATE_TRANSITION' => 'Duty start time must be in the future.',
          _ => e.message ?? 'Could not publish duty. Try again.',
        });
      }
    } catch (_) {
      if (mounted) setState(() => _errorMessage = 'Failed to publish duty. Check your connection.');
    } finally {
      if (mounted) setState(() => _isPublishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
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
                Text('Post Clinical Duty Requirement', style: AppTypography.headingLarge(colors.textPrimary)),
                const SizedBox(height: AppSpacing.xs),
                Text('Published requirements are matched with verified doctors.', style: AppTypography.bodyMedium(colors.textSecondary)),
                if (_errorMessage != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.rose.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                      border: Border.all(color: AppColors.rose.withValues(alpha: 0.4)),
                    ),
                    child: Text(_errorMessage!, style: AppTypography.bodySmall(AppColors.rose)),
                  ),
                ],
                const SizedBox(height: AppSpacing.lg),

                // Organization selector
                Text('ORGANIZATION', style: AppTypography.labelBold(colors.textSecondary)),
                const SizedBox(height: 6),
                if (_organizations.isEmpty)
                  Text('No organization found. Create one from Hospital Profile.', style: AppTypography.bodySmall(colors.textMuted))
                else
                  DropdownButtonFormField<String>(
                    value: _selectedOrgId,
                    isExpanded: true,
                    dropdownColor: colors.surfaceElevated,
                    style: AppTypography.bodyLarge(colors.textPrimary),
                    decoration: InputDecoration(
                      filled: true, fillColor: colors.surfaceElevated,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                        borderSide: BorderSide(color: colors.border),
                      ),
                    ),
                    items: _organizations.map((o) => DropdownMenuItem<String>(
                      value: o['organizationId'] as String,
                      child: Text(o['displayName'] as String? ?? o['legalName'] as String? ?? 'Org', overflow: TextOverflow.ellipsis),
                    )).toList(),
                    onChanged: (v) {
                      if (v != null) setState(() { _selectedOrgId = v; _loadFacilities(v); });
                    },
                  ),
                const SizedBox(height: AppSpacing.md),

                // Facility selector
                Text('HOSPITAL FACILITY', style: AppTypography.labelBold(colors.textSecondary)),
                const SizedBox(height: 6),
                if (_facilities.isEmpty)
                  Text('No facility found. Add one from Hospital Profile.', style: AppTypography.bodySmall(colors.textMuted))
                else
                  DropdownButtonFormField<String>(
                    value: _selectedFacility?['name'] as String?,
                    isExpanded: true,
                    dropdownColor: colors.surfaceElevated,
                    style: AppTypography.bodyLarge(colors.textPrimary),
                    decoration: InputDecoration(
                      filled: true, fillColor: colors.surfaceElevated,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                        borderSide: BorderSide(color: colors.border),
                      ),
                    ),
                    items: _facilities.map((f) => DropdownMenuItem<String>(
                      value: f['name'] as String,
                      child: Text(f['name'] as String, overflow: TextOverflow.ellipsis),
                    )).toList(),
                    onChanged: (v) {
                      final fac = _facilities.firstWhere((f) => f['name'] == v, orElse: () => {});
                      if (fac.isNotEmpty) setState(() => _selectedFacility = fac);
                    },
                  ),
                const SizedBox(height: AppSpacing.md),

                // Specialty
                Text('SPECIALTY REQUIRED', style: AppTypography.labelBold(colors.textSecondary)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  value: _selectedSpecialty,
                  isExpanded: true,
                  dropdownColor: colors.surfaceElevated,
                  style: AppTypography.bodyLarge(colors.textPrimary),
                  decoration: InputDecoration(
                    filled: true, fillColor: colors.surfaceElevated,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                      borderSide: BorderSide(color: colors.border),
                    ),
                  ),
                  items: AppConstants.specialties.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                  onChanged: (v) => setState(() => _selectedSpecialty = v!),
                ),
                const SizedBox(height: AppSpacing.md),
                AppTextField(label: 'DEPARTMENT / WARD', controller: _departmentController, hintText: 'e.g. ICU & Emergency'),
                const SizedBox(height: AppSpacing.md),
                AppTextField(label: 'MINIMUM QUALIFICATION', controller: _qualificationController),
                const SizedBox(height: AppSpacing.md),
                AppTextField(label: 'MIN. YEARS EXPERIENCE', controller: _expController, keyboardType: TextInputType.number),
                const SizedBox(height: AppSpacing.md),
                AppTextField(label: 'REQUIRED HEADCOUNT', controller: _headcountController, keyboardType: TextInputType.number),
                const SizedBox(height: AppSpacing.md),

                // Schedule
                Text('SHIFT SCHEDULE', style: AppTypography.labelBold(colors.textSecondary)),
                const SizedBox(height: 6),
                AppCard(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Date', style: AppTypography.bodySmall(colors.textMuted)),
                          Text('${_selectedDate.day}/${_selectedDate.month}/${_selectedDate.year}', style: AppTypography.labelBold(colors.textPrimary)),
                        ],
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Hours', style: AppTypography.bodySmall(colors.textMuted)),
                          Text('${_startTime.format(context)} – ${_endTime.format(context)}', style: AppTypography.labelBold(AppColors.primaryLight)),
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
                          if (!mounted) return;
                          final start = await showTimePicker(context: context, initialTime: _startTime);
                          if (start != null) setState(() => _startTime = start);
                          if (!mounted) return;
                          final end = await showTimePicker(context: context, initialTime: _endTime);
                          if (end != null) setState(() => _endTime = end);
                        },
                        child: const Text('Change'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                AppTextField(
                  label: 'COMPENSATION AMOUNT (INR)',
                  controller: _amountController,
                  keyboardType: TextInputType.number,
                  prefixIcon: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                    child: Text('₹', style: TextStyle(color: colors.textPrimary, fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                AppTextField(label: 'ADDITIONAL NOTES (OPTIONAL)', controller: _notesController, maxLines: 3),
                const SizedBox(height: AppSpacing.xl),

                Row(
                  children: [
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
