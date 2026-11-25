// Signed-in devices and "sign out everywhere" (blueprint §11.3).
//
// Firebase cannot end a single session, so devices are those registered for
// push; signing out everywhere revokes every refresh token for the account.

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../auth/data/auth_repository.dart';
import '../data/account_repository.dart';

class DevicesScreen extends StatefulWidget {
  const DevicesScreen({super.key});

  @override
  State<DevicesScreen> createState() => _DevicesScreenState();
}

class _DevicesScreenState extends State<DevicesScreen> {
  late Future<List<Map<String, dynamic>>> _devices = AccountRepository.listMyDevices();
  bool _signingOut = false;

  String _when(String? iso) {
    final at = iso == null ? null : DateTime.tryParse(iso)?.toLocal();
    return at == null ? 'unknown' : DateFormat('d MMM yyyy, h:mm a').format(at);
  }

  Future<void> _signOutEverywhere() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out everywhere?'),
        content: const Text('Every device, including this one, will need to sign in again. Push notifications stop until then.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _signingOut = true);
    try {
      await AccountRepository.signOutEverywhere();
      await AuthRepository().signOut();
      if (mounted) context.go('/login');
    } catch (e) {
      if (!mounted) return;
      setState(() => _signingOut = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(callableErrorMessage(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: const Text('Devices')),
      body: SafeArea(
        child: FutureBuilder<List<Map<String, dynamic>>>(
          future: _devices,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) return const LoadingView();
            if (snap.hasError) {
              return ErrorView(
                message: callableErrorMessage(snap.error!, 'Could not load your devices.'),
                onRetry: () => setState(() => _devices = AccountRepository.listMyDevices()),
              );
            }
            final devices = snap.data!;
            return ListView(
              padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, AppSpacing.lg),
              children: [
                const GroupLabel('Signed-in devices'),
                if (devices.isEmpty)
                  Text('No devices are registered for notifications.', style: AppTypography.bodyMedium(colors.textSecondary))
                else
                  RowGroup(children: [
                    for (final d in devices)
                      ListRow(
                        icon: Icons.smartphone_outlined,
                        title: d['thisDevice'] == true ? '${_platform(d)} · this device' : _platform(d),
                        subtitle: 'Active ${_when(d['lastSeenAt'] as String?)}',
                      ),
                  ]),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Lost a phone? Sign out everywhere, then sign in again on the devices you still use.',
                  style: AppTypography.bodySmall(colors.textSecondary),
                ),
                const SizedBox(height: AppSpacing.lg),
                AppSecondaryButton(
                  label: 'Sign out everywhere',
                  icon: Icons.logout_outlined,
                  foregroundColor: AppColors.rose,
                  isLoading: _signingOut,
                  onPressed: _signingOut ? null : _signOutEverywhere,
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  String _platform(Map<String, dynamic> d) => d['platform'] == 'ios' ? 'iPhone' : 'Android phone';
}
