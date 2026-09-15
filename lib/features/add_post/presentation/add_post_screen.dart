/**
 * Add Post Screen
 * Lets a doctor create a new duty/job post, using the same duty data model
 * as the rest of the app (MockData.duties) — no separate backend/model.
 */

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/mock_data.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_inputs.dart';

class AddPostScreen extends StatefulWidget {
  const AddPostScreen({super.key});

  @override
  State<AddPostScreen> createState() => _AddPostScreenState();
}

class _AddPostScreenState extends State<AddPostScreen> {
  final _formKey = GlobalKey<FormState>();
  static const _uuid = Uuid();
  static final _dateFormat = DateFormat('d MMM, hh:mm a');

  final _facilityController = TextEditingController();
  final _departmentController = TextEditingController();
  final _qualificationController = TextEditingController();
  final _amountController = TextEditingController();

  String _selectedSpecialty = AppConstants.specialties.first;
  String _selectedCity = AppConstants.majorCities.first;

  DateTime _selectedDate = DateTime.now().add(const Duration(days: 1));
  TimeOfDay _startTime = const TimeOfDay(hour: 8, minute: 0);
  TimeOfDay _endTime = const TimeOfDay(hour: 16, minute: 0);

  bool _isPosting = false;

  @override
  void dispose() {
    _facilityController.dispose();
    _departmentController.dispose();
    _qualificationController.dispose();
    _amountController.dispose();
    super.dispose();
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

  void _submit() {
    if (!_formKey.currentState!.validate()) return;

    final startDateTime = _combine(_selectedDate, _startTime);
    var endDateTime = _combine(_selectedDate, _endTime);
    if (!endDateTime.isAfter(startDateTime)) {
      // Overnight shift (e.g. 08:00 PM - 08:00 AM) rolls over to the next day.
      endDateTime = endDateTime.add(const Duration(days: 1));
    }

    final hours = endDateTime.difference(startDateTime).inMinutes / 60.0;
    final hoursLabel = hours == hours.roundToDouble() ? hours.toInt().toString() : hours.toStringAsFixed(1);

    final rawAmount = double.tryParse(_amountController.text.trim()) ?? 0;
    final amount = rawAmount == rawAmount.roundToDouble() ? rawAmount.toInt() : rawAmount;

    setState(() => _isPosting = true);

    Future.delayed(const Duration(milliseconds: 700), () {
      if (!mounted) return;

      final newDuty = <String, dynamic>{
        'dutyId': 'duty_${_uuid.v4()}',
        'facilityName': _facilityController.text.trim(),
        'city': _selectedCity,
        'distanceKm': 0.0,
        'department': _departmentController.text.trim(),
        'specialtyName': _selectedSpecialty,
        'qualificationRequired': _qualificationController.text.trim(),
        'startAt': _dateFormat.format(startDateTime),
        'endAt': _dateFormat.format(endDateTime),
        'shiftType': 'Custom Shift ($hoursLabel hrs)',
        'headcount': 1,
        'remainingHeadcount': 1,
        'amount': amount,
        'basis': 'per_shift',
        'isVerifiedOrg': false,
        'status': 'published',
      };

      MockData.duties.insert(0, newDuty);

      setState(() => _isPosting = false);
      _resetForm();

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: AppColors.emerald,
          content: Text('Duty post created successfully.'),
        ),
      );
    });
  }

  void _resetForm() {
    _facilityController.clear();
    _departmentController.clear();
    _qualificationController.clear();
    _amountController.clear();
    setState(() {
      _selectedSpecialty = AppConstants.specialties.first;
      _selectedCity = AppConstants.majorCities.first;
      _selectedDate = DateTime.now().add(const Duration(days: 1));
      _startTime = const TimeOfDay(hour: 8, minute: 0);
      _endTime = const TimeOfDay(hour: 16, minute: 0);
    });
  }

  InputDecoration _dropdownDecoration() {
    return InputDecoration(
      filled: true,
      fillColor: AppColors.surfaceElevatedLight,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        borderSide: const BorderSide(color: AppColors.borderLight),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgLight,
      appBar: AppBar(
        title: Text('Create Post', style: AppTypography.headingMedium(AppColors.textLightPrimary)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: AppSpacing.paddingScreen,
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Post a Duty Opportunity', style: AppTypography.headingLarge(AppColors.textLightPrimary)),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Share a duty opening so other doctors can find it and start a chat with you.',
                  style: AppTypography.bodyMedium(AppColors.textLightSecondary),
                ),
                const SizedBox(height: AppSpacing.lg),

                AppTextField(
                  label: 'HOSPITAL / CLINIC',
                  hintText: 'e.g. Apollo Specialty Hospital',
                  controller: _facilityController,
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Hospital / clinic name is required' : null,
                ),
                const SizedBox(height: AppSpacing.md),

                Text('SPECIALTY', style: AppTypography.labelBold(AppColors.textLightSecondary)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  value: _selectedSpecialty,
                  isExpanded: true,
                  dropdownColor: AppColors.surfaceElevatedLight,
                  style: AppTypography.bodyLarge(AppColors.textLightPrimary),
                  decoration: _dropdownDecoration(),
                  items: AppConstants.specialties.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                  onChanged: (val) => setState(() => _selectedSpecialty = val!),
                ),
                const SizedBox(height: AppSpacing.md),

                AppTextField(
                  label: 'DUTY / JOB DETAILS (DEPARTMENT)',
                  hintText: 'e.g. ICU & Emergency',
                  controller: _departmentController,
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Duty / job details are required' : null,
                ),
                const SizedBox(height: AppSpacing.md),

                Text('LOCATION', style: AppTypography.labelBold(AppColors.textLightSecondary)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  value: _selectedCity,
                  isExpanded: true,
                  dropdownColor: AppColors.surfaceElevatedLight,
                  style: AppTypography.bodyLarge(AppColors.textLightPrimary),
                  decoration: _dropdownDecoration(),
                  items: AppConstants.majorCities.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                  onChanged: (val) => setState(() => _selectedCity = val!),
                ),
                const SizedBox(height: AppSpacing.md),

                Text('SHIFT DATE & TIME', style: AppTypography.labelBold(AppColors.textLightSecondary)),
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
                              Text('Date', style: AppTypography.bodySmall(AppColors.textLightMuted)),
                              Text(
                                DateFormat('d MMM yyyy').format(_selectedDate),
                                style: AppTypography.labelBold(AppColors.textLightPrimary),
                              ),
                            ],
                          ),
                          OutlinedButton(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: AppColors.primaryLight,
                              side: const BorderSide(color: AppColors.borderLight),
                            ),
                            onPressed: _pickDate,
                            child: const Text('Change'),
                          ),
                        ],
                      ),
                      const Divider(height: AppSpacing.lg),
                      Row(
                        children: [
                          Expanded(
                            child: _TimePickerTile(
                              label: 'Start Time',
                              time: _startTime,
                              onTap: _pickStartTime,
                            ),
                          ),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: _TimePickerTile(
                              label: 'End Time',
                              time: _endTime,
                              onTap: _pickEndTime,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                AppTextField(
                  label: 'COMPENSATION (INR PER SHIFT)',
                  hintText: 'e.g. 6500',
                  controller: _amountController,
                  keyboardType: TextInputType.number,
                  prefixIcon: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                    child: Text('₹', style: TextStyle(color: AppColors.textLightPrimary, fontWeight: FontWeight.bold)),
                  ),
                  validator: (v) {
                    final amount = double.tryParse((v ?? '').trim());
                    if (amount == null || amount <= 0) return 'Enter a valid compensation amount';
                    return null;
                  },
                ),
                const SizedBox(height: AppSpacing.md),

                AppTextField(
                  label: 'QUALIFICATION / ADDITIONAL REQUIREMENTS',
                  hintText: 'e.g. MBBS, MD / DNB — mention any specific requirements',
                  controller: _qualificationController,
                  maxLines: 3,
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Please describe the requirements' : null,
                ),
                const SizedBox(height: AppSpacing.xl),

                AppButton(
                  label: 'Create Post',
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
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevatedLight,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(color: AppColors.borderLight),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: AppTypography.bodySmall(AppColors.textLightMuted)),
            const SizedBox(height: 2),
            Row(
              children: [
                const Icon(Icons.access_time_rounded, size: 16, color: AppColors.primaryLight),
                const SizedBox(width: 6),
                Text(time.format(context), style: AppTypography.labelBold(AppColors.textLightPrimary)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
