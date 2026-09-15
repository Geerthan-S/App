/**
 * Hospital Operations Dashboard & Applicant Review Screen
 * Manages active duties, applicant review, atomic doctor selection, 12-hour expiry timer, and contact release.
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';

class HospitalDashboardScreen extends ConsumerStatefulWidget {
  const HospitalDashboardScreen({super.key});

  @override
  ConsumerState<HospitalDashboardScreen> createState() => _HospitalDashboardScreenState();
}

class _HospitalDashboardScreenState extends ConsumerState<HospitalDashboardScreen> {
  final List<Map<String, dynamic>> _hospitalDuties = [
    {
      'dutyId': 'duty_hosp_01',
      'specialtyName': 'General Medicine',
      'department': 'ICU & Emergency',
      'timing': 'Tomorrow, 08:00 AM - 04:00 PM',
      'headcount': 2,
      'remainingHeadcount': 1,
      'status': 'published',
      'applicantsCount': 2,
    },
    {
      'dutyId': 'duty_hosp_02',
      'specialtyName': 'Anesthesiology',
      'department': 'Main Operation Theatre',
      'timing': '19 Sep, 09:00 AM - 05:00 PM',
      'headcount': 1,
      'remainingHeadcount': 1,
      'status': 'published',
      'applicantsCount': 1,
    },
  ];

  Map<String, dynamic>? _selectedAssignment;

  void _showApplicantsSheet(String dutyId) {
    final List<Map<String, dynamic>> applicants = [
      {
        'doctorId': 'doc_aravind_01',
        'name': 'Dr. Aravind Swaminathan',
        'regNo': 'TNMC_98234',
        'council': 'Tamil Nadu Medical Council',
        'qualification': 'MBBS, MD (General Medicine)',
        'qualificationMatch': '100% Match',
        'experience': '5 years ICU / Casualty',
        'note': 'Available immediately for the emergency triage desk. Familiar with Apollo protocols.',
        'isVerified': true,
      },
      {
        'doctorId': 'doc_priya_02',
        'name': 'Dr. Priya Sharma',
        'regNo': 'KMC_45678',
        'council': 'Karnataka Medical Council',
        'qualification': 'MBBS, DA',
        'qualificationMatch': 'Eligible',
        'experience': '3 years Emergency Medicine',
        'note': 'Experienced with acute adult resuscitation and trauma care.',
        'isVerified': true,
      },
    ];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surfaceLight,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpacing.radiusLg)),
      ),
      builder: (ctx) {
        return Padding(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Review Verified Applicants', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, color: AppColors.textLightMuted),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Atomic selection locks duty headcount and dispatches an offer with a 12-hour expiry timer.',
                style: AppTypography.bodySmall(AppColors.textLightMuted),
              ),
              const SizedBox(height: AppSpacing.md),

              ...applicants.map((app) {
                return AppCard(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              color: AppColors.primary,
                              borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
                            ),
                            child: Center(
                              child: Text(
                                app['name'].toString().split(' ').last.substring(0, 1),
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                              ),
                            ),
                          ),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(app['name'] as String, style: AppTypography.labelBold(AppColors.textLightPrimary)),
                                    const SizedBox(width: 4),
                                    const Icon(Icons.verified_rounded, color: AppColors.emerald, size: 14),
                                  ],
                                ),
                                Text('${app['regNo']} • ${app['experience']}', style: AppTypography.bodySmall(AppColors.textLightMuted)),
                              ],
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: AppColors.emerald.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
                            ),
                            child: Text(
                              app['qualificationMatch'] as String,
                              style: AppTypography.bodySmall(AppColors.emerald),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceLight,
                          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                        ),
                        child: Text(
                          '"${app['note']}"',
                          style: AppTypography.bodySmall(AppColors.textLightSecondary),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton(
                            onPressed: () {
                              Navigator.pop(ctx);
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('Applicant shortlisted for duty.')),
                              );
                            },
                            child: const Text('Shortlist', style: TextStyle(color: AppColors.textLightMuted)),
                          ),
                          const SizedBox(width: 8),
                          ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.emerald,
                              foregroundColor: Colors.white,
                            ),
                            onPressed: () {
                              Navigator.pop(ctx);
                              _atomicSelectDoctor(dutyId, app);
                            },
                            child: const Text('Select Candidate'),
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              }),
            ],
          ),
        );
      },
    );
  }

  void _atomicSelectDoctor(String dutyId, Map<String, dynamic> doctor) {
    setState(() {
      _selectedAssignment = {
        'dutyId': dutyId,
        'doctorId': doctor['doctorId'],
        'doctorName': doctor['name'],
        'regNo': doctor['regNo'],
        'phone': '+91 98765 43210', // Tokenized contact release
        'status': 'selected',
        'expiresAt': DateTime.now().add(const Duration(hours: AppConstants.defaultOfferExpiryHours)),
        'amount': 6500,
        'selectedAt': DateTime.now(),
      };
    });

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        backgroundColor: AppColors.emerald,
        content: Text('Candidate selected atomically! 12-hour offer timer active and notification sent.'),
      ),
    );
  }

  void _cancelOffer() {
    setState(() {
      _selectedAssignment = null;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        backgroundColor: AppColors.rose,
        content: Text('Assignment offer cancelled. Duty slot capacity restored.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final loc = ref.watch(localizationProvider);

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
              // Organization Header
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Apollo Specialty Hospital', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
                        const StatusBadge(status: 'approved'),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text('Thousand Lights, Chennai • Verified Establishment', style: AppTypography.bodySmall(AppColors.textLightMuted)),
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton.icon(
                      icon: const Icon(Icons.apartment_rounded, size: 16),
                      label: const Text('Manage Organization & Facilities'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.primaryLight,
                        side: const BorderSide(color: AppColors.borderLight),
                      ),
                      onPressed: () => context.push('/hospital-profile'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              // Post Duty Button
              AppButton(
                label: loc.translate('postDuty'),
                icon: Icons.add_circle_outline_rounded,
                onPressed: () => context.push('/create-duty'),
              ),
              const SizedBox(height: AppSpacing.lg),

              // Active Assignment / Selected Doctor Card (with 12-Hour Expiry Timer)
              if (_selectedAssignment != null) ...[
                Text('Active Selection & Expiry Countdown', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
                const SizedBox(height: AppSpacing.xs),
                AppCard(
                  borderColor: AppColors.emerald.withOpacity(0.5),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.timer_outlined, color: AppColors.amber, size: 20),
                              const SizedBox(width: 6),
                              Text('Offer Expiry: 11h 59m remaining', style: AppTypography.labelBold(AppColors.amber)),
                            ],
                          ),
                          const StatusBadge(status: 'selected'),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Text(_selectedAssignment!['doctorName'] as String, style: AppTypography.headingSmall(AppColors.textLightPrimary)),
                      Text('${_selectedAssignment!['regNo']} • General Medicine', style: AppTypography.bodySmall(AppColors.textLightMuted)),
                      const Divider(),

                      // Released Contact (Tokenized Access)
                      Row(
                        children: [
                          const Icon(Icons.phone_in_talk_rounded, color: AppColors.emerald, size: 16),
                          const SizedBox(width: 6),
                          Text(
                            'Released Contact: ${_selectedAssignment!['phone']}',
                            style: AppTypography.labelBold(AppColors.emerald),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text('Contact released under active selection grant. Direct duty coordination enabled.', style: AppTypography.bodySmall(AppColors.textLightMuted)),
                      const SizedBox(height: AppSpacing.md),

                      OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.rose,
                          side: const BorderSide(color: AppColors.rose),
                        ),
                        onPressed: _cancelOffer,
                        child: const Text('Cancel Offer Before Acceptance'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
              ],

              // Active Requirements
              Text(loc.translate('activeDuties'), style: AppTypography.headingSmall(AppColors.textLightPrimary)),
              const SizedBox(height: AppSpacing.sm),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _hospitalDuties.length,
                separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                itemBuilder: (context, index) {
                  final duty = _hospitalDuties[index];
                  return AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(duty['specialtyName'] as String, style: AppTypography.headingSmall(AppColors.textLightPrimary)),
                            StatusBadge(status: duty['status'] as String),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(duty['department'] as String, style: AppTypography.bodySmall(AppColors.textLightMuted)),
                        const SizedBox(height: AppSpacing.sm),
                        Text(duty['timing'] as String, style: AppTypography.bodyMedium(AppColors.textLightSecondary)),
                        const SizedBox(height: AppSpacing.sm),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('${duty['remainingHeadcount']} slot open', style: AppTypography.bodySmall(AppColors.amber)),
                            OutlinedButton.icon(
                              icon: const Icon(Icons.people_outline_rounded, size: 16),
                              label: Text('${loc.translate('reviewApplicants')} (${duty['applicantsCount']})'),
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: AppColors.borderLight),
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
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}
