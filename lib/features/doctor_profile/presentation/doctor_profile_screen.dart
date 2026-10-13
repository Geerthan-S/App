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
  ConsumerState<DoctorProfileScreen> createState() =>
      _DoctorProfileScreenState();
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
      _primarySpecialty =
          profile['primarySpecialty'] as String? ??
          AppConstants.specialties.first;
      _experienceYears = (profile['yearsOfExperience'] as num?)?.toInt() ?? 0;
      final cities = profile['preferredCities'];
      _preferredHubs = cities is List
          ? (cities as List).join(', ')
          : (cities as String? ?? '');
      _bio = profile['bio'] as String? ?? '';
      _isVerified = profile['isVerified'] == true;
      final specialties = profile['specialties'];
      if (specialties is List) {
        _specialtyChips = specialties
            .cast<String>()
            .where((s) => s != _primarySpecialty)
            .toList();
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
          final total = reviews.fold<num>(
            0,
            (s, r) => s + (r['rating'] as num),
          );
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

  Future<void> _openDoctorReviews(BuildContext context) async {
    final uid = _uid;
    if (uid == null) return;
    final reviews = await DoctorRepository.watchReviews(uid).first;
    if (!mounted) return;
    context.push(
      '/reviews',
      extra: {'title': 'Doctor Reviews', 'reviews': reviews},
    );
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
      useSafeArea: true,
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
                    SheetHeader(
                      title: 'Edit profile',
                      onClose: () => Navigator.pop(ctx),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // Re-verification warning alert
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.amber.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(
                          AppSpacing.radiusMd,
                        ),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.info_outline,
                            color: AppColors.amber,
                            size: 20,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Important: Modifying your registered name or primary qualifications will reset your verified status and trigger an automated re-verification check.',
                              style: AppTypography.bodySmall(
                                colors.textPrimary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    AppTextField(label: 'Full name', controller: nameCtrl),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'Medical council',
                      controller: councilCtrl,
                      hintText: 'e.g. Tamil Nadu Medical Council',
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'Council registration number',
                      controller: regNoCtrl,
                      hintText: 'e.g. TNMC/98234',
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(label: 'Qualifications', controller: qualCtrl),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      'Primary specialty',
                      style: AppTypography.labelBold(colors.textSecondary),
                    ),
                    const SizedBox(height: 6),
                    DropdownButtonFormField<String>(
                      value: selectedSpec,
                      dropdownColor: colors.surface,
                      borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                      icon: Icon(
                        Icons.expand_more_outlined,
                        color: colors.textMuted,
                      ),
                      style: AppTypography.bodyLarge(
                        colors.textPrimary,
                      ).copyWith(fontSize: 14),
                      decoration: const InputDecoration(),
                      items: AppConstants.specialties
                          .map(
                            (s) => DropdownMenuItem(value: s, child: Text(s)),
                          )
                          .toList(),
                      onChanged: (val) =>
                          setSheetState(() => selectedSpec = val!),
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
                      label: 'Save changes',
                      onPressed: () async {
                        final qualChanged =
                            qualCtrl.text.trim() != _qualifications;
                        final nameChanged = nameCtrl.text.trim() != _fullName;
                        final cities = hubsCtrl.text
                            .trim()
                            .split(',')
                            .map((s) => s.trim())
                            .where((s) => s.isNotEmpty)
                            .toList();
                        Navigator.pop(ctx);
                        try {
                          await DoctorRepository.saveProfile(
                            fullName: nameCtrl.text.trim(),
                            council: councilCtrl.text.trim(),
                            registrationNo: regNoCtrl.text.trim(),
                            qualification: qualCtrl.text.trim(),
                            primarySpecialty: selectedSpec,
                            preferredCities: cities.isNotEmpty ? cities : [''],
                            yearsOfExperience:
                                int.tryParse(expCtrl.text.trim()) ??
                                _experienceYears,
                            bio: bioCtrl.text.trim(),
                          );
                          if (mounted) {
                            setState(() {
                              _fullName = nameCtrl.text.trim();
                              _council = councilCtrl.text.trim();
                              _registrationNo = regNoCtrl.text.trim();
                              _qualifications = qualCtrl.text.trim();
                              _primarySpecialty = selectedSpec;
                              _experienceYears =
                                  int.tryParse(expCtrl.text.trim()) ??
                                  _experienceYears;
                              _preferredHubs = hubsCtrl.text.trim();
                              _bio = bioCtrl.text.trim();
                              if (qualChanged || nameChanged) {
                                _isVerified = false;
                              }
                            });
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                backgroundColor: qualChanged || nameChanged
                                    ? AppColors.amber
                                    : AppColors.emerald,
                                content: Text(
                                  qualChanged || nameChanged
                                      ? 'Credential change detected. Re-verification required.'
                                      : 'Doctor profile updated successfully.',
                                ),
                              ),
                            );
                          }
                        } catch (_) {
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                backgroundColor: AppColors.rose,
                                content: Text(
                                  'Could not save profile. Try again.',
                                ),
                              ),
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
    final completion = (_profileCompletion * 100).round();

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
            tooltip: 'Language',
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
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.gutter,
            8,
            AppSpacing.gutter,
            AppSpacing.navBarClearance,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Identity
              Row(
                children: [
                  InitialsAvatar(name: _fullName, size: 64, fallback: 'Dr'),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                _fullName.isEmpty ? 'Your name' : _fullName,
                                overflow: TextOverflow.ellipsis,
                                style: AppTypography.headingLarge(
                                  colors.textPrimary,
                                ).copyWith(fontSize: 20),
                              ),
                            ),
                            if (_isVerified) ...[
                              const SizedBox(width: 6),
                              const VerifiedMark(size: 17),
                            ],
                          ],
                        ),
                        const SizedBox(height: 2),
                        if (_qualifications.isNotEmpty)
                          Text(
                            _qualifications,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: AppTypography.bodyMedium(
                              colors.textSecondary,
                            ).copyWith(fontSize: 14),
                          ),
                        Text(
                          '$_experienceYears ${_experienceYears == 1 ? 'year' : 'years'} clinical experience',
                          style: AppTypography.bodySmall(colors.textSecondary),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              AppSecondaryButton(
                label: 'Edit profile',
                icon: Icons.edit_outlined,
                onPressed: _showEditProfileSheet,
              ),
              const SizedBox(height: AppSpacing.lg),

              // Verification
              RowGroup(
                children: [
                  ListRow(
                    icon: _isVerified
                        ? Icons.verified_user_outlined
                        : Icons.gpp_maybe_outlined,
                    iconColor: statusColor,
                    title: 'Council verification',
                    subtitle: _isVerified
                        ? '${_council.isEmpty ? 'Medical council' : _council} · Verified'
                        : 'Pending council review / re-verification',
                    onTap: () => context.push('/verification'),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.section),

              // Professional details
              const GroupLabel('Professional details'),
              _Rows(
                children: [
                  if (_council.isNotEmpty)
                    DetailRow(label: 'Council', value: _council),
                  if (_registrationNo.isNotEmpty)
                    DetailRow(
                      label: 'Registration no.',
                      value: _registrationNo,
                    ),
                  DetailRow(
                    label: 'Experience',
                    value: '$_experienceYears yrs',
                  ),
                  DetailRow(
                    label: 'Rating',
                    value: _reviewCount == 0
                        ? 'No reviews yet'
                        : '${_doctorRating.toStringAsFixed(1)} · $_reviewCount ${_reviewCount == 1 ? 'review' : 'reviews'}',
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              Row(
                children: [
                  Text(
                    'Profile completeness',
                    style: AppTypography.bodySmall(colors.textSecondary),
                  ),
                  const Spacer(),
                  Text(
                    '$completion%',
                    style: AppTypography.labelBold(colors.textPrimary),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
                child: LinearProgressIndicator(
                  value: _profileCompletion,
                  minHeight: 4,
                  backgroundColor: colors.surfaceElevated,
                  valueColor: AlwaysStoppedAnimation<Color>(colors.accent),
                ),
              ),
              const SizedBox(height: AppSpacing.section),

              // About
              const GroupLabel('About'),
              Text(
                _bio.isEmpty
                    ? 'Add a short professional bio from Edit profile.'
                    : _bio,
                style: AppTypography.bodyMedium(
                  _bio.isEmpty ? colors.textMuted : colors.textPrimary,
                ).copyWith(fontSize: 14),
              ),
              const SizedBox(height: AppSpacing.section),

              // Specialties
              const GroupLabel('Specialties'),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _PrimaryChip(label: _primarySpecialty),
                  ..._specialtyChips.map(
                    (specialty) => InfoChip(label: specialty),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.section),

              // Work preferences
              const GroupLabel('Work preferences'),
              _Rows(
                children: [
                  DetailRow(
                    label: 'Preferred hubs',
                    value: _preferredHubs.isEmpty ? '—' : _preferredHubs,
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.section),

              // My assignments — real assignments from Firestore
              StreamBuilder<List<Map<String, dynamic>>>(
                stream: DoctorRepository.watchAssignments(),
                builder: (context, snap) {
                  final assignments = snap.data ?? [];
                  if (assignments.isEmpty) return const SizedBox.shrink();
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SectionHeader(
                        title: 'My assignments',
                        actionLabel: 'See all',
                        onAction: () => context.go('/messages'),
                      ),
                      const SizedBox(height: 4),
                      _Rows(
                        children: [
                          for (final asg in assignments.take(3))
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          asg['facilityName'] as String? ?? '—',
                                          style: AppTypography.headingSmall(
                                            colors.textPrimary,
                                          ).copyWith(fontSize: 14),
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          '${asg['specialtyName']} · ${asg['startAt']}',
                                          style: AppTypography.bodySmall(
                                            colors.textSecondary,
                                          ),
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: AppSpacing.sm),
                                  StatusBadge(
                                    status: asg['status'] as String? ?? '',
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.section),
                    ],
                  );
                },
              ),

              // Reviews and workplace
              const GroupLabel('Reviews & workplace'),
              RowGroup(
                children: [
                  ListRow(
                    icon: Icons.star_outline_rounded,
                    title: 'Doctor reviews',
                    subtitle: _reviewCount == 0
                        ? 'No reviews yet'
                        : '${_doctorRating.toStringAsFixed(1)} average · $_reviewCount ${_reviewCount == 1 ? 'review' : 'reviews'}',
                    onTap: () => _openDoctorReviews(context),
                  ),
                  ListRow(
                    icon: Icons.reviews_outlined,
                    title: 'Hospital reviews',
                    onTap: () => context.push(
                      '/reviews',
                      extra: {
                        'title': 'Hospital Reviews',
                        'reviews': <Map<String, dynamic>>[],
                      },
                    ),
                  ),
                  ListRow(
                    icon: Icons.local_hospital_outlined,
                    title: 'My hospital / clinic',
                    onTap: () => context.push('/hospital-info'),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.section),

              // Account
              const GroupLabel('Account'),
              RowGroup(
                children: [
                  ListRow(
                    icon: Icons.settings_outlined,
                    title: 'Settings',
                    onTap: () => context.push('/settings'),
                  ),
                  ListRow(
                    icon: Icons.logout_outlined,
                    title: 'Log out',
                    color: AppColors.rose,
                    trailing: const SizedBox.shrink(),
                    onTap: () async {
                      await AuthRepository().signOut();
                      if (context.mounted) context.go('/login');
                    },
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Label/value rows on the canvas separated by hairline dividers.
class _Rows extends StatelessWidget {
  final List<Widget> children;

  const _Rows({required this.children});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Column(
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) Divider(height: 1, color: colors.border),
          children[i],
        ],
      ],
    );
  }
}

/// Primary specialty: the one filled chip in the specialties list.
class _PrimaryChip extends StatelessWidget {
  final String label;

  const _PrimaryChip({required this.label});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: colors.accent,
        borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
      ),
      child: Text(
        label,
        style: AppTypography.bodySmall(
          colors.onAccent,
        ).copyWith(fontWeight: FontWeight.w600),
      ),
    );
  }
}
