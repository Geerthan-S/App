// Community: the AI assistant, the user's channels and recommended channels
// (specialty matches first), plus create and join-by-invite-code.

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../business/data/business_repository.dart';
import '../data/channel_repository.dart';

class ChannelsScreen extends StatefulWidget {
  const ChannelsScreen({super.key});

  @override
  State<ChannelsScreen> createState() => _ChannelsScreenState();
}

class _ChannelsScreenState extends State<ChannelsScreen> {
  final _search = TextEditingController();
  Future<List<Map<String, dynamic>>>? _recommended;
  late final Future<Map<String, dynamic>> _features = BusinessFeatures.load(refresh: true);

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() => setState(() => _recommended = ChannelRepository.recommended(search: _search.text.trim()));

  void _snack(String m, {bool error = false}) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(backgroundColor: error ? AppColors.rose : null, content: Text(m)));

  void _open(String channelId, String name) => context.push('/channel', extra: {'channelId': channelId, 'name': name});

  Future<void> _create() async {
    final name = TextEditingController();
    final description = TextEditingController();
    final tags = TextEditingController();
    var private = false;
    final created = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(AppSpacing.gutter, 0, AppSpacing.gutter, MediaQuery.of(ctx).viewInsets.bottom + AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SheetHeader(title: 'New channel', subtitle: 'A space for doctors to discuss cases and duties', onClose: () => Navigator.pop(ctx)),
              TextField(controller: name, maxLength: 60, decoration: const InputDecoration(labelText: 'Channel name')),
              TextField(controller: description, maxLength: 300, decoration: const InputDecoration(labelText: 'What is it about?')),
              TextField(controller: tags, decoration: const InputDecoration(labelText: 'Tags, comma separated', hintText: 'e.g. dental, oral surgery')),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Private (invite code only)'),
                value: private,
                onChanged: (v) => setSheet(() => private = v),
              ),
              const SizedBox(height: AppSpacing.sm),
              AppButton(
                label: 'Create channel',
                onPressed: () async {
                  try {
                    final result = await ChannelRepository.create(
                      name: name.text.trim(),
                      description: description.text.trim(),
                      tags: tags.text.split(',').map((t) => t.trim()).where((t) => t.isNotEmpty).toList(),
                      private: private,
                    );
                    if (ctx.mounted) Navigator.pop(ctx, result);
                  } on FirebaseFunctionsException catch (e) {
                    if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(e.message ?? 'Could not create.')));
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
    if (created == null || !mounted) return;
    if (created['inviteCode'] != null) _snack('Created. Invite code: ${created['inviteCode']}');
    _open(created['channelId'] as String, name.text.trim());
  }

  Future<void> _joinByCode() async {
    final code = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Join with invite code'),
        content: TextField(controller: code, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(hintText: 'Invite code')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Join')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final channelId = await ChannelRepository.joinByCode(code.text.trim());
      if (mounted) _open(channelId, 'Channel');
    } on FirebaseFunctionsException catch (e) {
      _snack(e.message ?? 'Could not join.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: const Text('Community'),
        actions: [
          IconButton(tooltip: 'Join with code', icon: const Icon(Icons.vpn_key_outlined), onPressed: _joinByCode),
          IconButton(tooltip: 'New channel', icon: const Icon(Icons.add_comment_outlined), onPressed: _create),
        ],
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _features,
        builder: (context, featureSnap) {
          final features = featureSnap.data ?? const <String, dynamic>{};
          final channelsOn = BusinessFeatures.isOn(features, 'channels_enabled');
          final aiOn = BusinessFeatures.isOn(features, 'ai_assistant_enabled');
          if (featureSnap.connectionState == ConnectionState.waiting) return const LoadingView();
          return RefreshIndicator(
            onRefresh: () async => _load(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, AppSpacing.sm, AppSpacing.gutter, AppSpacing.xl),
              children: [
                if (aiOn) ...[
                  RowGroup(children: [
                    ListRow(
                      icon: Icons.auto_awesome_outlined,
                      iconColor: AppColors.amber,
                      title: 'HealthForce AI',
                      subtitle: 'Ask a clinical question or share a de-identified photo',
                      onTap: () => context.push('/ai-assistant'),
                    ),
                  ]),
                  const SizedBox(height: AppSpacing.lg),
                ],
                if (!channelsOn)
                  const EmptyStateView(icon: Icons.forum_outlined, title: 'Channels are coming soon', description: 'Discussion channels for doctors will open here.')
                else ...[
                  const GroupLabel('Your channels'),
                  StreamBuilder<List<String>>(
                    stream: ChannelRepository.watchMyChannelIds(),
                    builder: (context, snap) {
                      final ids = snap.data ?? const [];
                      if (ids.isEmpty) {
                        return Text('You have not joined any channels yet.', style: AppTypography.bodySmall(colors.textMuted));
                      }
                      return RowGroup(children: [for (final id in ids) _MyChannelRow(channelId: id, onOpen: _open)]);
                    },
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  const GroupLabel('Recommended for you'),
                  TextField(
                    controller: _search,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => _load(),
                    decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search channels'),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  FutureBuilder<List<Map<String, dynamic>>>(
                    future: _recommended,
                    builder: (context, snap) {
                      if (snap.connectionState == ConnectionState.waiting) {
                        return const Padding(padding: EdgeInsets.all(AppSpacing.lg), child: Center(child: CircularProgressIndicator()));
                      }
                      final list = (snap.data ?? const []).where((c) => c['joined'] != true).toList();
                      if (list.isEmpty) return Text('No channels to suggest yet. Start one!', style: AppTypography.bodySmall(colors.textMuted));
                      return RowGroup(children: [
                        for (final c in list)
                          ListRow(
                            icon: Icons.tag,
                            title: c['name'] as String,
                            subtitle: [
                              '${c['memberCount']} members',
                              if ((c['tags'] as List?)?.isNotEmpty == true) (c['tags'] as List).join(', '),
                            ].join(' · '),
                            trailing: TextButton(
                              onPressed: () async {
                                try {
                                  await ChannelRepository.join(c['channelId'] as String);
                                  if (mounted) _open(c['channelId'] as String, c['name'] as String);
                                  _load();
                                } on FirebaseFunctionsException catch (e) {
                                  _snack(e.message ?? 'Could not join.', error: true);
                                }
                              },
                              child: const Text('Join'),
                            ),
                          ),
                      ]);
                    },
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _MyChannelRow extends StatelessWidget {
  final String channelId;
  final void Function(String id, String name) onOpen;

  const _MyChannelRow({required this.channelId, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<Map<String, dynamic>?>(
      stream: ChannelRepository.watchChannel(channelId),
      builder: (context, snap) {
        final c = snap.data;
        return ListRow(
          icon: c?['visibility'] == 'private' ? Icons.lock_outline : Icons.tag,
          title: c?['name'] as String? ?? '…',
          subtitle: c == null ? null : (c['status'] == 'closed' ? 'Closed' : (c['lastMessagePreview'] as String? ?? '${c['memberCount']} members')),
          onTap: c == null ? null : () => onOpen(channelId, c['name'] as String),
        );
      },
    );
  }
}
