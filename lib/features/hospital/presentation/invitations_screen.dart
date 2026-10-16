// Invitations addressed to the signed-in user's phone or verified email.

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../settings/data/account_repository.dart';
import '../data/team_repository.dart';

class InvitationsScreen extends StatefulWidget {
  const InvitationsScreen({super.key});

  @override
  State<InvitationsScreen> createState() => _InvitationsScreenState();
}

class _InvitationsScreenState extends State<InvitationsScreen> {
  late Future<List<Map<String, dynamic>>> _invites = TeamRepository.myInvitations();
  String? _busy;

  Future<void> _respond(Map<String, dynamic> invite, bool accept) async {
    final id = invite['inviteId'] as String;
    setState(() => _busy = id);
    try {
      await TeamRepository.respond(id, accept: accept);
      if (!mounted) return;
      if (accept) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('You joined ${invite['organizationName'] ?? 'the hospital'}')),
        );
        context.go('/hospital-dashboard');
        return;
      }
      setState(() {
        _busy = null;
        _invites = TeamRepository.myInvitations();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = null);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(callableErrorMessage(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: const Text('Invitations')),
      body: SafeArea(
        child: FutureBuilder<List<Map<String, dynamic>>>(
          future: _invites,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) return const LoadingView();
            if (snap.hasError) {
              return ErrorView(
                message: callableErrorMessage(snap.error!, 'Could not load invitations.'),
                onRetry: () => setState(() => _invites = TeamRepository.myInvitations()),
              );
            }
            final invites = snap.data!;
            if (invites.isEmpty) {
              return const EmptyStateView(
                icon: Icons.mail_outline,
                title: 'No invitations',
                description: 'When a hospital invites your number or email to its team, it shows up here.',
              );
            }
            return ListView(
              padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, AppSpacing.lg),
              children: [
                RowGroup(children: [
                  for (final inv in invites)
                    ListRow(
                      icon: Icons.apartment_outlined,
                      title: inv['organizationName'] as String? ?? 'Hospital',
                      subtitle: '${OrgRoles.label(inv['role'] as String? ?? '')} · '
                          'expires ${_date(inv['expiresAt'] as String?)}',
                      trailing: _busy == inv['inviteId']
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : Row(mainAxisSize: MainAxisSize.min, children: [
                              IconButton(
                                tooltip: 'Decline',
                                icon: const Icon(Icons.close, color: AppColors.rose),
                                onPressed: _busy == null ? () => _respond(inv, false) : null,
                              ),
                              IconButton(
                                tooltip: 'Accept',
                                icon: const Icon(Icons.check, color: AppColors.emerald),
                                onPressed: _busy == null ? () => _respond(inv, true) : null,
                              ),
                            ]),
                    ),
                ]),
              ],
            );
          },
        ),
      ),
    );
  }

  String _date(String? iso) {
    final at = iso == null ? null : DateTime.tryParse(iso)?.toLocal();
    return at == null ? '' : DateFormat('d MMM').format(at);
  }
}
