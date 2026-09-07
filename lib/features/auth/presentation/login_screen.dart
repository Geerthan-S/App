/**
 * Authentication — Phone Number Entry Screen
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_inputs.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phoneController = TextEditingController();
  bool _isLoading = false;
  String? _error;

  void _sendOtp() {
    final phone = _phoneController.text.trim();
    if (phone.isEmpty || phone.length < 10) {
      setState(() => _error = 'Please enter a valid 10-digit mobile number');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    // In local development/emulator, navigate directly to OTP verification
    Future.delayed(const Duration(milliseconds: 600), () {
      if (mounted) {
        setState(() => _isLoading = false);
        context.push('/otp', extra: '+91$phone');
      }
    });
  }

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: AppSpacing.xl),
              Container(
                padding: const EdgeInsets.all(AppSpacing.sm),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                  border: Border.all(color: AppColors.primary.withOpacity(0.3)),
                ),
                child: const Icon(Icons.local_hospital_rounded, color: AppColors.primary, size: 36),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(
                'Healthcare Workforce Platform',
                style: AppTypography.headingLarge(AppColors.textDarkPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Verified on-demand duty coordination for licensed doctors and healthcare facilities.',
                style: AppTypography.bodyMedium(AppColors.textDarkSecondary),
              ),
              const SizedBox(height: AppSpacing.xl),
              AppTextField(
                label: 'MOBILE NUMBER',
                hintText: '98765 43210',
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                prefixIcon: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                  child: Text('+91', style: TextStyle(color: AppColors.textDarkPrimary, fontWeight: FontWeight.bold)),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.xs),
                Text(_error!, style: AppTypography.bodySmall(AppColors.rose)),
              ],
              const Spacer(),
              AppButton(
                label: 'Get Verification OTP',
                isLoading: _isLoading,
                onPressed: _sendOtp,
              ),
              const SizedBox(height: AppSpacing.sm),
              Center(
                child: Text(
                  'By continuing, you agree to verified identity & privacy standards',
                  style: AppTypography.bodySmall(AppColors.textDarkMuted),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
            ],
          ),
        ),
      ),
    );
  }
}
