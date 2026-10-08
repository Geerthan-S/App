import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';
import '../data/hospital_repository.dart';
import '../../../core/errors/error_envelope.dart';

class HospitalDashboardScreen extends ConsumerStatefulWidget {
  const HospitalDashboardScreen({super.key});

  @override
  ConsumerState<HospitalDashboardScreen> createState() => _HospitalDashboardScreenState();
}

class _HospitalDashboardScreenState extends ConsumerState<HospitalDashboardScreen> {
  List<Map<String, dynamic>> _organizations = [];
  String? _selectedOrgId;
  String _selectedOrgName = '';
  bool _loadingOrgs = true;

  @override
  void initState() {
    super.initState();
    _loadOrgs();
  }

  Future<void> _loadOrgs() async {
    try {
      final result = await FirebaseFunctions.instance
          .httpsCallable('getMyOrganizations')
          .call<Map<String, dynamic>>();
      final orgs = (result.data['organizations'] as List<dynamic>? ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      if (mounted) {
        setState(() {
          _organizations = orgs;
          if (orgs.isNotEmpty) {
            _selectedOrgId = orgs.first['organizationId'] as String?;
            _selectedOrgName = orgs.first['displayName'] as String? ??
                orgs.first['legalName'] as String? ?? 'My Organization';
          }
          _loadingOrgs = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingOrgs = false);
    }
  }

  Future<void> _showApplicantsSheet(String dutyId) async {
    final colors = context.appColors;
    List<Map<String, dynamic>> applicants = [];
    bool loading = true;
    bool requested = false;
    bool loadFailed = false;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: colors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpacing.radiusLg)),
      ),
      builder: (ctx) {
        return StatefulBuilder(builder: (context, setSheet) {
          if (loading && !requested) {
            requested = true;
            HospitalRepository.getApplicationsForDuty(dutyId).then((apps) {
              setSheet(() {
                applicants = apps;
                loading = false;
              });
            }).catchError((Object _) {
              setSheet(() {
                loadFailed = true;
                loading = false;
              });
            });
          }
          return Padding(
            padding: AppSpacing.paddingScreen,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Review Applicants', style: AppTypography.headingSmall(colors.textPrimary)),
                    IconButton(
                      icon: Icon(Icons.close_rounded, color: colors.textMuted),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
                Text(
                  'Selecting a candidate atomically reserves a seat and sends a time-limited offer.',
                  style: AppTypography.bodySmall(colors.textMuted),
                ),
                const SizedBox(height: AppSpacing.md),
                if (loading)
                  const Center(child: CircularProgressIndicator())
                else if (loadFailed)
                  Text('Could not load applicants. Close and try again.', style: AppTypography.bodyMedium(AppColors.rose))
                else if (applicants.isEmpty)
                  Text('No applicants yet.', style: AppTypography.bodyMedium(colors.textMuted))
                else
                  ...applicants.map((app) => AppCard(
                        margin: const EdgeInsets.only(bottom: 12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                CircleAvatar(
                                  radius: 22,
                                  backgroundColor: AppColors.primary,
                                  child: Text(
                                    (app['name'] as String).split(' ').last.substring(0, 1),
                                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                                  ),
                                ),
                                const SizedBox(width: AppSpacing.sm),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(children: [
                                        Text(app['name'] as String, style: AppTypography.labelBold(colors.textPrimary)),
                                        const SizedBox(width: 4),
                                        if (app['isVerified'] == true)
                                          const Icon(Icons.verified_rounded, color: AppColors.emerald, size: 14),
                                      ]),
                                      Text('${app['regNo']} • ${app['qualification']}',
                                          style: AppTypography.bodySmall(colors.textMuted)),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            if ((app['note'] as String).isNotEmpty) ...[
                              const SizedBox(height: AppSpacing.sm),
                              Text('"${app['note']}"', style: AppTypography.bodySmall(colors.textSecondary)),
                            ],
                            const SizedBox(height: AppSpacing.sm),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                ElevatedButton(
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: AppColors.emerald,
                                    foregroundColor: Colors.white,
                                  ),
                                  onPressed: () async {
                                    Navigator.pop(ctx);
                                    await _selectDoctor(dutyId, app['doctorId'] as String, app['name'] as String);
                                  },
                                  child: const Text('Select Candidate'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      )),
                const SizedBox(height: AppSpacing.md),
              ],
            ),
          );
        });
      },
    );
  }

  Future<void> _selectDoctor(String dutyId, String doctorId, String doctorName) async {
    try {
      await HospitalRepository.selectDoctor(dutyId, doctorId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.emerald,
            content: Text('Offer sent to $doctorName. It expires if not confirmed in time.'),
          ),
        );
      }
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        final msg = e.domainCode == 'DUTY_CAPACITY_FILLED'
            ? 'Duty is already fully filled.'
            : e.message ?? 'Selection failed. Try again.';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(backgroundColor: AppColors.rose, content: Text(msg)),
        );
      }
    }
  }

  void _showReviewModal(Map<String, dynamic> assignment) {
    final commentCtrl = TextEditingController();
    int selectedRating = 0;
    bool submitting = false;
    final colors = context.appColors;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: colors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpacing.radiusLg)),
      ),
      builder: (ctx) => StatefulBuilder(builder: (context, setSheet) {
        return Padding(
          padding: EdgeInsets.only(
            left: 16, right: 16, top: 20,
            bottom: MediaQuery.of(context).viewInsets.bottom + 20,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Review Doctor', style: AppTypography.headingSmall(colors.textPrimary)),
                const SizedBox(height: 4),
                Text(
                  'Rate ${assignment['doctorName']} for their duty at ${assignment['facilityName']}',
                  style: AppTypography.bodySmall(colors.textMuted),
                ),
                const SizedBox(height: AppSpacing.md),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(5, (i) => IconButton(
                    icon: Icon(
                      i < selectedRating ? Icons.star_rounded : Icons.star_border_rounded,
                      color: AppColors.amber,
                      size: 36,
                    ),
                    onPressed: () => setSheet(() => selectedRating = i + 1),
                  )),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: commentCtrl,
                  maxLines: 3,
                  maxLength: 500,
                  decoration: InputDecoration(
                    hintText: 'Share your experience with this doctor...',
                    hintStyle: AppTypography.bodyMedium(colors.textMuted),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusSm)),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                AppButton(
                  label: 'Submit Review',
                  isLoading: submitting,
                  onPressed: selectedRating > 0
                      ? () async {
                          if (commentCtrl.text.trim().isEmpty) return;
                          setSheet(() => submitting = true);
                          try {
                            await FirebaseFunctions.instance.httpsCallable('submitFeedback').call({
                              'targetId': assignment['doctorId'],
                              'targetType': 'doctor',
                              'assignmentId': assignment['assignmentId'],
                              'rating': selectedRating,
                              'comment': commentCtrl.text.trim(),
                            });
                            if (ctx.mounted) Navigator.pop(ctx);
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  backgroundColor: AppColors.emerald,
                                  content: Text('Review submitted successfully.'),
                                ),
                              );
                            }
                          } catch (_) {
                            setSheet(() => submitting = false);
                            if (ctx.mounted) {
                              ScaffoldMessenger.of(ctx).showSnackBar(
                                const SnackBar(
                                  backgroundColor: AppColors.rose,
                                  content: Text('Could not submit review. Try again.'),
                                ),
                              );
                            }
                          }
                        }
                      : null,
                ),
              ],
            ),
          ),
        );
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final loc = ref.watch(localizationProvider);

    if (_loadingOrgs) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    if (_selectedOrgId == null) {
      return Scaffold(
        appBar: AppBar(title: Text(loc.translate('hospitalOperations'))),
        body: const EmptyStateView(
          icon: Icons.apartment_rounded,
          title: 'No organization found',
          description: 'Set up your hospital organization to start posting duties.',
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.translate('hospitalOperations')),
        actions: [
          IconButton(
            icon: const Icon(Icons.language_rounded),
            onPressed: () => LanguageSelectorDialog.show(context),
          ),
          IconButton(
            icon: const Icon(Icons.local_hospital_outlined),
            tooltip: 'Hospital Profile & Facilities',
            onPressed: () => context.push('/hospital-profile'),
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
              // Org selector if multiple
              if (_organizations.length > 1)
                DropdownButtonFormField<String>(
                  value: _selectedOrgId,
                  decoration: InputDecoration(
                    labelText: 'Organization',
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusSm)),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                  items: _organizations
                      .map((o) => DropdownMenuItem<String>(
                            value: o['organizationId'] as String,
                            child: Text(o['displayName'] as String? ?? o['legalName'] as String? ?? ''),
                          ))
                      .toList(),
                  onChanged: (v) => setState(() {
                    _selectedOrgId = v;
                    final org = _organizations.firstWhere((o) => o['organizationId'] == v, orElse: () => {});
                    _selectedOrgName = org['displayName'] as String? ?? org['legalName'] as String? ?? '';
                  }),
                )
              else
                AppCard(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(_selectedOrgName, style: AppTypography.headingSmall(colors.textPrimary)),
                            Text('Verified Organization', style: AppTypography.bodySmall(colors.textMuted)),
                          ],
                        ),
                      ),
                      OutlinedButton.icon(
                        icon: const Icon(Icons.apartment_rounded, size: 16),
                        label: const Text('Manage'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.primaryLight,
                          side: BorderSide(color: colors.border),
                        ),
                        onPressed: () => context.push('/hospital-profile'),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: AppSpacing.lg),

              AppButton(
                label: loc.translate('postDuty'),
                icon: Icons.add_circle_outline_rounded,
                onPressed: () => context.push('/create-duty'),
              ),
              const SizedBox(height: AppSpacing.lg),

              // Active duties
              Text(loc.translate('activeDuties'), style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.sm),
              StreamBuilder<List<Map<String, dynamic>>>(
                stream: HospitalRepository.watchOrgDuties(_selectedOrgId!),
                builder: (context, snap) {
                  if (snap.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final duties = snap.data ?? [];
                  if (duties.isEmpty) {
                    return AppCard(
                      child: Text('No duties posted yet.', style: AppTypography.bodyMedium(colors.textMuted)),
                    );
                  }
                  return ListView.separated(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: duties.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final duty = duties[i];
                      return AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(duty['specialtyName'] as String,
                                      style: AppTypography.headingSmall(colors.textPrimary)),
                                ),
                                StatusBadge(status: duty['status'] as String),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(duty['department'] as String, style: AppTypography.bodySmall(colors.textMuted)),
                            const SizedBox(height: AppSpacing.xs),
                            Text(duty['timing'] as String, style: AppTypography.bodyMedium(colors.textSecondary)),
                            const SizedBox(height: AppSpacing.sm),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text('${duty['remainingHeadcount']} slot open',
                                    style: AppTypography.bodySmall(AppColors.amber)),
                                OutlinedButton.icon(
                                  icon: const Icon(Icons.people_outline_rounded, size: 16),
                                  label: Text(loc.translate('reviewApplicants')),
                                  style: OutlinedButton.styleFrom(
                                    side: BorderSide(color: colors.border),
                                    foregroundColor: AppColors.primaryLight,
                                  ),
                                  onPressed: () => _showApplicantsSheet(duty['dutyId'] as String),
                                ),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                  );
                },
              ),
              const SizedBox(height: AppSpacing.lg),

              // Completed assignments — review doctors
              Text('Completed Assignments', style: AppTypography.headingSmall(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              Text('Leave a review for doctors after their shift ends.',
                  style: AppTypography.bodySmall(colors.textMuted)),
              const SizedBox(height: AppSpacing.sm),
              StreamBuilder<List<Map<String, dynamic>>>(
                stream: HospitalRepository.watchOrgAssignments(_selectedOrgId!),
                builder: (context, snap) {
                  final all = snap.data ?? [];
                  final completed = all.where((a) => a['status'] == 'completed').toList();
                  if (completed.isEmpty) {
                    return AppCard(
                      child: Text('No completed assignments yet.', style: AppTypography.bodyMedium(colors.textMuted)),
                    );
                  }
                  return ListView.separated(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: completed.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final asg = completed[i];
                      return AppCard(
                        child: Row(
                          children: [
                            CircleAvatar(
                              backgroundColor: AppColors.emerald.withValues(alpha: 0.15),
                              child: const Icon(Icons.check_circle_rounded, color: AppColors.emerald),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(asg['doctorName'] as String, style: AppTypography.labelBold(colors.textPrimary)),
                                  Text('${asg['specialtyName']} • ${asg['startAt']}',
                                      style: AppTypography.bodySmall(colors.textMuted)),
                                ],
                              ),
                            ),
                            OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppColors.primaryLight,
                                side: BorderSide(color: colors.border),
                              ),
                              onPressed: () => _showReviewModal(asg),
                              child: const Text('Review'),
                            ),
                          ],
                        ),
                      );
                    },
                  );
                },
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}
