/**
 * Doctor Applications & Offers Screen
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/status_badge.dart';

class ApplicationsScreen extends ConsumerStatefulWidget {
  const ApplicationsScreen({super.key});

  @override
  ConsumerState<ApplicationsScreen> createState() => _ApplicationsScreenState();
}

class _ApplicationsScreenState extends ConsumerState<ApplicationsScreen> {
  final List<Map<String, dynamic>> _applications = [
    {
      'applicationId': 'app_301',
      'dutyId': 'duty_chennai_gm_01',
      'facilityName': 'Apollo Specialty Hospital',
      'specialtyName': 'General Medicine',
      'appliedAt': '2 hours ago',
      'status': 'selected',
      'isOffer': true,
      'amount': 6500,
      'timing': 'Tomorrow, 08:00 AM - 04:00 PM',
    },
    {
      'applicationId': 'app_302',
      'dutyId': 'duty_blr_er_02',
      'facilityName': 'Fortis Hospital - Bannerghatta',
      'specialtyName': 'Emergency & Critical Care',
      'appliedAt': 'Yesterday',
      'status': 'shortlisted',
      'isOffer': false,
      'amount': 9000,
      'timing': '18 Sep, 08:00 PM - 08:00 AM',
    }
  ];

  void _confirmOffer(String appId) {
    setState(() {
      final item = _applications.firstWhere((a) => a['applicationId'] == appId);
      item['status'] = 'confirmed';
      item['isOffer'] = false;
    });

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        backgroundColor: AppColors.emerald,
        content: Text('Duty confirmed! Contact details have been granted.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Applications & Offers'),
      ),
      body: SafeArea(
        child: ListView.separated(
          padding: AppSpacing.paddingScreen,
          itemCount: _applications.length,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
          itemBuilder: (context, index) {
            final app = _applications[index];
            final isOffer = app['isOffer'] == true;

            return AppCard(
              borderColor: isOffer ? AppColors.amber : null,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        app['facilityName'] as String,
                        style: AppTypography.headingSmall(AppColors.textDarkPrimary),
                      ),
                      StatusBadge(status: app['status'] as String),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${app['specialtyName']} • Applied ${app['appliedAt']}',
                    style: AppTypography.bodySmall(AppColors.textDarkMuted),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    app['timing'] as String,
                    style: AppTypography.bodyMedium(AppColors.textDarkSecondary),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '₹${app['amount']} per shift',
                    style: AppTypography.labelBold(AppColors.emerald),
                  ),
                  if (isOffer) ...[
                    const SizedBox(height: AppSpacing.md),
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.sm),
                      decoration: BoxDecoration(
                        color: AppColors.amber.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                        border: Border.all(color: AppColors.amber.withOpacity(0.3)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.timer_outlined, size: 16, color: AppColors.amber),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Hospital has selected you! Offer expires in 11 hrs 45 mins.',
                              style: AppTypography.bodySmall(AppColors.amber),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    AppButton(
                      label: 'Accept & Confirm Duty',
                      backgroundColor: AppColors.emerald,
                      onPressed: () => _confirmOffer(app['applicationId'] as String),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
