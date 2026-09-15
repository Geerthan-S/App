/**
 * Doctor Verification Center Screen
 * Hybrid Verification Architecture & Official Council Match Interface
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';
import '../domain/verification_models.dart';
import '../data/verification_repository.dart';

class VerificationCenterScreen extends ConsumerStatefulWidget {
  const VerificationCenterScreen({super.key});

  @override
  ConsumerState<VerificationCenterScreen> createState() => _VerificationCenterScreenState();
}

class _VerificationCenterScreenState extends ConsumerState<VerificationCenterScreen> {
  final _repo = VerificationRepository();
  final _regNoController = TextEditingController(text: 'TNMC_98234');
  final _nameController = TextEditingController(text: 'Dr. Aravind Swaminathan');
  final _qualificationController = TextEditingController(text: 'MBBS, MD');
  String _selectedCouncil = AppConstants.medicalCouncils[1]; // Tamil Nadu Medical Council

  String _caseStatus = 'under_review';
  bool _isChecking = false;
  bool _isUploading = false;
  VerificationResult? _lastResult;

  final List<Map<String, dynamic>> _uploadedDocuments = [
    {
      'fileName': 'Medical_Registration_Cert.pdf',
      'size': '2.4 MB',
      'uploadedAt': '06 Sep 2026',
      'vaultPath': 'verification/doctor/doc_123/case_abc/Medical_Registration_Cert.pdf',
    },
  ];

  Future<void> _runVerificationCheck() async {
    final regNo = _regNoController.text.trim();
    if (regNo.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a valid Registration Number.')),
      );
      return;
    }

    setState(() => _isChecking = true);

    try {
      final result = await _repo.verifyRegistration(
        caseId: 'case_current_doctor',
        council: _selectedCouncil,
        registrationNumber: regNo,
        fullName: _nameController.text.trim(),
        qualification: _qualificationController.text.trim(),
      );

      if (mounted) {
        setState(() {
          _isChecking = false;
          _lastResult = result;
          _caseStatus = result.caseStatus;
        });

        final message = result.outcome == 'MATCH'
            ? 'Official match verified! Profile fast-tracked to verified status.'
            : (result.outcome == 'MISMATCH'
                ? 'Discrepancy detected. Case routed to human verifier queue.'
                : 'Registration not found in registry. Supporting documents required.');

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: result.outcome == 'MATCH' ? AppColors.emerald : AppColors.amber,
            content: Text(message),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _isChecking = false);
      }
    }
  }

  Future<void> _uploadEvidenceDocument() async {
    setState(() => _isUploading = true);
    final uploaded = await _repo.pickAndUploadEvidence(
      caseId: 'case_current_doctor',
      doctorUid: 'doc_current_user',
    );

    if (mounted) {
      setState(() {
        _isUploading = false;
        if (uploaded != null) {
          _uploadedDocuments.add({
            'fileName': uploaded['fileName'] ?? 'Document.pdf',
            'size': '${((uploaded['size'] as int? ?? 1024) / 1024).round()} KB',
            'uploadedAt': 'Just now',
            'vaultPath': uploaded['storagePath'] ?? 'private_vault',
          });
        }
      });

      if (uploaded != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.emerald,
            content: Text('Document securely uploaded to private vault for verifier review.'),
          ),
        );
      }
    }
  }

  void _showAppealDialog() {
    final appealController = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surfaceLight,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusMd)),
        title: Text('Submit Verification Appeal', style: AppTypography.headingSmall(AppColors.textLightPrimary)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'If your council registration details were recently renewed or updated, explain the situation below for human reviewer consideration.',
              style: AppTypography.bodySmall(AppColors.textLightSecondary),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: appealController,
              maxLines: 4,
              style: AppTypography.bodyMedium(AppColors.textLightPrimary),
              decoration: const InputDecoration(
                hintText: 'Enter reason for appeal or updated council circular reference...',
                filled: true,
                fillColor: AppColors.surfaceElevatedLight,
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: AppColors.textLightMuted)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary),
            onPressed: () {
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  backgroundColor: AppColors.primary,
                  content: Text('Appeal submitted with immutable audit reference.'),
                ),
              );
            },
            child: const Text('Submit Appeal'),
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
        title: Text(loc.translate('verificationCenter')),
        actions: [
          IconButton(
            icon: const Icon(Icons.language_rounded),
            tooltip: 'Language Navigation',
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
              // Case Status Header Card
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          loc.translate('verificationStatus'),
                          style: AppTypography.headingSmall(AppColors.textLightPrimary),
                        ),
                        StatusBadge(status: _caseStatus),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      _caseStatus == 'approved'
                          ? 'Your medical council registration is officially verified via authoritative registry check. You have unrestricted access to all marketplace duties.'
                          : (_caseStatus == 'needs_information'
                              ? 'Your registration was not found in the automated index. Please upload certificate proof for verifier inspection.'
                              : 'Your registration proof is currently undergoing verification against the official council register.'),
                      style: AppTypography.bodyMedium(AppColors.textLightSecondary),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              // Interactive Verification Input Form
              Text(
                'Registration Credentials & Authority',
                style: AppTypography.headingSmall(AppColors.textLightPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('MEDICAL COUNCIL', style: AppTypography.labelBold(AppColors.textLightSecondary)),
                    const SizedBox(height: 6),
                    DropdownButtonFormField<String>(
                      value: _selectedCouncil,
                      isExpanded: true,
                      dropdownColor: AppColors.surfaceElevatedLight,
                      style: AppTypography.bodyLarge(AppColors.textLightPrimary),
                      decoration: InputDecoration(
                        filled: true,
                        fillColor: AppColors.surfaceElevatedLight,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                          borderSide: const BorderSide(color: AppColors.borderLight),
                        ),
                      ),
                      items: AppConstants.medicalCouncils
                          .map((c) => DropdownMenuItem(value: c, child: Text(c, overflow: TextOverflow.ellipsis)))
                          .toList(),
                      onChanged: (val) => setState(() => _selectedCouncil = val!),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'REGISTRATION NUMBER',
                      controller: _regNoController,
                      hintText: 'e.g. TNMC_98234 or KMC_45678',
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'DOCTOR REGISTERED NAME',
                      controller: _nameController,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'PRIMARY QUALIFICATION',
                      controller: _qualificationController,
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    AppButton(
                      label: 'Run Authoritative Council Verification',
                      isLoading: _isChecking,
                      icon: Icons.verified_user_rounded,
                      onPressed: _runVerificationCheck,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              // Side-by-Side Comparison Card
              if (_lastResult != null) ...[
                Text(
                  'Authoritative Comparison Engine',
                  style: AppTypography.headingSmall(AppColors.textLightPrimary),
                ),
                const SizedBox(height: AppSpacing.xs),
                AppCard(
                  borderColor: _lastResult!.outcome == 'MATCH'
                      ? AppColors.emerald.withOpacity(0.5)
                      : (_lastResult!.outcome == 'MISMATCH'
                          ? AppColors.amber.withOpacity(0.5)
                          : AppColors.rose.withOpacity(0.5)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              Icon(
                                _lastResult!.outcome == 'MATCH'
                                    ? Icons.check_circle_rounded
                                    : (_lastResult!.outcome == 'MISMATCH'
                                        ? Icons.warning_amber_rounded
                                        : Icons.error_outline_rounded),
                                color: _lastResult!.outcome == 'MATCH'
                                    ? AppColors.emerald
                                    : (_lastResult!.outcome == 'MISMATCH' ? AppColors.amber : AppColors.rose),
                                size: 22,
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'Outcome: ${_lastResult!.outcome}',
                                style: AppTypography.labelBold(
                                  _lastResult!.outcome == 'MATCH'
                                      ? AppColors.emerald
                                      : (_lastResult!.outcome == 'MISMATCH' ? AppColors.amber : AppColors.rose),
                                ),
                              ),
                            ],
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceLight,
                              borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
                            ),
                            child: Text(
                              'Confidence ${_lastResult!.confidenceScore}%',
                              style: AppTypography.bodySmall(AppColors.textLightMuted),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      if (_lastResult!.discrepancySummary != null)
                        Container(
                          padding: const EdgeInsets.all(10),
                          margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                          decoration: BoxDecoration(
                            color: AppColors.amber.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                            border: Border.all(color: AppColors.amber.withOpacity(0.3)),
                          ),
                          child: Text(
                            '⚠️ ${_lastResult!.discrepancySummary}',
                            style: AppTypography.bodySmall(AppColors.amber),
                          ),
                        ),
                      const Divider(),
                      ..._lastResult!.fieldComparisons.map((cmp) {
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Row(
                            children: [
                              Icon(
                                cmp.isMatch ? Icons.check_rounded : Icons.close_rounded,
                                color: cmp.isMatch ? AppColors.emerald : AppColors.rose,
                                size: 16,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                flex: 2,
                                child: Text(cmp.field, style: AppTypography.bodySmall(AppColors.textLightMuted)),
                              ),
                              Expanded(
                                flex: 3,
                                child: Text(cmp.submitted, style: AppTypography.bodySmall(AppColors.textLightPrimary)),
                              ),
                              Expanded(
                                flex: 3,
                                child: Text(cmp.official, style: AppTypography.bodySmall(AppColors.primaryLight)),
                              ),
                            ],
                          ),
                        );
                      }),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
              ],

              // Private Evidence Documents Vault
              Text(
                'Private Evidence Vault (Zero Public Access)',
                style: AppTypography.headingSmall(AppColors.textLightPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _uploadedDocuments.length,
                separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.xs),
                itemBuilder: (context, index) {
                  final doc = _uploadedDocuments[index];
                  return AppCard(
                    child: Row(
                      children: [
                        const Icon(Icons.description_outlined, color: AppColors.primary, size: 28),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(doc['fileName'] as String, style: AppTypography.labelBold(AppColors.textLightPrimary)),
                              Text('${doc['size']} • Stored in private vault', style: AppTypography.bodySmall(AppColors.textLightMuted)),
                            ],
                          ),
                        ),
                        const Icon(Icons.lock_rounded, color: AppColors.emerald, size: 18),
                      ],
                    ),
                  );
                },
              ),
              const SizedBox(height: AppSpacing.md),
              AppButton(
                label: 'Upload Registration Certificate (PDF / Image)',
                isLoading: _isUploading,
                icon: Icons.upload_file_rounded,
                backgroundColor: AppColors.surfaceElevatedLight,
                onPressed: _uploadEvidenceDocument,
              ),
              const SizedBox(height: AppSpacing.md),

              // Appeal & Human Review Section
              Center(
                child: TextButton.icon(
                  icon: const Icon(Icons.support_agent_rounded, size: 18, color: AppColors.primaryLight),
                  label: const Text(
                    'Discrepancy in Council Records? Submit an Appeal',
                    style: TextStyle(color: AppColors.primaryLight, fontWeight: FontWeight.bold),
                  ),
                  onPressed: _showAppealDialog,
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
