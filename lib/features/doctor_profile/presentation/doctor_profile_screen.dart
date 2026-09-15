/**
 * Doctor Profile Screen
 * Manages identity, qualifications, specialties, locations, bio, and re-verification triggers.
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/mock_data.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';

class DoctorProfileScreen extends ConsumerStatefulWidget {
  const DoctorProfileScreen({super.key});

  @override
  ConsumerState<DoctorProfileScreen> createState() => _DoctorProfileScreenState();
}

class _DoctorProfileScreenState extends ConsumerState<DoctorProfileScreen> {
  String _fullName = MockData.currentDoctorName;
  String _qualifications = 'MBBS, MD (General Medicine)';
  String _primarySpecialty = 'General Medicine';
  int _experienceYears = 5;
  String _preferredHubs = 'Chennai, Coimbatore';
  String _bio = 'Consultant Physician with 5+ years experience in ICU management, inpatient care, and acute medical emergencies.';
  bool _isVerified = true;

  static const List<String> _specialtyChips = ['Emergency Triage', 'Critical Care Coverage'];

  double get _doctorRating {
    const reviews = MockData.doctorReviews;
    if (reviews.isEmpty) return 0;
    final total = reviews.fold<num>(0, (sum, r) => sum + (r['rating'] as num));
    return total / reviews.length;
  }

  double get _profileCompletion {
    final checks = <bool>[
      _fullName.trim().isNotEmpty,
      _qualifications.trim().isNotEmpty,
      _bio.trim().isNotEmpty,
      _preferredHubs.trim().isNotEmpty,
      _isVerified,
    ];
    return checks.where((c) => c).length / checks.length;
  }

  Widget _buildStatTile(String value, String label, {IconData? icon}) {
    final colors = context.appColors;
    return AppCard(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(value, style: AppTypography.headingSmall(colors.textPrimary)),
              if (icon != null) ...[
                const SizedBox(width: 2),
                Icon(icon, color: AppColors.amber, size: 16),
              ],
            ],
          ),
          const SizedBox(height: 2),
          Text(label, style: AppTypography.bodySmall(colors.textMuted)),
        ],
      ),
    );
  }

  Widget _buildReviewLinkCard({
    required String title,
    required double rating,
    required int count,
    required VoidCallback onTap,
  }) {
    final colors = context.appColors;
    return AppCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppTypography.labelBold(colors.textPrimary)),
          const SizedBox(height: 6),
          Row(
            children: [
              const Icon(Icons.star_rounded, color: AppColors.amber, size: 18),
              const SizedBox(width: 4),
              Text(rating.toStringAsFixed(1), style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(width: 4),
              Text('($count)', style: AppTypography.bodySmall(colors.textMuted)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMyDutyTile({
    required Map<String, dynamic> duty,
    required Map<String, dynamic> conversation,
  }) {
    final colors = context.appColors;
    return AppCard(
      onTap: () => context.push('/chat', extra: conversation),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.12),
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            ),
            child: const Icon(Icons.local_hospital_rounded, color: AppColors.primary, size: 20),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  duty['facilityName'] as String,
                  style: AppTypography.labelBold(colors.textPrimary),
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  '${duty['specialtyName']} • ${duty['startAt']}',
                  style: AppTypography.bodySmall(colors.textMuted),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.xs),
          StatusBadge(status: conversation['dutyStatus'] as String),
        ],
      ),
    );
  }

  Widget _buildAccountTile({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    Color? color,
  }) {
    final colors = context.appColors;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Icon(icon, color: color ?? AppColors.primary, size: 22),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(label, style: AppTypography.labelBold(color ?? colors.textPrimary)),
            ),
            Icon(Icons.arrow_forward_ios_rounded, color: colors.textMuted, size: 16),
          ],
        ),
      ),
    );
  }

  void _showEditProfileSheet() {
    final nameCtrl = TextEditingController(text: _fullName);
    final qualCtrl = TextEditingController(text: _qualifications);
    final expCtrl = TextEditingController(text: _experienceYears.toString());
    final hubsCtrl = TextEditingController(text: _preferredHubs);
    final bioCtrl = TextEditingController(text: _bio);
    String selectedSpec = _primarySpecialty;
    final colors = context.appColors;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: colors.surface,
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
                        Text('Edit Doctor Profile', style: AppTypography.headingSmall(colors.textPrimary)),
                        IconButton(
                          icon: Icon(Icons.close_rounded, color: colors.textMuted),
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
                    Text('PRIMARY SPECIALTY', style: AppTypography.labelBold(colors.textSecondary)),
                    const SizedBox(height: 6),
                    DropdownButtonFormField<String>(
                      value: selectedSpec,
                      dropdownColor: colors.surfaceElevated,
                      style: AppTypography.bodyLarge(colors.textPrimary),
                      decoration: InputDecoration(
                        filled: true,
                        fillColor: colors.surfaceElevated,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                          borderSide: BorderSide(color: colors.border),
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
    final colors = context.appColors;
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
                                    style: AppTypography.headingSmall(colors.textPrimary),
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
                              Text(_qualifications, style: AppTypography.bodyMedium(colors.textSecondary)),
                              Text('$_experienceYears Years Clinical Experience', style: AppTypography.bodySmall(colors.textMuted)),
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
                        side: BorderSide(color: colors.border),
                        minimumSize: const Size.fromHeight(40),
                      ),
                      onPressed: _showEditProfileSheet,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Quick Stats
              Row(
                children: [
                  Expanded(child: _buildStatTile('$_experienceYears yrs', 'Experience')),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(child: _buildStatTile('${_specialtyChips.length + 1}', 'Specialties')),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(child: _buildStatTile(_doctorRating.toStringAsFixed(1), 'Rating', icon: Icons.star_rounded)),
                ],
              ),
              const SizedBox(height: AppSpacing.md),

              // Profile Completion
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Profile Strength', style: AppTypography.labelBold(colors.textPrimary)),
                        Text(
                          '${(_profileCompletion * 100).round()}%',
                          style: AppTypography.labelBold(AppColors.emerald),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
                      child: LinearProgressIndicator(
                        value: _profileCompletion,
                        minHeight: 6,
                        backgroundColor: colors.surfaceElevated,
                        valueColor: const AlwaysStoppedAnimation<Color>(AppColors.emerald),
                      ),
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
                          Text('Medical Council Verification', style: AppTypography.labelBold(colors.textPrimary)),
                          Text(
                            _isVerified
                                ? 'Tamil Nadu Medical Council • Verified'
                                : 'Pending Council Review / Re-verification',
                            style: AppTypography.bodySmall(_isVerified ? AppColors.emerald : AppColors.amber),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.arrow_forward_ios_rounded, color: colors.textMuted, size: 16),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Clinical Bio
              Text('Professional Summary', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Text(
                  _bio,
                  style: AppTypography.bodyMedium(colors.textSecondary),
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Specialty Areas
              Text('Clinical Specialties', style: AppTypography.headingSmall(colors.textPrimary)),
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
                    ..._specialtyChips.map(
                      (specialty) => Chip(
                        label: Text(specialty),
                        backgroundColor: colors.surfaceElevated,
                        labelStyle: TextStyle(color: colors.textSecondary),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Preferred Hubs
              Text('Preferred Work Hubs', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Row(
                  children: [
                    Icon(Icons.location_on_outlined, color: colors.textMuted, size: 20),
                    const SizedBox(width: 8),
                    Text(_preferredHubs, style: AppTypography.bodyMedium(colors.textPrimary)),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // My Duties — duties the doctor is actively engaged with,
              // derived from MockData.conversations (no separate model).
              if (MockData.myDuties.isNotEmpty) ...[
                Text('My Duties', style: AppTypography.headingSmall(colors.textPrimary)),
                const SizedBox(height: AppSpacing.xs),
                ...MockData.myDuties.map((entry) => Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: _buildMyDutyTile(
                        duty: entry['duty'] as Map<String, dynamic>,
                        conversation: entry['conversation'] as Map<String, dynamic>,
                      ),
                    )),
                const SizedBox(height: AppSpacing.xs),
              ],

              // Hospital / Clinic
              Text('Hospital / Clinic', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                onTap: () => context.push('/hospital-info'),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                      ),
                      child: const Icon(Icons.local_hospital_rounded, color: AppColors.primary, size: 24),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  MockData.hospitalProfile['name'] as String,
                                  style: AppTypography.labelBold(colors.textPrimary),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (MockData.hospitalProfile['isVerified'] == true) ...[
                                const SizedBox(width: 4),
                                const Icon(Icons.verified_rounded, color: AppColors.emerald, size: 16),
                              ],
                            ],
                          ),
                          Text(
                            MockData.hospitalProfile['city'] as String,
                            style: AppTypography.bodySmall(colors.textMuted),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.arrow_forward_ios_rounded, color: colors.textMuted, size: 16),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Reviews
              Text('Reviews', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              Row(
                children: [
                  Expanded(
                    child: _buildReviewLinkCard(
                      title: 'Doctor Reviews',
                      rating: _doctorRating,
                      count: MockData.doctorReviews.length,
                      onTap: () => context.push('/reviews', extra: {
                        'title': 'Doctor Reviews',
                        'reviews': MockData.doctorReviews,
                      }),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: _buildReviewLinkCard(
                      title: 'Hospital Reviews',
                      rating: MockData.hospitalProfile['rating'] as double,
                      count: MockData.hospitalReviews.length,
                      onTap: () => context.push('/reviews', extra: {
                        'title': 'Hospital Reviews',
                        'reviews': MockData.hospitalReviews,
                      }),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),

              // Account
              Text('Account', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Column(
                  children: [
                    _buildAccountTile(
                      icon: Icons.settings_outlined,
                      label: 'Settings',
                      onTap: () => context.push('/settings'),
                    ),
                    const Divider(),
                    _buildAccountTile(
                      icon: Icons.logout_rounded,
                      label: 'Logout',
                      color: AppColors.rose,
                      onTap: () => context.go('/login'),
                    ),
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
