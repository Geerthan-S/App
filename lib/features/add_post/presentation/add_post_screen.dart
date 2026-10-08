import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/widgets/state_views.dart';
import '../../duty_marketplace/data/duty_repository.dart';

class AddPostScreen extends StatefulWidget {
  const AddPostScreen({super.key});

  @override
  State<AddPostScreen> createState() => _AddPostScreenState();
}

class _AddPostScreenState extends State<AddPostScreen> {
  final _formKey = GlobalKey<FormState>();
  static final _dateFormat = DateFormat('d MMM yyyy');

  // Org/facility loaded from backend
  List<Map<String, dynamic>> _organizations = [];
  String? _selectedOrgId;
  List<Map<String, dynamic>> _facilities = [];
  String? _selectedFacilityId;
  String _selectedFacilityName = '';
  String _selectedFacilityCity = '';
  bool _loadingOrgs = true;
  String? _orgError;

  final _departmentController = TextEditingController();
  final _qualificationController = TextEditingController();
  final _amountController = TextEditingController();
  final _notesController = TextEditingController();

  String _selectedSpecialty = AppConstants.specialties.first;
  DateTime _selectedDate = DateTime.now().add(const Duration(days: 1));
  TimeOfDay _startTime = const TimeOfDay(hour: 8, minute: 0);
  TimeOfDay _endTime = const TimeOfDay(hour: 16, minute: 0);
  bool _isPosting = false;

  @override
  void initState() {
    super.initState();
    _loadOrgs();
  }

  @override
  void dispose() {
    _departmentController.dispose();
    _qualificationController.dispose();
    _amountController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _loadOrgs() async {
    try {
      final result = await FirebaseFunctions.instance
          .httpsCallable('getMyOrganizations')
          .call<Map<String, dynamic>>();
      final orgs = (result.data['organizations'] as List<dynamic>? ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      if (!mounted) return;
      setState(() {
        _organizations = orgs;
        _loadingOrgs = false;
        if (orgs.isNotEmpty) _selectOrg(orgs.first['organizationId'] as String);
      });
    } catch (_) {
      if (mounted) setState(() { _loadingOrgs = false; _orgError = 'Could not load organizations.'; });
    }
  }

  Future<void> _selectOrg(String orgId) async {
    setState(() => _selectedOrgId = orgId);
    try {
      final snap = await FirebaseFunctions.instance
          .httpsCallable('getMyOrganizations')
          .call<Map<String, dynamic>>();
      // Load facilities from Firestore subcollection via org ID
      final facilSnap = await _loadFacilities(orgId);
      if (!mounted) return;
      setState(() {
        _facilities = facilSnap;
        if (_facilities.isNotEmpty) {
          final f = _facilities.first;
          _selectedFacilityId = f['facilityId'] as String?;
          _selectedFacilityName = f['name'] as String? ?? '';
          _selectedFacilityCity = f['city'] as String? ?? '';
        } else {
          _selectedFacilityId = null;
          _selectedFacilityName = '';
          _selectedFacilityCity = '';
        }
      });
    } catch (_) {}
  }

  Future<List<Map<String, dynamic>>> _loadFacilities(String orgId) async {
    try {
      final snap = await FirebaseFunctions.instance
          .httpsCallable('getMyOrganizations')
          .call<Map<String, dynamic>>();
      // Extract facilities from org data
      final orgs = (snap.data['organizations'] as List<dynamic>? ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      final org = orgs.firstWhere((o) => o['organizationId'] == orgId, orElse: () => {});
      final facils = (org['facilities'] as List<dynamic>? ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      return facils;
    } catch (_) {
      return [];
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 180)),
    );
    if (picked != null) setState(() => _selectedDate = picked);
  }

  Future<void> _pickStartTime() async {
    final picked = await showTimePicker(context: context, initialTime: _startTime);
    if (picked != null) setState(() => _startTime = picked);
  }

  Future<void> _pickEndTime() async {
    final picked = await showTimePicker(context: context, initialTime: _endTime);
    if (picked != null) setState(() => _endTime = picked);
  }

  DateTime _combine(DateTime date, TimeOfDay time) =>
      DateTime(date.year, date.month, date.day, time.hour, time.minute);

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedOrgId == null || _selectedFacilityId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(backgroundColor: AppColors.rose, content: Text('Please set up a facility first.')),
      );
      return;
    }

    final startDt = _combine(_selectedDate, _startTime);
    var endDt = _combine(_selectedDate, _endTime);
    if (!endDt.isAfter(startDt)) endDt = endDt.add(const Duration(days: 1));

    setState(() => _isPosting = true);
    try {
      await DutyRepository.createAndPublish(
        organizationId: _selectedOrgId!,
        facilityId: _selectedFacilityId!,
        facilityName: _selectedFacilityName,
        city: _selectedFacilityCity,
        department: _departmentController.text.trim(),
        specialtyName: _selectedSpecialty,
        qualificationRequired: _qualificationController.text.trim(),
        experienceMinYears: 0,
        startAt: startDt,
        endAt: endDt,
        amount: double.tryParse(_amountController.text.trim()) ?? 0,
        headcount: 1,
        notes: _notesController.text.trim().isEmpty ? null : _notesController.text.trim(),
      );
      if (!mounted) return;
      _resetForm();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(backgroundColor: AppColors.emerald, content: Text('Duty posted successfully.')),
      );
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) return;
      final msg = e.code == 'HOSPITAL_NOT_VERIFIED'
          ? 'Your organization must be verified before posting duties.'
          : e.message ?? 'Could not post duty. Try again.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(backgroundColor: AppColors.rose, content: Text(msg)),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(backgroundColor: AppColors.rose, content: Text('Could not post duty. Try again.')),
      );
    } finally {
      if (mounted) setState(() => _isPosting = false);
    }
  }

  void _resetForm() {
    _departmentController.clear();
    _qualificationController.clear();
    _amountController.clear();
    _notesController.clear();
    setState(() {
      _selectedSpecialty = AppConstants.specialties.first;
      _selectedDate = DateTime.now().add(const Duration(days: 1));
      _startTime = const TimeOfDay(hour: 8, minute: 0);
      _endTime = const TimeOfDay(hour: 16, minute: 0);
    });
  }

  InputDecoration _dropdownDecoration(AppColorsExtension colors) => InputDecoration(
        filled: true,
        fillColor: colors.surfaceElevated,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          borderSide: BorderSide(color: colors.border),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text('Post a Duty', style: AppTypography.headingMedium(colors.textPrimary)),
      ),
      body: SafeArea(
        child: _loadingOrgs
            ? const Center(child: CircularProgressIndicator())
            : _organizations.isEmpty
                ? EmptyStateView(
                    icon: Icons.apartment_rounded,
                    title: 'No organization found',
                    description: _orgError ?? 'Set up your hospital organization to post duties.',
                  )
                : _facilities.isEmpty
                    ? const EmptyStateView(
                        icon: Icons.location_city_rounded,
                        title: 'No facility found',
                        description: 'Add a facility to your organization before posting duties.',
                      )
                    : SingleChildScrollView(
                        padding: AppSpacing.paddingScreen,
                        child: Form(
                          key: _formKey,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Org selector
                              if (_organizations.length > 1) ...[
                                Text('ORGANIZATION', style: AppTypography.labelBold(colors.textSecondary)),
                                const SizedBox(height: 6),
                                DropdownButtonFormField<String>(
                                  value: _selectedOrgId,
                                  isExpanded: true,
                                  dropdownColor: colors.surfaceElevated,
                                  style: AppTypography.bodyLarge(colors.textPrimary),
                                  decoration: _dropdownDecoration(colors),
                                  items: _organizations.map((o) => DropdownMenuItem<String>(
                                    value: o['organizationId'] as String,
                                    child: Text(o['displayName'] as String? ?? o['legalName'] as String? ?? ''),
                                  )).toList(),
                                  onChanged: (v) { if (v != null) _selectOrg(v); },
                                ),
                                const SizedBox(height: AppSpacing.md),
                              ],

                              // Facility selector
                              if (_facilities.length > 1) ...[
                                Text('FACILITY', style: AppTypography.labelBold(colors.textSecondary)),
                                const SizedBox(height: 6),
                                DropdownButtonFormField<String>(
                                  value: _selectedFacilityId,
                                  isExpanded: true,
                                  dropdownColor: colors.surfaceElevated,
                                  style: AppTypography.bodyLarge(colors.textPrimary),
                                  decoration: _dropdownDecoration(colors),
                                  items: _facilities.map((f) => DropdownMenuItem<String>(
                                    value: f['facilityId'] as String,
                                    child: Text('${f['name']} – ${f['city']}'),
                                  )).toList(),
                                  onChanged: (v) {
                                    if (v == null) return;
                                    final f = _facilities.firstWhere((x) => x['facilityId'] == v, orElse: () => {});
                                    setState(() {
                                      _selectedFacilityId = v;
                                      _selectedFacilityName = f['name'] as String? ?? '';
                                      _selectedFacilityCity = f['city'] as String? ?? '';
                                    });
                                  },
                                ),
                                const SizedBox(height: AppSpacing.md),
                              ] else ...[
                                AppCard(
                                  child: Row(
                                    children: [
                                      const Icon(Icons.location_on_rounded, color: AppColors.primaryLight, size: 18),
                                      const SizedBox(width: 8),
                                      Expanded(child: Text(
                                        '$_selectedFacilityName · $_selectedFacilityCity',
                                        style: AppTypography.bodyMedium(colors.textPrimary),
                                      )),
                                    ],
                                  ),
                                ),
                                const SizedBox(height: AppSpacing.md),
                              ],

                              Text('SPECIALTY', style: AppTypography.labelBold(colors.textSecondary)),
                              const SizedBox(height: 6),
                              DropdownButtonFormField<String>(
                                value: _selectedSpecialty,
                                isExpanded: true,
                                dropdownColor: colors.surfaceElevated,
                                style: AppTypography.bodyLarge(colors.textPrimary),
                                decoration: _dropdownDecoration(colors),
                                items: AppConstants.specialties.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                                onChanged: (val) => setState(() => _selectedSpecialty = val!),
                              ),
                              const SizedBox(height: AppSpacing.md),

                              AppTextField(
                                label: 'DEPARTMENT',
                                hintText: 'e.g. ICU & Emergency',
                                controller: _departmentController,
                                validator: (v) => (v == null || v.trim().isEmpty) ? 'Department is required' : null,
                              ),
                              const SizedBox(height: AppSpacing.md),

                              Text('SHIFT DATE & TIME', style: AppTypography.labelBold(colors.textSecondary)),
                              const SizedBox(height: 6),
                              AppCard(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text('Date', style: AppTypography.bodySmall(colors.textMuted)),
                                            Text(_dateFormat.format(_selectedDate),
                                                style: AppTypography.labelBold(colors.textPrimary)),
                                          ],
                                        ),
                                        OutlinedButton(
                                          style: OutlinedButton.styleFrom(
                                            foregroundColor: AppColors.primaryLight,
                                            side: BorderSide(color: colors.border),
                                          ),
                                          onPressed: _pickDate,
                                          child: const Text('Change'),
                                        ),
                                      ],
                                    ),
                                    const Divider(height: AppSpacing.lg),
                                    Row(
                                      children: [
                                        Expanded(child: _TimePickerTile(label: 'Start', time: _startTime, onTap: _pickStartTime)),
                                        const SizedBox(width: AppSpacing.sm),
                                        Expanded(child: _TimePickerTile(label: 'End', time: _endTime, onTap: _pickEndTime)),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: AppSpacing.md),

                              AppTextField(
                                label: 'COMPENSATION (₹ PER SHIFT)',
                                hintText: 'e.g. 6500',
                                controller: _amountController,
                                keyboardType: TextInputType.number,
                                validator: (v) {
                                  final amt = double.tryParse((v ?? '').trim());
                                  if (amt == null || amt <= 0) return 'Enter a valid amount';
                                  return null;
                                },
                              ),
                              const SizedBox(height: AppSpacing.md),

                              AppTextField(
                                label: 'QUALIFICATION REQUIRED',
                                hintText: 'e.g. MBBS, MD / DNB',
                                controller: _qualificationController,
                                validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                              ),
                              const SizedBox(height: AppSpacing.md),

                              AppTextField(
                                label: 'ADDITIONAL NOTES (OPTIONAL)',
                                hintText: 'Any special requirements...',
                                controller: _notesController,
                                maxLines: 2,
                              ),
                              const SizedBox(height: AppSpacing.xl),

                              AppButton(
                                label: 'Post Duty',
                                icon: Icons.add_circle_outline_rounded,
                                isLoading: _isPosting,
                                onPressed: _submit,
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

class _TimePickerTile extends StatelessWidget {
  final String label;
  final TimeOfDay time;
  final VoidCallback onTap;

  const _TimePickerTile({required this.label, required this.time, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: colors.surfaceElevated,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(color: colors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: AppTypography.bodySmall(colors.textMuted)),
            const SizedBox(height: 2),
            Row(
              children: [
                const Icon(Icons.access_time_rounded, size: 16, color: AppColors.primaryLight),
                const SizedBox(width: 6),
                Text(time.format(context), style: AppTypography.labelBold(colors.textPrimary)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
