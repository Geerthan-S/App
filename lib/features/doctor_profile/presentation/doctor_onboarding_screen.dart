/**
 * Doctor Onboarding & Council Registration Screen
 */

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_inputs.dart';
import '../data/doctor_repository.dart';

class DoctorOnboardingScreen extends ConsumerStatefulWidget {
  const DoctorOnboardingScreen({super.key});

  @override
  ConsumerState<DoctorOnboardingScreen> createState() => _DoctorOnboardingScreenState();
}

class _DoctorOnboardingScreenState extends ConsumerState<DoctorOnboardingScreen> {
  final _nameController = TextEditingController();
  final _regNoController = TextEditingController();
  final _qualificationController = TextEditingController();
  final _experienceController = TextEditingController();
  String _selectedCouncil = AppConstants.medicalCouncils.first;
  String _selectedSpecialty = AppConstants.specialties.first;
  String _selectedCity = AppConstants.majorCities.first;
  bool _isLoading = false;

  @override
  void dispose() {
    _nameController.dispose();
    _regNoController.dispose();
    _qualificationController.dispose();
    _experienceController.dispose();
    super.dispose();
  }

  void _showMessage(String message, Color background) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(backgroundColor: background, content: Text(message)),
    );
  }

  /// Mirrors the server's SubmitDoctorProfileSchema so obvious mistakes are
  /// caught before the round trip; the server still validates everything.
  String? _validate() {
    if (_nameController.text.trim().length < 2) return 'Enter your full name as registered.';
    if (_regNoController.text.trim().length < 2) return 'Enter your council registration number.';
    if (_qualificationController.text.trim().length < 2) return 'Enter your primary qualifications.';
    final years = int.tryParse(_experienceController.text.trim());
    if (years == null || years < 0 || years > 70) return 'Enter years of experience as a whole number (0–70).';
    return null;
  }

  Future<void> _submitProfile() async {
    final problem = _validate();
    if (problem != null) {
      _showMessage(problem, AppColors.rose);
      return;
    }
    setState(() => _isLoading = true);
    try {
      await DoctorRepository.saveProfile(
        fullName: _nameController.text.trim(),
        council: _selectedCouncil,
        registrationNo: _regNoController.text.trim(),
        qualification: _qualificationController.text.trim(),
        primarySpecialty: _selectedSpecialty,
        preferredCities: [_selectedCity],
        yearsOfExperience: int.parse(_experienceController.text.trim()),
      );
      if (!mounted) return;
      _showMessage('Profile saved. Upload your registration proof to get verified.', AppColors.emerald);
      context.go('/home');
    } on FirebaseFunctionsException catch (e) {
      if (mounted) _showMessage(e.message ?? 'Could not save profile. Try again.', AppColors.rose);
    } catch (_) {
      if (mounted) _showMessage('Could not save profile. Check your connection and try again.', AppColors.rose);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Doctor Registration'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Professional Identity',
                style: AppTypography.headingLarge(colors.textPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Enter your official details as registered with the medical council.',
                style: AppTypography.bodyMedium(colors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.lg),
              AppTextField(
                label: 'Full name (as per council registration)',
                hintText: 'e.g. Dr. Priya Raman',
                controller: _nameController,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'Medical council',
                style: AppTypography.labelBold(colors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.xs),
              DropdownButtonFormField<String>(
                value: _selectedCouncil,
                dropdownColor: colors.surface,
                                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                style: AppTypography.bodyLarge(colors.textPrimary),
                decoration: const InputDecoration(),
                items: AppConstants.medicalCouncils
                    .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                    .toList(),
                onChanged: (val) => setState(() => _selectedCouncil = val!),
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                label: 'Registration number',
                hintText: 'As printed on your council certificate',
                controller: _regNoController,
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                label: 'Primary qualifications',
                hintText: 'e.g. MBBS, MD',
                controller: _qualificationController,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'Primary clinical specialty',
                style: AppTypography.labelBold(colors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.xs),
              DropdownButtonFormField<String>(
                value: _selectedSpecialty,
                dropdownColor: colors.surface,
                                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                style: AppTypography.bodyLarge(colors.textPrimary),
                decoration: const InputDecoration(),
                items: AppConstants.specialties
                    .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                    .toList(),
                onChanged: (val) => setState(() => _selectedSpecialty = val!),
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                label: 'Years of clinical experience',
                hintText: 'e.g. 5',
                controller: _experienceController,
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'Preferred work city',
                style: AppTypography.labelBold(colors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.xs),
              DropdownButtonFormField<String>(
                value: _selectedCity,
                dropdownColor: colors.surface,
                                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                style: AppTypography.bodyLarge(colors.textPrimary),
                decoration: const InputDecoration(),
                items: AppConstants.majorCities
                    .map((city) => DropdownMenuItem(value: city, child: Text(city)))
                    .toList(),
                onChanged: (val) => setState(() => _selectedCity = val!),
              ),
              const SizedBox(height: AppSpacing.xl),
              AppButton(
                label: 'Save & Continue to Marketplace',
                isLoading: _isLoading,
                onPressed: _submitProfile,
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}
