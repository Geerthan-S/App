/**
 * Doctor Verification Center Screen
 * Hybrid Verification Architecture & Official Council Match Interface
 */

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
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
  ConsumerState<VerificationCenterScreen> createState() =>
      _VerificationCenterScreenState();
}

class _VerificationCenterScreenState
    extends ConsumerState<VerificationCenterScreen> {
  final _repo = VerificationRepository();
  final _regNoController = TextEditingController();
  final _nameController = TextEditingController();
  final _qualificationController = TextEditingController();
  String _selectedCouncil =
      AppConstants.medicalCouncils[1]; // Tamil Nadu Medical Council

  String _caseStatus = 'loading';
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _caseSubscription;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _evidenceSubscription;
  bool _isChecking = false;
  bool _isSubmitting = false;
  bool _isUploading = false;
  VerificationResult? _lastResult;

  final List<Map<String, dynamic>> _uploadedDocuments = [];

  Future<void> _submitCase() async {
    setState(() => _isSubmitting = true);
    try {
      await _repo.submitCurrentCase();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Case submitted for verifier review.')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not submit this case. Complete your profile and try again.')),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  void initState() {
    super.initState();
    _loadPersistedCaseStatus();
  }

  Future<void> _loadPersistedCaseStatus() async {
    try {
      final caseId = await _repo.currentDoctorCaseId();
      if (!mounted) return;
      _caseSubscription = FirebaseFirestore.instance
          .collection('verificationCases')
          .doc(caseId)
          .snapshots()
          .listen((snapshot) {
            if (!mounted) return;
            final status = snapshot.data()?['status'] as String?;
            setState(() => _caseStatus = status ?? 'not_started');
          }, onError: (_) {
            if (mounted) setState(() => _caseStatus = 'unavailable');
          });
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid != null) {
        _evidenceSubscription = FirebaseFirestore.instance
            .collection('verificationDocuments')
            .where('uploadedBy', isEqualTo: uid)
            .limit(50)
            .snapshots()
            .listen((snapshot) {
              if (!mounted) return;
              final records = snapshot.docs
                  .where((doc) => doc.data()['caseId'] == caseId)
                  .map((doc) {
                    final data = doc.data();
                    return <String, dynamic>{
                      'fileName': 'Evidence ${doc.id.substring(0, 8)}',
                      'size': '${((data['sizeBytes'] as num? ?? 0) / 1024).round()} KB',
                      'scanStatus': data['scanStatus'] ?? 'pending',
                    };
                  })
                  .toList();
              setState(() {
                _uploadedDocuments
                  ..clear()
                  ..addAll(records);
              });
            });
      }
    } catch (_) {
      if (mounted) setState(() => _caseStatus = 'not_started');
    }
  }

  @override
  void dispose() {
    _caseSubscription?.cancel();
    _evidenceSubscription?.cancel();
    _regNoController.dispose();
    _nameController.dispose();
    _qualificationController.dispose();
    super.dispose();
  }

  Future<void> _runVerificationCheck() async {
    final regNo = _regNoController.text.trim();
    if (regNo.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter a valid Registration Number.'),
        ),
      );
      return;
    }

    setState(() => _isChecking = true);

    try {
      final result = await _repo.verifyRegistration(
        caseId: await _repo.currentDoctorCaseId(),
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

        final message = result.outcome == 'SOURCE_UNAVAILABLE'
            ? 'Official registry access is unavailable. Your case awaits manual review.'
            : 'Your registration check was recorded for reviewer assessment.';

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.amber,
            content: Text(message),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _isChecking = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Verification could not be completed. Complete onboarding and try again.',
            ),
          ),
        );
      }
    }
  }

  Future<void> _uploadEvidenceDocument() async {
    setState(() => _isUploading = true);
    try {
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid == null) throw StateError('Sign in first.');
      final uploaded = await _repo.pickAndUploadEvidence(
        caseId: await _repo.currentDoctorCaseId(),
        doctorUid: uid,
      );

      if (mounted) {
        setState(() {
          _isUploading = false;
        });

        if (uploaded != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              backgroundColor: AppColors.emerald,
              content: Text('Document uploaded. Security screening is pending.'),
            ),
          );
        }
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Upload failed. Check your connection and complete onboarding before retrying.',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
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
                          style: AppTypography.headingSmall(colors.textPrimary),
                        ),
                        StatusBadge(status: _caseStatus),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      _caseStatus == 'approved'
                          ? 'An authorized reviewer approved this verification case.'
                          : _caseStatus == 'needs_information'
                              ? 'A reviewer needs more information. Please upload the requested proof.'
                              : _caseStatus == 'under_review'
                                  ? 'Your case is waiting for an authorized reviewer to check the official source.'
                                  : _caseStatus == 'loading'
                                      ? 'Loading your current verification case.'
                                      : _caseStatus == 'unavailable'
                                          ? 'Verification status is temporarily unavailable. Please try again.'
                                          : 'Complete your doctor profile and submit your evidence for review.',
                      style: AppTypography.bodyMedium(colors.textSecondary),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              // Interactive Verification Input Form
              Text(
                'Registration Credentials & Authority',
                style: AppTypography.headingSmall(colors.textPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'MEDICAL COUNCIL',
                      style: AppTypography.labelBold(colors.textSecondary),
                    ),
                    const SizedBox(height: 6),
                    DropdownButtonFormField<String>(
                      value: _selectedCouncil,
                      isExpanded: true,
                      dropdownColor: colors.surfaceElevated,
                      style: AppTypography.bodyLarge(colors.textPrimary),
                      decoration: InputDecoration(
                        filled: true,
                        fillColor: colors.surfaceElevated,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(
                            AppSpacing.radiusSm,
                          ),
                          borderSide: BorderSide(color: colors.border),
                        ),
                      ),
                      items: AppConstants.medicalCouncils
                          .map(
                            (c) => DropdownMenuItem(
                              value: c,
                              child: Text(c, overflow: TextOverflow.ellipsis),
                            ),
                          )
                          .toList(),
                      onChanged: (val) =>
                          setState(() => _selectedCouncil = val!),
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
                    if (_caseStatus == 'draft' || _caseStatus == 'needs_information') ...[
                      AppButton(
                        label: 'Submit Case for Review',
                        isLoading: _isSubmitting,
                        icon: Icons.send_rounded,
                        onPressed: _submitCase,
                      ),
                      const SizedBox(height: AppSpacing.md),
                    ],
                    AppButton(
                      label: 'Request Registration Review',
                      isLoading: _isChecking,
                      icon: Icons.verified_user_rounded,
                      onPressed: ['submitted', 'under_review', 'needs_information'].contains(_caseStatus)
                          ? _runVerificationCheck
                          : null,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              // Side-by-Side Comparison Card
              if (_lastResult != null) ...[
                Text(
                'Verification Review Result',
                  style: AppTypography.headingSmall(colors.textPrimary),
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
                                    : (_lastResult!.outcome == 'MISMATCH'
                                          ? AppColors.amber
                                          : AppColors.rose),
                                size: 22,
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'Outcome: ${_lastResult!.outcome}',
                                style: AppTypography.labelBold(
                                  _lastResult!.outcome == 'MATCH'
                                      ? AppColors.emerald
                                      : (_lastResult!.outcome == 'MISMATCH'
                                            ? AppColors.amber
                                            : AppColors.rose),
                                ),
                              ),
                            ],
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: colors.surface,
                              borderRadius: BorderRadius.circular(
                                AppSpacing.radiusPill,
                              ),
                            ),
                            child: Text(
                              'Confidence ${_lastResult!.confidenceScore}%',
                              style: AppTypography.bodySmall(colors.textMuted),
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
                            borderRadius: BorderRadius.circular(
                              AppSpacing.radiusSm,
                            ),
                            border: Border.all(
                              color: AppColors.amber.withOpacity(0.3),
                            ),
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
                                cmp.isMatch
                                    ? Icons.check_rounded
                                    : Icons.close_rounded,
                                color: cmp.isMatch
                                    ? AppColors.emerald
                                    : AppColors.rose,
                                size: 16,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                flex: 2,
                                child: Text(
                                  cmp.field,
                                  style: AppTypography.bodySmall(
                                    colors.textMuted,
                                  ),
                                ),
                              ),
                              Expanded(
                                flex: 3,
                                child: Text(
                                  cmp.submitted,
                                  style: AppTypography.bodySmall(
                                    colors.textPrimary,
                                  ),
                                ),
                              ),
                              Expanded(
                                flex: 3,
                                child: Text(
                                  cmp.official,
                                  style: AppTypography.bodySmall(
                                    AppColors.primaryLight,
                                  ),
                                ),
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
                style: AppTypography.headingSmall(colors.textPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _uploadedDocuments.length,
                separatorBuilder: (_, __) =>
                    const SizedBox(height: AppSpacing.xs),
                itemBuilder: (context, index) {
                  final doc = _uploadedDocuments[index];
                  return AppCard(
                    child: Row(
                      children: [
                        const Icon(
                          Icons.description_outlined,
                          color: AppColors.primary,
                          size: 28,
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                doc['fileName'] as String,
                                style: AppTypography.labelBold(
                                  colors.textPrimary,
                                ),
                              ),
                              Text(
                                '${doc['size']} • Screening: ${doc['scanStatus']}',
                                style: AppTypography.bodySmall(
                                  colors.textMuted,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Icon(
                          Icons.lock_rounded,
                          color: AppColors.emerald,
                          size: 18,
                        ),
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
                backgroundColor: colors.surfaceElevated,
                onPressed: _uploadEvidenceDocument,
              ),
              const SizedBox(height: AppSpacing.md),

              // Appeal & Human Review Section
              Center(
                child: TextButton.icon(
                  icon: const Icon(
                    Icons.support_agent_rounded,
                    size: 18,
                    color: AppColors.primaryLight,
                  ),
                  label: const Text(
                    'Appeals will be available after manual review setup',
                    style: TextStyle(
                      color: AppColors.primaryLight,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  onPressed: null,
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
