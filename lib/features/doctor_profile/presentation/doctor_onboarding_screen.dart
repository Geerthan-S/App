/**
 * Doctor Onboarding & Council Registration Screen
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_inputs.dart';

class DoctorOnboardingScreen extends ConsumerStatefulWidget {
  const DoctorOnboardingScreen({super.key});

  @override
  ConsumerState<DoctorOnboardingScreen> createState() => _DoctorOnboardingScreenState();
}

class _DoctorOnboardingScreenState extends ConsumerState<DoctorOnboardingScreen> {
  final _nameController = TextEditingController(text: 'Dr. Aravind Swaminathan');
  final _regNoController = TextEditingController(text: '98234');
  final _qualificationController = TextEditingController(text: 'MBBS, MD');
  final _experienceController = TextEditingController(text: '5');
  String _selectedCouncil = AppConstants.medicalCouncils.first;
  String _selectedSpecialty = AppConstants.specialties.first;
  String _selectedCity = AppConstants.majorCities.first;
  bool _isLoading = false;

  void _submitProfile() {
    setState(() => _isLoading = true);
    Future.delayed(const Duration(milliseconds: 700), () {
      if (mounted) {
        setState(() => _isLoading = false);
        context.go('/home');
      }
    });
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
                controller: _regNoController,
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                label: 'Primary qualifications',
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
