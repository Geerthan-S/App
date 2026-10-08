/**
 * Doctor Profile Screen
 * Manages identity, qualifications, specialties, locations, bio, and re-verification triggers.
 */

import 'package:firebase_auth/firebase_auth.dart';
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
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';
import '../../auth/data/auth_repository.dart';
import '../data/doctor_repository.dart';

class DoctorProfileScreen extends ConsumerStatefulWidget {
  const DoctorProfileScreen({super.key});

  @override
  ConsumerState<DoctorProfileScreen> createState() => _DoctorProfileScreenState();
}

class _DoctorProfileScreenState extends ConsumerState<DoctorProfileScreen> {
  String _fullName = '';
  String _qualifications = '';
  String _council = '';
  String _registrationNo = '';
  String _primarySpecialty = AppConstants.specialties.first;
  int _experienceYears = 0;
  String _preferredHubs = '';
  String _bio = '';
  bool _isVerified = false;
  String? _uid;
  List<String> _specialtyChips = [];
  double _doctorRating = 0.0;
  int _reviewCount = 0;

  @override
  void initState() {
    super.initState();
    _uid = FirebaseAuth.instance.currentUser?.uid;
    _loadProfile();
    _loadReviews();
  }

  Future<void> _loadProfile() async {
    final profile = await DoctorRepository.getProfile();
    if (!mounted || profile == null) return;
    setState(() {
      _fullName = profile['fullName'] as String? ?? '';
      _qualifications = profile['qualification'] as String? ?? '';
      _council = profile['council'] as String? ?? '';
      _registrationNo = profile['registrationNo'] as String? ?? '';
      _primarySpecialty = profile['primarySpecialty'] as String? ?? AppConstants.specialties.first;
      _experienceYears = (profile['yearsOfExperience'] as num?)?.toInt() ?? 0;
      final cities = profile['preferredCities'];
      _preferredHubs = cities is List ? (cities as List).join(', ') : (cities as String? ?? '');
      _bio = profile['bio'] as String? ?? '';
      _isVerified = profile['isVerified'] == true;
      final specialties = profile['specialties'];
      if (specialties is List) {
        _specialtyChips = specialties.cast<String>().where((s) => s != _primarySpecialty).toList();
      }
    });
  }

  Future<void> _loadReviews() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    DoctorRepository.watchReviews(uid).listen((reviews) {
      if (!mounted) return;
      setState(() {
        _reviewCount = reviews.length;
        if (reviews.isNotEmpty) {
          final total = reviews.fold<num>(0, (s, r) => s + (r['rating'] as num));
          _doctorRating = total / reviews.length;
        } else {
          _doctorRating = 0.0;
        }
      });
    });
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

  Future<void> _openDoctorReviews(BuildContext context) async {
    final uid = _uid;
    if (uid == null) return;
    final reviews = await DoctorRepository.watchReviews(uid).first;
    if (!mounted) return;
    context.push('/reviews', extra: {'title': 'Doctor Reviews', 'reviews': reviews});
  }

  void _showEditProfileSheet() {
    final nameCtrl = TextEditingController(text: _fullName);
    final councilCtrl = TextEditingController(text: _council);
    final regNoCtrl = TextEditingController(text: _registrationNo);
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
                    AppTextField(label: 'MEDICAL COUNCIL', controller: councilCtrl, hintText: 'e.g. Tamil Nadu Medical Council'),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(label: 'COUNCIL REGISTRATION NUMBER', controller: regNoCtrl, hintText: 'e.g. TNMC/98234'),
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
                      onPressed: () async {
                        final qualChanged = qualCtrl.text.trim() != _qualifications;
                        final nameChanged = nameCtrl.text.trim() != _fullName;
                        final cities = hubsCtrl.text.trim().split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
                        Navigator.pop(ctx);
                        try {
                          await DoctorRepository.saveProfile(
                            fullName: nameCtrl.text.trim(),
                            council: councilCtrl.text.trim(),
                            registrationNo: regNoCtrl.text.trim(),
                            qualification: qualCtrl.text.trim(),
                            primarySpecialty: selectedSpec,
                            preferredCities: cities.isNotEmpty ? cities : [''],
                            yearsOfExperience: int.tryParse(expCtrl.text.trim()) ?? _experienceYears,
                            bio: bioCtrl.text.trim(),
                          );
                          if (mounted) {
                            setState(() {
                              _fullName = nameCtrl.text.trim();
                              _council = councilCtrl.text.trim();
                              _registrationNo = regNoCtrl.text.trim();
                              _qualifications = qualCtrl.text.trim();
                              _primarySpecialty = selectedSpec;
                              _experienceYears = int.tryParse(expCtrl.text.trim()) ?? _experienceYears;
                              _preferredHubs = hubsCtrl.text.trim();
                              _bio = bioCtrl.text.trim();
                              if (qualChanged || nameChanged) _isVerified = false;
                            });
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                backgroundColor: qualChanged || nameChanged ? AppColors.amber : AppColors.emerald,
                                content: Text(qualChanged || nameChanged
                                    ? 'Credential change detected. Re-verification required.'
                                    : 'Doctor profile updated successfully.'),
                              ),
                            );
                          }
                        } catch (_) {
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(backgroundColor: AppColors.rose, content: Text('Could not save profile. Try again.')),
                            );
                          }
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

              // My Duties — real assignments from Firestore
              StreamBuilder<List<Map<String, dynamic>>>(
                stream: DoctorRepository.watchAssignments(),
                builder: (context, snap) {
                  final assignments = snap.data ?? [];
                  if (assignments.isEmpty) return const SizedBox.shrink();
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('My Assignments', style: AppTypography.headingSmall(colors.textPrimary)),
                      const SizedBox(height: AppSpacing.xs),
                      ...assignments.take(3).map((asg) => Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: AppCard(
                          child: Row(
                            children: [
                              Container(
                                width: 40, height: 40,
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                                ),
                                child: const Icon(Icons.local_hospital_rounded, color: AppColors.primary, size: 20),
                              ),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(asg['facilityName'] as String, style: AppTypography.labelBold(colors.textPrimary), overflow: TextOverflow.ellipsis),
                                    const SizedBox(height: 2),
                                    Text('${asg['specialtyName']} • ${asg['startAt']}', style: AppTypography.bodySmall(colors.textMuted), overflow: TextOverflow.ellipsis),
                                  ],
                                ),
                              ),
                              StatusBadge(status: asg['status'] as String),
                            ],
                          ),
                        ),
                      )),
                      const SizedBox(height: AppSpacing.xs),
                    ],
                  );
                },
              ),

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
                                  'My Hospital / Clinic',
                                  style: AppTypography.labelBold(colors.textPrimary),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (false) ...[
                                const SizedBox(width: 4),
                                const Icon(Icons.verified_rounded, color: AppColors.emerald, size: 16),
                              ],
                            ],
                          ),
                          Text(
                            '',
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
                      count: _reviewCount,
                      onTap: () => _openDoctorReviews(context),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: _buildReviewLinkCard(
                      title: 'Hospital Reviews',
                      rating: 0.0,
                      count: 0,
                      onTap: () => context.push('/reviews', extra: {
                        'title': 'Hospital Reviews',
                        'reviews': <Map<String, dynamic>>[],
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
                      onTap: () async {
                        await AuthRepository().signOut();
                        if (context.mounted) context.go('/login');
                      },
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
