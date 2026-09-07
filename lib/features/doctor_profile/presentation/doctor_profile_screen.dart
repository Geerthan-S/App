/**
 * Doctor Profile Screen
 * Manages identity, qualifications, specialties, locations, bio, and re-verification triggers.
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';

class DoctorProfileScreen extends ConsumerStatefulWidget {
  const DoctorProfileScreen({super.key});

  @override
  ConsumerState<DoctorProfileScreen> createState() => _DoctorProfileScreenState();
}

class _DoctorProfileScreenState extends ConsumerState<DoctorProfileScreen> {
  String _fullName = 'Dr. Aravind Swaminathan';
  String _qualifications = 'MBBS, MD (General Medicine)';
  String _primarySpecialty = 'General Medicine';
  int _experienceYears = 5;
  String _preferredHubs = 'Chennai, Coimbatore';
  String _bio = 'Consultant Physician with 5+ years experience in ICU management, inpatient care, and acute medical emergencies.';
  bool _isVerified = true;

  void _showEditProfileSheet() {
    final nameCtrl = TextEditingController(text: _fullName);
    final qualCtrl = TextEditingController(text: _qualifications);
    final expCtrl = TextEditingController(text: _experienceYears.toString());
    final hubsCtrl = TextEditingController(text: _preferredHubs);
    final bioCtrl = TextEditingController(text: _bio);
    String selectedSpec = _primarySpecialty;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surfaceDark,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpacing.radiusLg)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 20,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
              ),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Edit Doctor Profile', style: AppTypography.headingSmall(AppColors.textDarkPrimary)),
                        IconButton(
                          icon: const Icon(Icons.close_rounded, color: AppColors.textDarkMuted),
                          onPressed: () => Navigator.pop(ctx),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),

                    // Re-verification warning alert
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.amber.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                        border: Border.all(color: AppColors.amber.withOpacity(0.4)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.warning_amber_rounded, color: AppColors.amber, size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Important: Modifying your registered name or primary qualifications will reset your verified status and trigger an automated re-verification check.',
                              style: AppTypography.bodySmall(AppColors.amber),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    AppTextField(label: 'FULL NAME', controller: nameCtrl),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(label: 'QUALIFICATIONS', controller: qualCtrl),
                    const SizedBox(height: AppSpacing.md),
                    Text('PRIMARY SPECIALTY', style: AppTypography.labelBold(AppColors.textDarkSecondary)),
                    const SizedBox(height: 6),
                    DropdownButtonFormField<String>(
                      value: selectedSpec,
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
                      onChanged: (val) => setSheetState(() => selectedSpec = val!),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'YEARS OF CLINICAL EXPERIENCE',
                      controller: expCtrl,
                      keyboardType: TextInputType.number,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'PREFERRED WORK HUBS',
                      controller: hubsCtrl,
                      hintText: 'e.g. Chennai, Bengaluru',
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'PROFESSIONAL BIO',
                      controller: bioCtrl,
                      maxLines: 3,
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    AppButton(
                      label: 'Save Profile Changes',
                      onPressed: () {
                        final qualChanged = qualCtrl.text.trim() != _qualifications;
                        final nameChanged = nameCtrl.text.trim() != _fullName;

                        setState(() {
                          _fullName = nameCtrl.text.trim();
                          _qualifications = qualCtrl.text.trim();
                          _primarySpecialty = selectedSpec;
                          _experienceYears = int.tryParse(expCtrl.text.trim()) ?? _experienceYears;
                          _preferredHubs = hubsCtrl.text.trim();
                          _bio = bioCtrl.text.trim();

                          if (qualChanged || nameChanged) {
                            _isVerified = false; // Re-verification triggered
                          }
                        });

                        Navigator.pop(ctx);

                        if (qualChanged || nameChanged) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              backgroundColor: AppColors.amber,
                              content: Text('Material credential change detected. Re-verification review initiated.'),
                            ),
                          );
                        } else {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              backgroundColor: AppColors.emerald,
                              content: Text('Doctor profile updated successfully.'),
                            ),
                          );
                        }
                      },
                    ),
                    const SizedBox(height: AppSpacing.md),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final loc = ref.watch(localizationProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.translate('profile')),
        actions: [
          IconButton(
            icon: const Icon(Icons.language_rounded),
            tooltip: 'Language Navigation',
            onPressed: () => LanguageSelectorDialog.show(context),
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push('/settings'),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Doctor Header Card
              AppCard(
                child: Column(
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 56,
                          height: 56,
                          decoration: BoxDecoration(
                            color: AppColors.primary,
                            borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
                          ),
                          child: const Center(
                            child: Text('AS', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Text(
                                    _fullName,
                                    style: AppTypography.headingSmall(AppColors.textDarkPrimary),
                                  ),
                                  const SizedBox(width: 6),
                                  Icon(
                                    _isVerified ? Icons.verified_rounded : Icons.pending_rounded,
                                    color: _isVerified ? AppColors.emerald : AppColors.amber,
                                    size: 18,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(_qualifications, style: AppTypography.bodyMedium(AppColors.textDarkSecondary)),
                              Text('$_experienceYears Years Clinical Experience', style: AppTypography.bodySmall(AppColors.textDarkMuted)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.md),
                    OutlinedButton.icon(
                      icon: const Icon(Icons.edit_outlined, size: 16),
                      label: const Text('Edit Profile & Bio'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.primaryLight,
                        side: const BorderSide(color: AppColors.borderDark),
                        minimumSize: const Size.fromHeight(40),
                      ),
                      onPressed: _showEditProfileSheet,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Verification Quick Link Card
              AppCard(
                onTap: () => context.push('/verification'),
                child: Row(
                  children: [
                    Icon(
                      _isVerified ? Icons.shield_outlined : Icons.warning_amber_rounded,
                      color: _isVerified ? AppColors.emerald : AppColors.amber,
                      size: 24,
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Medical Council Verification', style: AppTypography.labelBold(AppColors.textDarkPrimary)),
                          Text(
                            _isVerified
                                ? 'Tamil Nadu Medical Council • Verified'
                                : 'Pending Council Review / Re-verification',
                            style: AppTypography.bodySmall(_isVerified ? AppColors.emerald : AppColors.amber),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.arrow_forward_ios_rounded, color: AppColors.textDarkMuted, size: 16),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Clinical Bio
              Text('Professional Summary', style: AppTypography.headingSmall(AppColors.textDarkPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Text(
                  _bio,
                  style: AppTypography.bodyMedium(AppColors.textDarkSecondary),
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Specialty Areas
              Text('Clinical Specialties', style: AppTypography.headingSmall(AppColors.textDarkPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    Chip(
                      label: Text(_primarySpecialty),
                      backgroundColor: AppColors.primary.withOpacity(0.15),
                      labelStyle: const TextStyle(color: AppColors.primaryLight, fontWeight: FontWeight.bold),
                    ),
                    Chip(
                      label: const Text('Emergency Triage'),
                      backgroundColor: AppColors.surfaceElevatedDark,
                      labelStyle: const TextStyle(color: AppColors.textDarkSecondary),
                    ),
                    Chip(
                      label: const Text('Critical Care Coverage'),
                      backgroundColor: AppColors.surfaceElevatedDark,
                      labelStyle: const TextStyle(color: AppColors.textDarkSecondary),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Preferred Hubs
              Text('Preferred Work Hubs', style: AppTypography.headingSmall(AppColors.textDarkPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Row(
                  children: [
                    const Icon(Icons.location_on_outlined, color: AppColors.textDarkMuted, size: 20),
                    const SizedBox(width: 8),
                    Text(_preferredHubs, style: AppTypography.bodyMedium(AppColors.textDarkPrimary)),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}
