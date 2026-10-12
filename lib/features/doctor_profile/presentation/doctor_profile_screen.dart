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
import '../../../core/widgets/ui_kit.dart';
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

  String get _initials {
    final parts = _fullName.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return 'Dr';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
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
          Text(title, style: AppTypography.bodySmall(colors.textSecondary)),
          const SizedBox(height: 6),
          Row(
            children: [
              const Icon(Icons.star_rounded, color: AppColors.amber, size: 18),
              const SizedBox(width: 4),
              Text(rating.toStringAsFixed(1), style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(width: 4),
              Text('($count)', style: AppTypography.bodySmall(colors.textMuted)),
              const Spacer(),
              Icon(Icons.chevron_right_outlined, color: colors.textMuted, size: 18),
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
            IconTile(
              icon: icon,
              size: 38,
              iconColor: color ?? colors.textSecondary,
              background: color != null ? color.withValues(alpha: 0.08) : null,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(label, style: AppTypography.bodyLarge(color ?? colors.textPrimary).copyWith(fontSize: 14)),
            ),
            Icon(Icons.chevron_right_outlined, color: colors.textMuted, size: 20),
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

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Padding(
              padding: EdgeInsets.only(
                left: AppSpacing.gutter,
                right: AppSpacing.gutter,
                top: 0,
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
                          icon: Icon(Icons.close_outlined, color: colors.textMuted),
                          onPressed: () => Navigator.pop(ctx),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),

                    // Re-verification warning alert
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.amber.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.info_outline, color: AppColors.amber, size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Important: Modifying your registered name or primary qualifications will reset your verified status and trigger an automated re-verification check.',
                              style: AppTypography.bodySmall(colors.textPrimary),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    AppTextField(label: 'Full name', controller: nameCtrl),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(label: 'Medical council', controller: councilCtrl, hintText: 'e.g. Tamil Nadu Medical Council'),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(label: 'Council registration number', controller: regNoCtrl, hintText: 'e.g. TNMC/98234'),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(label: 'Qualifications', controller: qualCtrl),
                    const SizedBox(height: AppSpacing.md),
                    Text('Primary specialty', style: AppTypography.labelBold(colors.textSecondary)),
                    const SizedBox(height: 6),
                    DropdownButtonFormField<String>(
                      value: selectedSpec,
                      dropdownColor: colors.surface,
                      borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                      icon: Icon(Icons.expand_more_outlined, color: colors.textMuted),
                      style: AppTypography.bodyLarge(colors.textPrimary).copyWith(fontSize: 14),
                      decoration: const InputDecoration(),
                      items: AppConstants.specialties.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                      onChanged: (val) => setSheetState(() => selectedSpec = val!),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'Years of clinical experience',
                      controller: expCtrl,
                      keyboardType: TextInputType.number,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'Preferred work hubs',
                      controller: hubsCtrl,
                      hintText: 'e.g. Chennai, Bengaluru',
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'Professional bio',
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
    final statusColor = _isVerified ? AppColors.emerald : AppColors.amber;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        centerTitle: false,
        toolbarHeight: 64,
        titleSpacing: AppSpacing.gutter,
        titleTextStyle: AppTypography.headingLarge(colors.textPrimary),
        title: Text(loc.translate('profile')),
        actions: [
          IconButton(
            icon: const Icon(Icons.translate_outlined),
            tooltip: 'Language Navigation',
            onPressed: () => LanguageSelectorDialog.show(context),
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Settings',
            onPressed: () => context.push('/settings'),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(
        bottom: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, AppSpacing.navBarClearance),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Doctor Header Card
              AppCard(
                padding: const EdgeInsets.all(AppSpacing.lg - 4),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: colors.accentSoft,
                            shape: BoxShape.circle,
                            border: Border.all(color: colors.surface, width: 3),
                            boxShadow: AppShadows.subtle(colors),
                          ),
                          child: Text(_initials, style: AppTypography.headingMedium(colors.accent)),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                      _fullName,
                                      overflow: TextOverflow.ellipsis,
                                      style: AppTypography.headingMedium(colors.textPrimary),
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Icon(
                                    _isVerified ? Icons.verified_outlined : Icons.pending_outlined,
                                    color: statusColor,
                                    size: 18,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(_qualifications, style: AppTypography.bodyMedium(colors.accent).copyWith(fontWeight: FontWeight.w500)),
                              Text('$_experienceYears Years Clinical Experience', style: AppTypography.bodySmall(colors.textSecondary)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.md),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.edit_outlined, size: 16),
                        label: const Text('Edit Profile & Bio'),
                        style: OutlinedButton.styleFrom(foregroundColor: colors.accent),
                        onPressed: _showEditProfileSheet,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Quick Stats
              Row(
                children: [
                  Expanded(child: StatTile(icon: Icons.work_history_outlined, value: '$_experienceYears yrs', label: 'Experience')),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(child: StatTile(icon: Icons.medical_services_outlined, value: '${_specialtyChips.length + 1}', label: 'Specialties')),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(child: StatTile(icon: Icons.star_outline_outlined, value: _doctorRating.toStringAsFixed(1), label: 'Rating')),
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
                          style: AppTypography.labelBold(colors.accent),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
                      child: LinearProgressIndicator(
                        value: _profileCompletion,
                        minHeight: 6,
                        backgroundColor: colors.surfaceElevated,
                        valueColor: AlwaysStoppedAnimation<Color>(colors.accent),
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
                    IconTile(
                      icon: _isVerified ? Icons.verified_user_outlined : Icons.gpp_maybe_outlined,
                      iconColor: statusColor,
                      background: statusColor.withValues(alpha: 0.1),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Medical Council Verification', style: AppTypography.headingSmall(colors.textPrimary).copyWith(fontSize: 14)),
                          const SizedBox(height: 2),
                          Text(
                            _isVerified
                                ? 'Tamil Nadu Medical Council • Verified'
                                : 'Pending Council Review / Re-verification',
                            style: AppTypography.bodySmall(statusColor).copyWith(fontWeight: FontWeight.w500),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.chevron_right_outlined, color: colors.textMuted, size: 20),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.section),

              // Clinical Bio
              const SectionHeader(title: 'Professional Summary'),
              const SizedBox(height: AppSpacing.sm),
              AppCard(
                child: SizedBox(
                  width: double.infinity,
                  child: Text(
                    _bio.isEmpty ? 'Add a short professional bio from Edit Profile.' : _bio,
                    style: AppTypography.bodyMedium(_bio.isEmpty ? colors.textMuted : colors.textSecondary),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.section),

              // Specialty Areas
              const SectionHeader(title: 'Clinical Specialties'),
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  InfoChip(icon: Icons.medical_services_outlined, label: _primarySpecialty, color: colors.accent),
                  ..._specialtyChips.map(
                    (specialty) => InfoChip(icon: Icons.local_offer_outlined, label: specialty),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.section),

              // Preferred Hubs
              const SectionHeader(title: 'Preferred Work Hubs'),
              const SizedBox(height: AppSpacing.sm),
              AppCard(
                child: Row(
                  children: [
                    const IconTile(icon: Icons.location_on_outlined, size: 38),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        _preferredHubs.isEmpty ? '—' : _preferredHubs,
                        style: AppTypography.bodyLarge(colors.textPrimary).copyWith(fontSize: 14),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.section),

              // My Duties — real assignments from Firestore
              StreamBuilder<List<Map<String, dynamic>>>(
                stream: DoctorRepository.watchAssignments(),
                builder: (context, snap) {
                  final assignments = snap.data ?? [];
                  if (assignments.isEmpty) return const SizedBox.shrink();
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SectionHeader(
                        title: 'My Assignments',
                        actionLabel: 'View all',
                        onAction: () => context.go('/messages'),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      ...assignments.take(3).map((asg) => Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: AppCard(
                          child: Row(
                            children: [
                              const IconTile(icon: Icons.local_hospital_outlined, size: 40),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(asg['facilityName'] as String, style: AppTypography.headingSmall(colors.textPrimary).copyWith(fontSize: 14), overflow: TextOverflow.ellipsis),
                                    const SizedBox(height: 2),
                                    Text('${asg['specialtyName']} • ${asg['startAt']}', style: AppTypography.bodySmall(colors.textSecondary), overflow: TextOverflow.ellipsis),
                                  ],
                                ),
                              ),
                              const SizedBox(width: AppSpacing.xs),
                              StatusBadge(status: asg['status'] as String),
                            ],
                          ),
                        ),
                      )),
                      const SizedBox(height: AppSpacing.section - AppSpacing.sm),
                    ],
                  );
                },
              ),

              // Hospital / Clinic
              const SectionHeader(title: 'Hospital / Clinic'),
              const SizedBox(height: AppSpacing.sm),
              AppCard(
                onTap: () => context.push('/hospital-info'),
                child: Row(
                  children: [
                    const IconTile(icon: Icons.local_hospital_outlined),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Text(
                        'My Hospital / Clinic',
                        style: AppTypography.headingSmall(colors.textPrimary).copyWith(fontSize: 14),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Icon(Icons.chevron_right_outlined, color: colors.textMuted, size: 20),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.section),

              // Reviews
              const SectionHeader(title: 'Reviews'),
              const SizedBox(height: AppSpacing.sm),
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
              const SizedBox(height: AppSpacing.section),

              // Account
              const SectionHeader(title: 'Account'),
              const SizedBox(height: AppSpacing.sm),
              AppCard(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 4),
                child: Column(
                  children: [
                    _buildAccountTile(
                      icon: Icons.settings_outlined,
                      label: 'Settings',
                      onTap: () => context.push('/settings'),
                    ),
                    const Divider(),
                    _buildAccountTile(
                      icon: Icons.logout_outlined,
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
            ],
          ),
        ),
      ),
    );
  }
}
