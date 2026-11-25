// Server-controlled maintenance mode and minimum supported version
// (blueprint §16.2 "basement to build now").
//
// Reads the public appVersions/current document (edited by super admins in the
// admin portal's Master Config). It is live: turning maintenance off lets
// users straight back in. If the document cannot be read (offline, Firebase
// unavailable) the app is never blocked; the server still enforces every rule.

import 'dart:async';
import 'dart:io' show Platform;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../design_system/app_buttons.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_spacing.dart';
import '../design_system/app_typography.dart';

/// Compares dotted versions numerically ("1.10.0" > "1.9.3"). Exposed for tests.
int compareVersions(String a, String b) {
  List<int> parts(String v) => v.split('+').first.split('.').map((p) => int.tryParse(p) ?? 0).toList();
  final x = parts(a);
  final y = parts(b);
  for (var i = 0; i < 3; i++) {
    final d = (i < x.length ? x[i] : 0) - (i < y.length ? y[i] : 0);
    if (d != 0) return d.sign;
  }
  return 0;
}

class AppReleaseGate extends StatefulWidget {
  final Widget child;
  const AppReleaseGate({super.key, required this.child});

  @override
  State<AppReleaseGate> createState() => _AppReleaseGateState();
}

class _AppReleaseGateState extends State<AppReleaseGate> {
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _sub;
  String? _installedVersion;
  Map<String, dynamic>? _release;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    if (Firebase.apps.isEmpty) return;
    try {
      _installedVersion = (await PackageInfo.fromPlatform()).version;
    } catch (_) {
      return; // Without a known version, never block the app.
    }
    _sub = FirebaseFirestore.instance.collection('appVersions').doc('current').snapshots().listen(
      (snap) {
        if (mounted) setState(() => _release = snap.data());
      },
      onError: (_) {},
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  String get _platformKey => !kIsWeb && Platform.isIOS ? 'ios' : 'android';

  @override
  Widget build(BuildContext context) {
    final release = _release;
    if (release == null || _installedVersion == null) return widget.child;

    final maintenance = release['maintenance'] as Map<String, dynamic>?;
    if (maintenance?['enabled'] == true) {
      return _GateScreen(
        icon: Icons.construction_outlined,
        title: 'Back shortly',
        message: (maintenance?['message'] as String?)?.trim().isNotEmpty == true
            ? maintenance!['message'] as String
            : 'HealthForce is down for planned maintenance. Your duties and applications are safe.',
      );
    }

    final minimum = (release['minimumVersion'] as Map<String, dynamic>?)?[_platformKey] as String?;
    if (minimum != null && compareVersions(_installedVersion!, minimum) < 0) {
      final url = release['updateUrl'] as String?;
      return _GateScreen(
        icon: Icons.system_update_outlined,
        title: 'Update required',
        message: 'This version ($_installedVersion) is no longer supported. Update to $minimum or later to keep using HealthForce.',
        actionLabel: url == null ? null : 'Update now',
        onAction: url == null ? null : () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
      );
    }
    return widget.child;
  }
}

class _GateScreen extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  const _GateScreen({required this.icon, required this.title, required this.message, this.actionLabel, this.onAction});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      body: SafeArea(
        child: Padding(
          padding: AppSpacing.paddingScreen,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 48, color: colors.textPrimary),
              const SizedBox(height: AppSpacing.md),
              Text(title, style: AppTypography.headingLarge(colors.textPrimary), textAlign: TextAlign.center),
              const SizedBox(height: AppSpacing.sm),
              Text(message, style: AppTypography.bodyMedium(colors.textSecondary), textAlign: TextAlign.center),
              if (actionLabel != null) ...[
                const SizedBox(height: AppSpacing.lg),
                AppButton(label: actionLabel!, onPressed: onAction),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
