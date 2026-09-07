/**
 * Authentication — OTP Verification Screen
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_inputs.dart';

class OtpScreen extends ConsumerStatefulWidget {
  final String phoneNumber;

  const OtpScreen({super.key, required this.phoneNumber});

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _otpController = TextEditingController();
  bool _isLoading = false;
  String? _error;

  void _verifyOtp() {
    final otp = _otpController.text.trim();
    if (otp.length != 6) {
      setState(() => _error = 'Please enter the 6-digit OTP code');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    // In local development/emulator, complete verification and move to consent
    Future.delayed(const Duration(milliseconds: 600), () {
      if (mounted) {
        setState(() => _isLoading = false);
        context.go('/consent');
      }
    });
  }

  @override
  void dispose() {
    _otpController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Verify Phone'),
      ),
      body: SafeArea(
        child: Padding(
          padding: AppSpacing.paddingScreen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Enter 6-Digit OTP',
                style: AppTypography.headingLarge(AppColors.textDarkPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Sent via SMS to ${widget.phoneNumber}',
                style: AppTypography.bodyMedium(AppColors.textDarkSecondary),
              ),
              const SizedBox(height: AppSpacing.xl),
              AppTextField(
                label: 'SECURITY CODE (OTP)',
                hintText: '123456',
                controller: _otpController,
                keyboardType: TextInputType.number,
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.xs),
                Text(_error!, style: AppTypography.bodySmall(AppColors.rose)),
              ],
              const Spacer(),
              AppButton(
                label: 'Confirm & Sign In',
                isLoading: _isLoading,
                onPressed: _verifyOtp,
              ),
              const SizedBox(height: AppSpacing.md),
            ],
          ),
        ),
      ),
    );
  }
}
