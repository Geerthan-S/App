/**
 * Authentication — OTP Verification Screen
 */

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_inputs.dart';
import '../data/auth_repository.dart';

class OtpScreen extends ConsumerStatefulWidget {
  final String phoneNumber;
  final String verificationId;

  const OtpScreen({super.key, required this.phoneNumber, required this.verificationId});

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _authRepository = AuthRepository();
  final _otpController = TextEditingController();
  late String _verificationId;
  bool _isLoading = false;
  bool _isResending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _verificationId = widget.verificationId;
  }

  Future<void> _verifyOtp() async {
    final otp = _otpController.text.trim();
    if (otp.length != 6) {
      setState(() => _error = 'Please enter the 6-digit OTP code');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      await _authRepository.signInWithSmsCode(verificationId: _verificationId, smsCode: otp);
      if (!mounted) return;
      context.go('/consent');
    } on FirebaseAuthException catch (e) {
      setState(() => _error = e.message ?? 'Invalid or expired OTP. Please try again.');
    } catch (_) {
      setState(() => _error = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _resendOtp() async {
    setState(() {
      _isResending = true;
      _error = null;
    });

    await _authRepository.verifyPhoneNumber(
      phoneNumber: widget.phoneNumber,
      verificationCompleted: (credential) async {
        try {
          await _authRepository.signInWithPhoneCredential(credential);
          if (mounted) context.go('/consent');
        } on FirebaseAuthException catch (e) {
          if (mounted) setState(() => _error = e.message ?? 'Sign-in failed. Please try again.');
        } finally {
          if (mounted) setState(() => _isResending = false);
        }
      },
      verificationFailed: (e) {
        if (!mounted) return;
        setState(() {
          _isResending = false;
          _error = e.message ?? 'Could not resend the code. Please try again.';
        });
      },
      codeSent: (verificationId, _) {
        if (!mounted) return;
        setState(() {
          _verificationId = verificationId;
          _isResending = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('A new code has been sent.')),
        );
      },
      codeAutoRetrievalTimeout: (verificationId) {
        _verificationId = verificationId;
      },
    );
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
                style: AppTypography.headingLarge(AppColors.textLightPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Sent via SMS to ${widget.phoneNumber}',
                style: AppTypography.bodyMedium(AppColors.textLightSecondary),
              ),
              const SizedBox(height: AppSpacing.xl),
              AppTextField(
                label: 'SECURITY CODE (OTP)',
                hintText: '123456',
                controller: _otpController,
                keyboardType: TextInputType.number,
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: _isResending ? null : _resendOtp,
                  child: Text(_isResending ? 'Resending...' : 'Resend OTP'),
                ),
              ),
              if (_error != null) ...[
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
