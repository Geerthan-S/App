/**
 * Doctor Verification Center Screen
 *
 * The doctor uploads registration proof into the private evidence vault, then
 * sends the case to verifiers. The registration details shown here come from
 * the stored doctor profile, which is what the server reviews.
 */

import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';
import '../../doctor_profile/data/doctor_repository.dart';
import '../data/verification_repository.dart';
import '../../settings/data/account_repository.dart' show callableErrorMessage;

class VerificationCenterScreen extends ConsumerStatefulWidget {
  const VerificationCenterScreen({super.key});

  @override
  ConsumerState<VerificationCenterScreen> createState() =>
      _VerificationCenterScreenState();
}

/// Case states in which the doctor can add evidence and send the case.
const _openCaseStatuses = ['draft', 'needs_information'];

class _VerificationCenterScreenState
    extends ConsumerState<VerificationCenterScreen> {
  final _repo = VerificationRepository();

  Map<String, dynamic>? _profile;
  String? _caseId;
  String _caseStatus = 'loading';
  /// Why the case could not be loaded, shown with a retry instead of a silent "Not started".
  String? _loadError;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _caseSubscription;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>?
  _evidenceSubscription;
  /// The most recent rejected case (the current one, or the one a fresh draft
  /// follows), which the doctor may appeal.
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _rejectedSubscription;
  String? _rejectedCaseId;
  Map<String, dynamic>? _rejectedCase;
  bool _isAppealing = false;
  bool _isSubmitting = false;
  bool _isUploading = false;

  /// Indexed evidence records for the current case.
  final List<Map<String, dynamic>> _uploadedDocuments = [];
  /// Files uploaded in this session that the server has not indexed yet.
  final List<Map<String, dynamic>> _pendingUploads = [];

  bool get _isCaseOpen => _caseId != null && _openCaseStatuses.contains(_caseStatus);

  bool get _hasUsableEvidence =>
      _pendingUploads.isNotEmpty ||
      _uploadedDocuments.any((doc) => !['rejected', 'infected'].contains(doc['scanStatus']));

  @override
  void initState() {
    super.initState();
    _loadPersistedCaseStatus();
  }

  void _showSnack(String message, {Color? background}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(backgroundColor: background, content: Text(message)),
    );
  }

  String _errorMessage(Object error, String fallback) =>
      error is StateError ? error.message : callableErrorMessage(error, fallback);

  Future<void> _loadPersistedCaseStatus() async {
    _caseSubscription?.cancel();
    _evidenceSubscription?.cancel();
    setState(() {
      _caseStatus = 'loading';
      _loadError = null;
    });
    try {
      final profile = await DoctorRepository.getProfile();
      if (!mounted) return;
      if (profile == null) {
        setState(() {
          _profile = null;
          _caseId = null;
          _caseStatus = 'not_started';
        });
        return;
      }
      setState(() => _profile = profile);
      final caseId = await _repo.currentDoctorCaseId();
      if (!mounted) return;
      setState(() => _caseId = caseId);
      _caseSubscription = FirebaseFirestore.instance
          .collection('verificationCases')
          .doc(caseId)
          .snapshots()
          .listen(
            (snapshot) {
              if (!mounted) return;
              final data = snapshot.data();
              final status = data?['status'] as String?;
              if (status == 'superseded') {
                // An overturned appeal replaced this draft; follow the new case.
                _loadPersistedCaseStatus();
                return;
              }
              setState(() => _caseStatus = status ?? 'not_started');
              _watchRejectedCase(
                status == 'rejected' ? caseId : (status == 'draft' ? (data?['previousCaseId'] as String?) : null),
              );
            },
            onError: (_) {
              if (mounted) setState(() => _caseStatus = 'unavailable');
            },
          );
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
                      'fileName': data['fileName'] as String? ??
                          'Document ${doc.id.substring(0, 8)}',
                      'size':
                          '${((data['sizeBytes'] as num? ?? 0) / 1024).round()} KB',
                      'scanStatus': data['scanStatus'] ?? 'pending',
                      'objectKey': data['objectKey'],
                    };
                  })
                  .toList();
              final indexed = records.map((r) => r['objectKey']).toSet();
              setState(() {
                _uploadedDocuments
                  ..clear()
                  ..addAll(records);
                _pendingUploads.removeWhere((p) => indexed.contains(p['storagePath']));
              });
            }, onError: (_) {});
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _caseStatus = 'unavailable';
          _loadError = _errorMessage(error, 'Your verification case could not be loaded. Check your connection and try again.');
        });
      }
    }
  }

  void _watchRejectedCase(String? caseId) {
    if (caseId == _rejectedCaseId) return;
    _rejectedSubscription?.cancel();
    _rejectedCaseId = caseId;
    if (caseId == null) {
      setState(() => _rejectedCase = null);
      return;
    }
    _rejectedSubscription = FirebaseFirestore.instance
        .collection('verificationCases')
        .doc(caseId)
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      final data = snap.data();
      setState(() => _rejectedCase = data?['status'] == 'rejected' ? data : null);
    }, onError: (_) {});
  }

  Future<void> _appeal() async {
    final caseId = _rejectedCaseId;
    if (caseId == null) return;
    final statement = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _AppealSheet(),
    );
    if (statement == null || !mounted) return;
    setState(() => _isAppealing = true);
    try {
      await _repo.submitAppeal(caseId: caseId, statement: statement);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Appeal sent. A different verifier will review it.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(callableErrorMessage(e))));
      }
    } finally {
      if (mounted) setState(() => _isAppealing = false);
    }
  }

  Widget _buildAppealSection(AppColorsExtension colors) {
    final rejected = _rejectedCase;
    if (rejected == null) {
      return Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.support_agent_outlined, size: 16, color: colors.textMuted),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              'If a verifier rejects your registration, you can appeal it here within 30 days.',
              style: AppTypography.bodySmall(colors.textSecondary),
            ),
          ),
        ],
      );
    }
    final appeal = rejected['appeal'] as Map<String, dynamic>?;
    final decidedAt = (rejected['decidedAt'] as Timestamp?)?.toDate();
    final windowOpen = decidedAt != null && DateTime.now().difference(decidedAt).inDays < 30;
    final reason = rejected['decisionReason'] as String?;
    final String body;
    if (appeal == null) {
      body = windowOpen
          ? 'Your last verification was rejected${reason == null ? '' : ': $reason'}. '
              'If you think this is wrong, appeal within 30 days and a different verifier will review it.'
          : 'The 30-day appeal window for your last rejection has closed. Submit a new verification instead.';
    } else {
      body = switch (appeal['status']) {
        'pending' => 'Your appeal is with a different verifier. We will notify you of the outcome.',
        'overturned' => 'Your appeal was accepted and your verification is back in review.',
        _ => 'Your appeal was reviewed and the original decision stands. Submit a new verification with corrected details.',
      };
    }
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const Icon(Icons.gavel_outlined, size: 18),
            const SizedBox(width: 8),
            Text('Appeal', style: AppTypography.headingSmall(colors.textPrimary)),
            const Spacer(),
            if (appeal != null)
              StatusBadge(
                status: appeal['status'] as String? ?? 'pending',
                color: appeal['status'] == 'overturned' ? AppColors.emerald : AppColors.rose,
              ),
          ]),
          const SizedBox(height: AppSpacing.xs),
          Text(body, style: AppTypography.bodySmall(colors.textSecondary)),
          if (appeal == null && windowOpen) ...[
            const SizedBox(height: AppSpacing.sm),
            AppSecondaryButton(
              label: 'Appeal this decision',
              icon: Icons.gavel_outlined,
              isLoading: _isAppealing,
              onPressed: _isAppealing ? null : _appeal,
            ),
          ],
        ],
      ),
    );
  }


  @override
  void dispose() {
    _caseSubscription?.cancel();
    _rejectedSubscription?.cancel();
    _evidenceSubscription?.cancel();
    super.dispose();
  }

  Future<void> _requestReview() async {
    final caseId = _caseId;
    if (caseId == null) return;
    setState(() => _isSubmitting = true);
    try {
      await _repo.requestReview(caseId);
      _showSnack('Sent for review. A verifier will check your registration and documents.');
    } catch (error) {
      _showSnack(_errorMessage(error, 'Could not send your case for review. Try again.'));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _uploadEvidenceDocument() async {
    final caseId = _caseId;
    if (caseId == null) return;
    final PlatformFile? file;
    try {
      file = await _repo.pickEvidenceFile();
    } catch (error) {
      _showSnack(_errorMessage(error, 'Could not open that file. Try another one.'));
      return;
    }
    if (file == null || !mounted) return;

    setState(() => _isUploading = true);
    try {
      final uploaded = await _repo.uploadEvidence(caseId: caseId, file: file);
      if (mounted) setState(() => _pendingUploads.add(uploaded));
      _showSnack('Document uploaded to your private vault.', background: AppColors.emerald);
    } catch (error) {
      _showSnack(_errorMessage(error, 'Upload failed. Check your connection and try again.'));
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  String _statusText() {
    if (_loadError != null) return _loadError!;
    if (_caseStatus == 'loading') return 'Loading your current verification case.';
    if (_profile == null) {
      return 'Complete your doctor profile first. Verification reviews the registration details saved there.';
    }
    return switch (_caseStatus) {
      'approved' => 'An authorized reviewer approved this verification case.',
      'needs_information' => 'A reviewer needs more information. Upload the requested proof and send the case again.',
      'submitted' || 'under_review' => 'Your case is with a verifier, who will check your registration against the official council register.',
      'rejected' => 'Your last verification was rejected. See the appeal section below.',
      'unavailable' => 'Verification status is temporarily unavailable. Please try again.',
      _ => 'Upload your registration certificate, then request a review.',
    };
  }

  static String _scanLabel(String status) => switch (status) {
        'clean' => 'Screened',
        'rejected' => 'Rejected, upload a valid PDF or image',
        'infected' => 'Rejected by security screening',
        _ => 'Received, awaiting screening',
      };

  Widget _detailRow(AppColorsExtension colors, String label, String? value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label, style: AppTypography.bodySmall(colors.textMuted)),
          ),
          Expanded(
            child: Text(
              (value == null || value.isEmpty) ? '—' : value,
              style: AppTypography.bodyMedium(colors.textPrimary),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final loc = ref.watch(localizationProvider);
    final profile = _profile;
    final documents = [
      ..._uploadedDocuments,
      ..._pendingUploads.map((p) => {
            'fileName': p['fileName'],
            'size': '${((p['size'] as num? ?? 0) / 1024).round()} KB',
            'scanStatus': 'pending',
          }),
    ];
    final canRequestReview = _isCaseOpen && _hasUsableEvidence;

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.translate('verificationCenter')),
        actions: [
          IconButton(
            icon: const Icon(Icons.translate_outlined),
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
                      _statusText(),
                      style: AppTypography.bodyMedium(colors.textSecondary),
                    ),
                    if (_loadError != null || _caseStatus == 'unavailable') ...[
                      const SizedBox(height: AppSpacing.sm),
                      AppSecondaryButton(
                        label: 'Try again',
                        icon: Icons.refresh_outlined,
                        onPressed: _loadPersistedCaseStatus,
                      ),
                    ],
                    if (profile == null && _caseStatus == 'not_started') ...[
                      const SizedBox(height: AppSpacing.sm),
                      AppButton(
                        label: 'Complete doctor profile',
                        icon: Icons.person_outline,
                        onPressed: () async {
                          await context.push('/doctor-onboarding');
                          if (mounted) _loadPersistedCaseStatus();
                        },
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),

              if (profile != null) ...[
                Text(
                  'Registration Credentials & Authority',
                  style: AppTypography.headingSmall(colors.textPrimary),
                ),
                const SizedBox(height: AppSpacing.xs),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _detailRow(colors, 'Medical council', profile['council'] as String?),
                      _detailRow(colors, 'Registration no.', profile['registrationNo'] as String?),
                      _detailRow(colors, 'Registered name', profile['fullName'] as String?),
                      _detailRow(colors, 'Qualification', profile['qualification'] as String?),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        'These come from your doctor profile. Edit your profile to change them.',
                        style: AppTypography.bodySmall(colors.textMuted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),

                // Private Evidence Documents Vault
                Text(
                  'Private Evidence Vault (Zero Public Access)',
                  style: AppTypography.headingSmall(colors.textPrimary),
                ),
                const SizedBox(height: AppSpacing.xs),
                ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: documents.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: AppSpacing.xs),
                  itemBuilder: (context, index) {
                    final doc = documents[index];
                    return AppCard(
                      child: Row(
                        children: [
                          Icon(
                            Icons.description_outlined,
                            color: colors.textSecondary,
                            size: 24,
                          ),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  doc['fileName'] as String,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppTypography.labelBold(
                                    colors.textPrimary,
                                  ),
                                ),
                                Text(
                                  '${doc['size']} • ${_scanLabel(doc['scanStatus'] as String)}',
                                  style: AppTypography.bodySmall(
                                    colors.textMuted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const Icon(
                            Icons.lock_outlined,
                            color: AppColors.emerald,
                            size: 18,
                          ),
                        ],
                      ),
                    );
                  },
                ),
                if (documents.isNotEmpty) const SizedBox(height: AppSpacing.md),
                AppSecondaryButton(
                  label: 'Upload Registration Certificate (PDF / Image)',
                  isLoading: _isUploading,
                  icon: Icons.upload_file_outlined,
                  foregroundColor: colors.accent,
                  onPressed: _isCaseOpen ? _uploadEvidenceDocument : null,
                ),
                const SizedBox(height: AppSpacing.md),
                AppButton(
                  label: 'Request Registration Review',
                  isLoading: _isSubmitting,
                  icon: Icons.verified_user_outlined,
                  onPressed: canRequestReview ? _requestReview : null,
                ),
                if (_isCaseOpen && !_hasUsableEvidence) ...[
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Upload your registration certificate to request a review.',
                    style: AppTypography.bodySmall(colors.textMuted),
                  ),
                ],
                const SizedBox(height: AppSpacing.lg),
              ],

              // Appeal & Human Review Section
              _buildAppealSection(colors),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}


class _AppealSheet extends StatefulWidget {
  const _AppealSheet();

  @override
  State<_AppealSheet> createState() => _AppealSheetState();
}

class _AppealSheetState extends State<_AppealSheet> {
  final _statement = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _statement.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.gutter, 0, AppSpacing.gutter, MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Appeal the decision', style: AppTypography.headingMedium(colors.textPrimary)),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'You can appeal once. Your documents carry over; explain what the reviewer missed.',
            style: AppTypography.bodySmall(colors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _statement,
            maxLines: 6,
            maxLength: 2000,
            decoration: InputDecoration(hintText: 'Why is the decision wrong?', errorText: _error),
          ),
          const SizedBox(height: AppSpacing.sm),
          AppButton(
            label: 'Send appeal',
            onPressed: () {
              final text = _statement.text.trim();
              if (text.length < 20) {
                setState(() => _error = 'Explain why the decision is wrong (at least 20 characters)');
                return;
              }
              Navigator.pop(context, text);
            },
          ),
        ],
      ),
    );
  }
}
