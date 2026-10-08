/**
 * Authentication — Login Screen (Google Sign-In)
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
import '../../../core/config/local_test_config.dart';

class LoginScreen extends ConsumerStatefulWidget {
  final AuthRepository? authRepository;
  const LoginScreen({super.key, this.authRepository});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  late final _authRepository = widget.authRepository ?? AuthRepository();
  final _phoneController = TextEditingController();
  bool _isGoogleLoading = false;
  bool _isPhoneLoading = false;
  String? _error;

  bool get _isBusy => _isGoogleLoading || _isPhoneLoading;

  Future<void> _signInWithGoogle() async {
    setState(() {
      _isGoogleLoading = true;
      _error = null;
    });

    try {
      await _authRepository.signInWithGoogle();
      if (!mounted) return;
      context.go('/consent');
    } on GoogleSignInCancelledException {
      // User dismissed the account picker — no error to show.
    } on FirebaseAuthException catch (e) {
      setState(() => _error = e.message ?? 'Sign-in failed. Please try again.');
    } catch (_) {
      setState(
        () => _error =
            'Something went wrong. Please check your connection and try again.',
      );
    } finally {
      if (mounted) setState(() => _isGoogleLoading = false);
    }
  }

  Future<void> _sendOtp() async {
    if (LocalTestConfig.enabled) {
      setState(() {
        _isPhoneLoading = true;
        _error = null;
      });
      try {
        await _authRepository.signInToLocalTestAccount();
        if (mounted) context.go('/home');
      } catch (_) {
        if (mounted) {
          setState(
            () => _error =
                'Start the local Firebase test services and try again.',
          );
        }
      } finally {
        if (mounted) setState(() => _isPhoneLoading = false);
      }
      return;
    }
    final rawNumber = _phoneController.text.trim();
    if (rawNumber.length != 10) {
      setState(() => _error = 'Enter a valid 10-digit mobile number');
      return;
    }
    final phoneNumber = '+91$rawNumber';

    setState(() {
      _isPhoneLoading = true;
      _error = null;
    });

    await _authRepository.verifyPhoneNumber(
      phoneNumber: phoneNumber,
      verificationCompleted: (credential) async {
        // Android-only instant verification (auto-retrieved or pre-validated SIM number).
        try {
          await _authRepository.signInWithPhoneCredential(credential);
          if (mounted) context.go('/consent');
        } on FirebaseAuthException catch (e) {
          if (mounted)
            setState(
              () => _error = e.message ?? 'Sign-in failed. Please try again.',
            );
        } finally {
          if (mounted) setState(() => _isPhoneLoading = false);
        }
      },
      verificationFailed: (e) {
        if (!mounted) return;
        setState(() {
          _isPhoneLoading = false;
          _error =
              e.message ?? 'Could not verify this number. Please try again.';
        });
      },
      codeSent: (verificationId, forceResendingToken) {
        if (!mounted) return;
        setState(() => _isPhoneLoading = false);
        context.push(
          '/otp',
          extra: {'phoneNumber': phoneNumber, 'verificationId': verificationId},
        );
      },
      codeAutoRetrievalTimeout: (verificationId) {},
    );
  }

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
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
                child: const Icon(
                  Icons.local_hospital_rounded,
                  color: AppColors.primary,
                  size: 36,
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(
                'Healthcare Workforce Platform',
                style: AppTypography.headingLarge(colors.textPrimary),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Verified on-demand duty coordination for licensed doctors and healthcare facilities.',
                style: AppTypography.bodyMedium(colors.textSecondary),
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.lg),
                Text(_error!, style: AppTypography.bodySmall(AppColors.rose)),
              ],
              const Spacer(),
              _GoogleSignInButton(
                isLoading: _isGoogleLoading,
                onPressed: _isBusy ? null : _signInWithGoogle,
              ),
              const SizedBox(height: AppSpacing.lg),
              Row(
                children: [
                  Expanded(child: Divider(color: colors.border)),
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                    ),
                    child: Text(
                      'OR',
                      style: AppTypography.bodySmall(colors.textMuted),
                    ),
                  ),
                  Expanded(child: Divider(color: colors.border)),
                ],
              ),
              const SizedBox(height: AppSpacing.lg),
              AppTextField(
                label: 'MOBILE NUMBER',
                hintText: '98765 43210',
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                prefixIcon: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 14,
                  ),
                  child: Text(
                    '+91',
                    style: TextStyle(
                      color: colors.textPrimary,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              AppButton(
                label: 'Get Verification OTP',
                isLoading: _isPhoneLoading,
                onPressed: _isBusy ? null : _sendOtp,
              ),
              const SizedBox(height: AppSpacing.sm),
              Center(
                child: Text(
                  'By continuing, you agree to verified identity & privacy standards',
                  style: AppTypography.bodySmall(colors.textMuted),
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

class _GoogleSignInButton extends StatelessWidget {
  final bool isLoading;
  final VoidCallback? onPressed;

  const _GoogleSignInButton({required this.isLoading, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(
          backgroundColor: colors.surface,
          side: BorderSide(color: colors.border),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          ),
        ),
        onPressed: (isLoading || onPressed == null) ? null : onPressed,
        child: isLoading
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.primary,
                ),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const _GoogleLogo(size: 20),
                  const SizedBox(width: AppSpacing.sm),
                  Text(
                    'Continue with Google',
                    style: AppTypography.labelBold(colors.textPrimary),
                  ),
                ],
              ),
      ),
    );
  }
}

/// Minimal, dependency-free rendering of the Google "G" mark.
class _GoogleLogo extends StatelessWidget {
  final double size;

  const _GoogleLogo({required this.size});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _GoogleLogoPainter()),
    );
  }
}

class _GoogleLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final strokeWidth = size.width * 0.22;
    final radius = (size.width - strokeWidth) / 2;
    final center = Offset(size.width / 2, size.height / 2);
    final rect = Rect.fromCircle(center: center, radius: radius);

    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.butt;

    paint.color = const Color(0xFF4285F4);
    canvas.drawArc(rect, -0.35, 1.7, false, paint);

    paint.color = const Color(0xFF34A853);
    canvas.drawArc(rect, 1.35, 1.15, false, paint);

    paint.color = const Color(0xFFFBBC05);
    canvas.drawArc(rect, 2.5, 1.0, false, paint);

    paint.color = const Color(0xFFEA4335);
    canvas.drawArc(rect, 3.5, 1.4, false, paint);

    final barPaint = Paint()..color = const Color(0xFF4285F4);
    canvas.drawRect(
      Rect.fromLTWH(
        center.dx,
        center.dy - strokeWidth / 2,
        radius + strokeWidth / 2,
        strokeWidth,
      ),
      barPaint,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
