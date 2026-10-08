/**
 * Authentication — Professional Consent & Privacy Notice
 */

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/navigation/onboarding_gate.dart';

class ConsentScreen extends ConsumerStatefulWidget {
  const ConsentScreen({super.key});

  @override
  ConsumerState<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends ConsumerState<ConsentScreen> {
  bool _submitting = false;
  String? _error;

  /// Onboarding only advances after the server has persisted this consent version.
  Future<void> _accept() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await FirebaseFunctions.instance.httpsCallable('recordConsent').call<Map<String, dynamic>>({
        'consentVersion': AppConstants.currentConsentVersion,
      });
      OnboardingGate.markConsented(uid);
      if (mounted) context.go('/role-selection');
    } on FirebaseFunctionsException catch (e) {
      if (mounted) setState(() => _error = e.message ?? 'Could not record your consent. Try again.');
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not record your consent. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Terms & Privacy'),
      ),
      body: SafeArea(
        child: Padding(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Healthcare Integrity Consent',
                style: AppTypography.headingLarge(colors.textPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Please review our professional operational terms before selecting your role.',
                style: AppTypography.bodyMedium(colors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.lg),
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    children: [
                      AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '1. Verified Medical Identity',
                              style: AppTypography.headingSmall(colors.textPrimary),
                            ),
                            const SizedBox(height: AppSpacing.xs),
                            Text(
                              'All doctors must hold active, valid registration with the National Medical Commission (NMC) or relevant State Medical Council. False claims result in permanent revocation.',
                              style: AppTypography.bodyMedium(colors.textSecondary),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '2. Atomic Shift Contract',
                              style: AppTypography.headingSmall(colors.textPrimary),
                            ),
                            const SizedBox(height: AppSpacing.xs),
                            Text(
                              'Confirmed duty shifts represent binding operational commitments. Contact details are released strictly after mutual confirmation.',
                              style: AppTypography.bodyMedium(colors.textSecondary),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '3. Privacy & Clinical Record Policy',
                              style: AppTypography.headingSmall(colors.textPrimary),
                            ),
                            const SizedBox(height: AppSpacing.xs),
                            Text(
                              'This platform is strictly for duty staffing coordination. No patient clinical records, diagnoses, or prescriptions are stored or processed.',
                              style: AppTypography.bodyMedium(colors.textSecondary),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              if (_error != null) ...[
                Text(_error!, style: AppTypography.bodySmall(AppColors.rose)),
                const SizedBox(height: AppSpacing.xs),
              ],
              AppButton(
                label: _submitting ? 'Recording consent…' : 'I Accept & Agree',
                onPressed: _submitting ? null : _accept,
              ),
              const SizedBox(height: AppSpacing.xs),
            ],
          ),
        ),
      ),
    );
  }
}
