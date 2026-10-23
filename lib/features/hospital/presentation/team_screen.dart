// Hospital team: members, roles, invitations and offboarding (blueprint §3.3).

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../settings/data/account_repository.dart';
import '../data/team_repository.dart';

class TeamScreen extends StatefulWidget {
  final String organizationId;
  final String organizationName;

  const TeamScreen({super.key, required this.organizationId, this.organizationName = ''});

  @override
  State<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends State<TeamScreen> {
  late Future<TeamView> _team = TeamRepository.listMembers(widget.organizationId);

  void _reload() => setState(() => _team = TeamRepository.listMembers(widget.organizationId));

  void _toast(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _run(Future<void> Function() action, String done) async {
    try {
      await action();
      _toast(done);
      _reload();
    } catch (e) {
      _toast(callableErrorMessage(e));
    }
  }

  Future<void> _invite(TeamView team) async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _InviteSheet(organizationId: widget.organizationId, canInviteAdmin: team.myRole == 'owner'),
    );
    if (sent == true) {
      _toast('Invitation sent. It expires in 7 days.');
      _reload();
    }
  }

  Future<void> _memberActions(TeamView team, Map<String, dynamic> member) async {
    final userId = member['userId'] as String;
    final current = member['role'] as String? ?? 'member';
    final isOwner = team.myRole == 'owner';
    final roles = ['owner', 'admin', 'recruiter', 'operations']
        .where((r) => isOwner || (r != 'owner' && r != 'admin'))
        .toList();
    final privilegedTarget = current == 'owner' || current == 'admin';
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (isOwner || !privilegedTarget)
            for (final r in roles)
              ListTile(
                title: Text(OrgRoles.label(r)),
                subtitle: Text(OrgRoles.descriptions[r]!),
                trailing: r == current ? const Icon(Icons.check) : null,
                onTap: r == current ? null : () => Navigator.pop(context, r),
              ),
          if (isOwner || !privilegedTarget)
            ListTile(
              leading: const Icon(Icons.person_remove_outlined, color: AppColors.rose),
              title: const Text('Remove from team', style: TextStyle(color: AppColors.rose)),
              onTap: () => Navigator.pop(context, 'remove'),
            )
          else
            const ListTile(title: Text('Only an owner can change owners and admins.')),
        ]),
      ),
    );
    if (choice == null) return;
    if (choice == 'remove') {
      final ok = await _confirm('Remove ${member['displayName'] ?? 'this member'}?',
          'Their access ends immediately. Duties they posted and the audit trail stay.');
      if (ok) await _run(() => TeamRepository.remove(widget.organizationId, userId), 'Member removed');
    } else {
      await _run(() => TeamRepository.changeRole(widget.organizationId, userId, choice), 'Role updated');
    }
  }

  Future<void> _leave(Map<String, dynamic> me) async {
    final ok = await _confirm('Leave this hospital?', 'You lose access to its duties and assignments.');
    if (!ok) return;
    try {
      await TeamRepository.remove(widget.organizationId, me['userId'] as String);
      if (mounted) context.go('/home');
    } catch (e) {
      _toast(callableErrorMessage(e));
    }
  }

  Future<bool> _confirm(String title, String body) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(body),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            TextButton(
              onPressed: () => Navigator.pop(context, true),
              style: TextButton.styleFrom(foregroundColor: AppColors.rose),
              child: const Text('Confirm'),
            ),
          ],
        ),
      ) ==
      true;

  String _expires(String? iso) {
    final at = iso == null ? null : DateTime.tryParse(iso)?.toLocal();
    return at == null ? '' : 'Expires ${DateFormat('d MMM').format(at)}';
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: Text(widget.organizationName.isEmpty ? 'Team' : '${widget.organizationName} team')),
      body: SafeArea(
        child: FutureBuilder<TeamView>(
          future: _team,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) return const LoadingView();
            if (snap.hasError) {
              return ErrorView(message: callableErrorMessage(snap.error!, 'Could not load the team.'), onRetry: _reload);
            }
            final team = snap.data!;
            final me = team.members.where((m) => m['isYou'] == true).firstOrNull;
            return RefreshIndicator(
              onRefresh: () async => _reload(),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, AppSpacing.lg),
                children: [
                  Text('Your role: ${OrgRoles.label(team.myRole)}', style: AppTypography.labelBold(colors.textPrimary)),
                  Text(OrgRoles.descriptions[team.myRole] ?? '', style: AppTypography.bodySmall(colors.textSecondary)),
                  const SizedBox(height: AppSpacing.lg),
                  if (team.canManage) ...[
                    AppButton(label: 'Invite a colleague', icon: Icons.person_add_alt_outlined, onPressed: () => _invite(team)),
                    const SizedBox(height: AppSpacing.lg),
                  ],
                  GroupLabel('Members (${team.members.length})'),
                  RowGroup(children: [
                    for (final m in team.members)
                      ListRow(
                        icon: Icons.person_outline,
                        title: '${m['displayName'] ?? 'Team member'}${m['isYou'] == true ? ' (you)' : ''}',
                        subtitle: OrgRoles.label(m['role'] as String? ?? 'member'),
                        onTap: team.canManage && m['isYou'] != true ? () => _memberActions(team, m) : null,
                      ),
                  ]),
                  if (team.invitations.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.lg),
                    const GroupLabel('Pending invitations'),
                    RowGroup(children: [
                      for (final inv in team.invitations)
                        ListRow(
                          icon: Icons.mail_outline,
                          title: inv['contact'] as String? ?? '',
                          subtitle: '${OrgRoles.label(inv['role'] as String? ?? '')} · ${_expires(inv['expiresAt'] as String?)}',
                          trailing: IconButton(
                            tooltip: 'Revoke',
                            icon: Icon(Icons.close, color: colors.textMuted),
                            onPressed: () => _run(
                              () => TeamRepository.revokeInvitation(inv['inviteId'] as String),
                              'Invitation revoked',
                            ),
                          ),
                        ),
                    ]),
                  ],
                  if (me != null) ...[
                    const SizedBox(height: AppSpacing.xl),
                    AppSecondaryButton(
                      label: 'Leave this hospital',
                      icon: Icons.logout_outlined,
                      foregroundColor: AppColors.rose,
                      onPressed: () => _leave(me),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _InviteSheet extends StatefulWidget {
  final String organizationId;
  final bool canInviteAdmin;

  const _InviteSheet({required this.organizationId, required this.canInviteAdmin});

  @override
  State<_InviteSheet> createState() => _InviteSheetState();
}

class _InviteSheetState extends State<_InviteSheet> {
  final _contact = TextEditingController();
  String _role = 'recruiter';
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _contact.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final raw = _contact.text.trim().replaceAll(' ', '');
    final isEmail = raw.contains('@');
    String? phone;
    if (!isEmail) {
      final digits = raw.replaceAll(RegExp(r'[^\d+]'), '');
      phone = digits.startsWith('+') ? digits : (digits.length == 10 ? '+91$digits' : '+$digits');
      if (!RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(phone)) {
        setState(() => _error = 'Enter a mobile number (e.g. 9876543210) or an email');
        return;
      }
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await TeamRepository.invite(
        organizationId: widget.organizationId,
        role: _role,
        phoneNumber: isEmail ? null : phone,
        email: isEmail ? raw.toLowerCase() : null,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() {
        _sending = false;
        _error = callableErrorMessage(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final roles = [if (widget.canInviteAdmin) 'admin', 'recruiter', 'operations'];
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.gutter, 0, AppSpacing.gutter, MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Invite a colleague', style: AppTypography.headingMedium(colors.textPrimary)),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'They accept from Settings › Invitations after signing in with this number or verified email.',
            style: AppTypography.bodySmall(colors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _contact,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(labelText: 'Mobile number or email', errorText: _error),
          ),
          const SizedBox(height: AppSpacing.md),
          RadioGroup<String>(
            groupValue: _role,
            onChanged: (v) => setState(() => _role = v ?? _role),
            child: Column(children: [
              for (final r in roles)
                RadioListTile<String>(
                  value: r,
                  contentPadding: EdgeInsets.zero,
                  title: Text(OrgRoles.label(r)),
                  subtitle: Text(OrgRoles.descriptions[r]!),
                ),
            ]),
          ),
          const SizedBox(height: AppSpacing.sm),
          AppButton(label: 'Send invitation', isLoading: _sending, onPressed: _sending ? null : _send),
        ],
      ),
    );
  }
}
