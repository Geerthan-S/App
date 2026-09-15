/**
 * Hospital Profile & Facility Management Screen
 * Manages legal entity details, facilities with GPS coordinates, establishment licenses, and verifications.
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';

class HospitalProfileScreen extends ConsumerStatefulWidget {
  const HospitalProfileScreen({super.key});

  @override
  ConsumerState<HospitalProfileScreen> createState() => _HospitalProfileScreenState();
}

class _HospitalProfileScreenState extends ConsumerState<HospitalProfileScreen> {
  final String _legalName = 'Apollo Hospitals Enterprise Ltd';
  final String _displayName = 'Apollo Specialty Hospital';
  final String _orgType = 'Tertiary Care Multispecialty';
  final String _regNumber = 'TN_HOSP_REG_2018_981';
  final String _address = '21 Greams Lane, Thousand Lights, Chennai, TN 600006';
  final String _repName = 'Dr. Ramesh Nathan (Medical Superintendent)';
  final String _contactPhone = '+91 44 2829 0200';
  final String _verificationStatus = 'approved';

  final List<Map<String, dynamic>> _facilities = [
    {
      'facilityId': 'fac_chennai_main',
      'name': 'Apollo Main Hospital - Greams Road',
      'address': '21 Greams Lane, Thousand Lights, Chennai',
      'lat': 13.0604,
      'lng': 80.2496,
      'deskPhone': '+91 44 2829 0200',
      'status': 'active',
    },
    {
      'facilityId': 'fac_chennai_omr',
      'name': 'Apollo Specialty Hospital - OMR Perungudi',
      'address': '05/639 Old Mahabalipuram Rd, Chennai',
      'lat': 12.9644,
      'lng': 80.2464,
      'deskPhone': '+91 44 3322 1100',
      'status': 'active',
    },
  ];

  final List<String> _licenses = [
    'Clinical_Establishment_License_2026.pdf (4.1 MB)',
    'Pollution_Control_Board_NOC.pdf (1.8 MB)',
  ];

  bool _isUploading = false;

  Future<void> _uploadLicense() async {
    setState(() => _isUploading = true);
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'png', 'jpg'],
    );

    if (mounted) {
      setState(() {
        _isUploading = false;
        if (result != null && result.files.isNotEmpty) {
          _licenses.add('${result.files.first.name} (${((result.files.first.size) / 1024).round()} KB)');
        }
      });

      if (result != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.emerald,
            content: Text('Establishment license uploaded to private vault for verifier inspection.'),
          ),
        );
      }
    }
  }

  void _showAddFacilityDialog() {
    final nameCtrl = TextEditingController();
    final addrCtrl = TextEditingController();
    final latCtrl = TextEditingController(text: '13.0827');
    final lngCtrl = TextEditingController(text: '80.2707');
    final phoneCtrl = TextEditingController(text: '+91 44 ');

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surfaceLight,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusMd)),
        title: Text('Register New Facility', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppTextField(label: 'FACILITY / BRANCH NAME', controller: nameCtrl, hintText: 'e.g. Apollo Day Surgery Centre'),
              const SizedBox(height: AppSpacing.sm),
              AppTextField(label: 'STREET ADDRESS', controller: addrCtrl),
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  Expanded(child: AppTextField(label: 'LATITUDE', controller: latCtrl, keyboardType: TextInputType.number)),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(child: AppTextField(label: 'LONGITUDE', controller: lngCtrl, keyboardType: TextInputType.number)),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              AppTextField(label: 'DUTY DESK PHONE', controller: phoneCtrl, keyboardType: TextInputType.phone),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: AppColors.textLightMuted)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.emerald),
            onPressed: () {
              if (nameCtrl.text.trim().isNotEmpty) {
                setState(() {
                  _facilities.add({
                    'facilityId': 'fac_${DateTime.now().millisecondsSinceEpoch}',
                    'name': nameCtrl.text.trim(),
                    'address': addrCtrl.text.trim(),
                    'lat': double.tryParse(latCtrl.text.trim()) ?? 13.0827,
                    'lng': double.tryParse(lngCtrl.text.trim()) ?? 80.2707,
                    'deskPhone': phoneCtrl.text.trim(),
                    'status': 'active',
                  });
                });
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    backgroundColor: AppColors.emerald,
                    content: Text('Hospital facility branch registered with GPS coordinates.'),
                  ),
                );
              }
            },
            child: const Text('Add Facility'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final loc = ref.watch(localizationProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Hospital Organization'),
        actions: [
          IconButton(
            icon: const Icon(Icons.language_rounded),
            onPressed: () => LanguageSelectorDialog.show(context),
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
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(_displayName, style: AppTypography.headingMedium(AppColors.textLightPrimary)),
                              Text(_legalName, style: AppTypography.bodySmall(AppColors.textLightMuted)),
                            ],
                          ),
                        ),
                        StatusBadge(status: _verificationStatus),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _buildRow('Org Type', _orgType),
                    const Divider(),
                    _buildRow('Registration ID', _regNumber),
                    const Divider(),
                    _buildRow('Primary Desk Line', _contactPhone),
                    const Divider(),
                    _buildRow('Authorized Rep', _repName),
                    const Divider(),
                    _buildRow('Corporate Address', _address),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              // Facilities Management
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Registered Facilities (${_facilities.length})', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
                  IconButton(
                    icon: const Icon(Icons.add_location_alt_rounded, color: AppColors.primaryLight),
                    tooltip: 'Add Facility',
                    onPressed: _showAddFacilityDialog,
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _facilities.length,
                separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                itemBuilder: (context, index) {
                  final fac = _facilities[index];
                  return AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(fac['name'] as String, style: AppTypography.labelBold(AppColors.textLightPrimary)),
                            const Icon(Icons.check_circle_rounded, color: AppColors.emerald, size: 16),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(fac['address'] as String, style: AppTypography.bodySmall(AppColors.textLightSecondary)),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            const Icon(Icons.gps_fixed_rounded, size: 14, color: AppColors.primaryLight),
                            const SizedBox(width: 4),
                            Text('${fac['lat']}, ${fac['lng']}', style: AppTypography.bodySmall(AppColors.textLightMuted)),
                            const Spacer(),
                            Text(fac['deskPhone'] as String, style: AppTypography.bodySmall(AppColors.textLightSecondary)),
                          ],
                        ),
                      ],
                    ),
                  );
                },
              ),
              const SizedBox(height: AppSpacing.lg),

              // Establishment Licenses & Verification Proof
              Text('Establishment Evidence (Private Vault)', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Column(
                  children: [
                    ..._licenses.map((lic) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        children: [
                          const Icon(Icons.file_present_rounded, color: AppColors.primaryLight, size: 22),
                          const SizedBox(width: 8),
                          Expanded(child: Text(lic, style: AppTypography.bodyMedium(AppColors.textLightPrimary))),
                          const Icon(Icons.lock_rounded, color: AppColors.emerald, size: 16),
                        ],
                      ),
                    )),
                    const SizedBox(height: AppSpacing.sm),
                    AppButton(
                      label: 'Upload Hospital Establishment License',
                      isLoading: _isUploading,
                      icon: Icons.upload_file_rounded,
                      backgroundColor: AppColors.surfaceElevatedLight,
                      onPressed: _uploadLicense,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: AppTypography.bodySmall(AppColors.textLightMuted)),
          const SizedBox(width: 16),
          Expanded(
            child: Text(value, textAlign: TextAlign.right, style: AppTypography.bodySmall(AppColors.textLightPrimary)),
          ),
        ],
      ),
    );
  }
}
