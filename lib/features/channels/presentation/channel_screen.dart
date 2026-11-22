// One channel: live messages, text composer, voice notes and images (when the
// media switch is on), report / remove, invite code for owners, leave.

import 'dart:async';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:record/record.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../business/data/business_repository.dart';
import '../data/channel_repository.dart';

class ChannelScreen extends StatefulWidget {
  final String channelId;
  final String name;

  const ChannelScreen({super.key, required this.channelId, required this.name});

  @override
  State<ChannelScreen> createState() => _ChannelScreenState();
}

class _ChannelScreenState extends State<ChannelScreen> {
  final _text = TextEditingController();
  final _recorder = AudioRecorder();
  bool _sending = false;
  bool _recording = false;
  DateTime? _recordStart;
  bool _mediaOn = false;

  @override
  void initState() {
    super.initState();
    BusinessFeatures.load().then((f) {
      if (mounted) setState(() => _mediaOn = BusinessFeatures.isOn(f, 'channels_media_enabled'));
    });
  }

  @override
  void dispose() {
    _recorder.dispose();
    super.dispose();
  }

  void _snack(String m, {bool error = false}) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(backgroundColor: error ? AppColors.rose : null, content: Text(m)));

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _sending = true);
    try {
      await action();
    } on FirebaseFunctionsException catch (e) {
      _snack(e.message ?? 'Could not send.', error: true);
    } catch (_) {
      _snack('Could not send. Check your connection.', error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sendText() async {
    final text = _text.text.trim();
    if (text.isEmpty) return;
    await _run(() async {
      await ChannelRepository.sendText(widget.channelId, text);
      _text.clear();
    });
  }

  Future<void> _pickImage() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 80, maxWidth: 1600);
    if (picked == null) return;
    await _run(() => ChannelRepository.sendMedia(widget.channelId, file: File(picked.path), voice: false, caption: _text.text.trim()));
    _text.clear();
  }

  Future<void> _toggleRecording() async {
    if (_recording) {
      final path = await _recorder.stop();
      final seconds = DateTime.now().difference(_recordStart!).inSeconds;
      setState(() => _recording = false);
      if (path == null || seconds < 1) return;
      await _run(() => ChannelRepository.sendMedia(widget.channelId, file: File(path), voice: true, durationSeconds: seconds));
      return;
    }
    if (!await _recorder.hasPermission()) {
      _snack('Allow microphone access to send voice notes.', error: true);
      return;
    }
    final path = '${Directory.systemTemp.path}/voice_${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 32000, sampleRate: 22050), path: path);
    setState(() {
      _recording = true;
      _recordStart = DateTime.now();
    });
  }

  Future<void> _messageActions(Map<String, dynamic> m, bool canModerate) async {
    final mine = m['senderId'] == ChannelRepository.uid;
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if ((m['text'] as String? ?? '').isNotEmpty)
            ListTile(leading: const Icon(Icons.copy), title: const Text('Copy'), onTap: () => Navigator.pop(ctx, 'copy')),
          if (mine || canModerate)
            ListTile(leading: const Icon(Icons.delete_outline), title: const Text('Remove message'), onTap: () => Navigator.pop(ctx, 'delete')),
          if (!mine)
            ListTile(leading: const Icon(Icons.flag_outlined), title: const Text('Report to HealthForce'), onTap: () => Navigator.pop(ctx, 'report')),
        ]),
      ),
    );
    if (!mounted || choice == null) return;
    if (choice == 'copy') {
      await Clipboard.setData(ClipboardData(text: m['text'] as String));
    } else if (choice == 'delete') {
      await _run(() => ChannelRepository.deleteMessage(widget.channelId, m['messageId'] as String));
    } else if (choice == 'report') {
      final reason = await showDialog<String>(
        context: context,
        builder: (ctx) => SimpleDialog(title: const Text('Why are you reporting this?'), children: [
          for (final r in const [
            ['spam', 'Spam or advertising'],
            ['abuse', 'Abusive or harassing'],
            ['patient_privacy', 'Shares identifiable patient details'],
            ['misinformation', 'Dangerous medical misinformation'],
            ['other', 'Something else'],
          ])
            SimpleDialogOption(onPressed: () => Navigator.pop(ctx, r[0]), child: Text(r[1])),
        ]),
      );
      if (reason == null) return;
      await _run(() => ChannelRepository.report(widget.channelId, m['messageId'] as String, reason));
      _snack('Reported. Our moderators will review it.');
    }
  }

  Future<void> _menu(String action, Map<String, dynamic>? membership) async {
    if (action == 'invite') {
      final code = await ChannelRepository.inviteCode(widget.channelId);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Invite code'),
          content: SelectableText(code ?? 'This channel is public: anyone can find and join it.', style: AppTypography.headingSmall(ctx.appColors.textPrimary)),
          actions: [
            if (code != null)
              TextButton(onPressed: () => Clipboard.setData(ClipboardData(text: code)), child: const Text('Copy')),
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
          ],
        ),
      );
    } else if (action == 'leave') {
      await _run(() => ChannelRepository.leave(widget.channelId));
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return StreamBuilder<Map<String, dynamic>?>(
      stream: ChannelRepository.watchMyMembership(widget.channelId),
      builder: (context, memberSnap) {
        final membership = memberSnap.data;
        final role = membership?['role'] as String?;
        final canModerate = role == 'owner' || role == 'moderator';
        return Scaffold(
          backgroundColor: colors.bg,
          appBar: AppBar(
            title: StreamBuilder<Map<String, dynamic>?>(
              stream: ChannelRepository.watchChannel(widget.channelId),
              builder: (context, snap) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(snap.data?['name'] as String? ?? widget.name),
                  if (snap.data != null)
                    Text('${snap.data!['memberCount']} members', style: AppTypography.bodySmall(colors.textMuted)),
                ],
              ),
            ),
            actions: [
              if (membership != null)
                PopupMenuButton<String>(
                  onSelected: (a) => _menu(a, membership),
                  itemBuilder: (_) => [
                    if (canModerate) const PopupMenuItem(value: 'invite', child: Text('Invite code')),
                    if (role != 'owner') const PopupMenuItem(value: 'leave', child: Text('Leave channel')),
                  ],
                ),
            ],
          ),
          body: Column(
            children: [
              Expanded(
                child: membership == null && memberSnap.connectionState != ConnectionState.waiting
                    ? const EmptyStateView(icon: Icons.lock_outline, title: 'Join to read', description: 'Join this channel from Community to see messages.')
                    : StreamBuilder<List<Map<String, dynamic>>>(
                        stream: ChannelRepository.watchMessages(widget.channelId),
                        builder: (context, snap) {
                          final messages = (snap.data ?? const []).reversed.toList();
                          if (snap.connectionState == ConnectionState.waiting) return const LoadingView();
                          if (messages.isEmpty) {
                            return const EmptyStateView(icon: Icons.forum_outlined, title: 'No messages yet', description: 'Start the conversation.');
                          }
                          return ListView.builder(
                            reverse: true,
                            padding: const EdgeInsets.all(AppSpacing.md),
                            itemCount: messages.length,
                            itemBuilder: (context, i) => _MessageBubble(
                              message: messages[i],
                              mine: messages[i]['senderId'] == ChannelRepository.uid,
                              onLongPress: () => _messageActions(messages[i], canModerate),
                            ),
                          );
                        },
                      ),
              ),
              if (membership != null)
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.sm, AppSpacing.xs, AppSpacing.sm, AppSpacing.xs),
                    child: Row(
                      children: [
                        if (_mediaOn)
                          IconButton(tooltip: 'Send image', icon: const Icon(Icons.image_outlined), onPressed: _sending || _recording ? null : _pickImage),
                        Expanded(
                          child: _recording
                              ? Text('Recording… tap the mic to send', style: AppTypography.bodyMedium(AppColors.rose))
                              : TextField(
                                  controller: _text,
                                  minLines: 1,
                                  maxLines: 5,
                                  textCapitalization: TextCapitalization.sentences,
                                  decoration: const InputDecoration(hintText: 'Message'),
                                ),
                        ),
                        if (_mediaOn)
                          IconButton(
                            tooltip: _recording ? 'Send voice note' : 'Record voice note',
                            icon: Icon(_recording ? Icons.stop_circle_outlined : Icons.mic_none, color: _recording ? AppColors.rose : null),
                            onPressed: _sending ? null : _toggleRecording,
                          ),
                        IconButton(
                          tooltip: 'Send',
                          icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send),
                          onPressed: _sending || _recording ? null : _sendText,
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final Map<String, dynamic> message;
  final bool mine;
  final VoidCallback onLongPress;

  const _MessageBubble({required this.message, required this.mine, required this.onLongPress});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final deleted = message['deleted'] == true;
    final media = message['media'] as Map?;
    final type = message['type'] as String? ?? 'text';
    final at = (message['createdAt'] as dynamic)?.toDate() as DateTime?;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: deleted ? null : onLongPress,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
          decoration: BoxDecoration(
            color: mine ? colors.accentSoft : colors.surface,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!mine)
                Text(
                  [message['senderName'], message['senderSpecialty']].whereType<String>().join(' · '),
                  style: AppTypography.bodySmall(colors.textMuted).copyWith(fontWeight: FontWeight.w600),
                ),
              if (deleted)
                Text('Message removed', style: AppTypography.bodySmall(colors.textMuted).copyWith(fontStyle: FontStyle.italic))
              else ...[
                if (type == 'image' && media != null) _MediaImage(path: media['path'] as String),
                if (type == 'voice' && media != null) _VoiceNote(path: media['path'] as String, seconds: (media['durationSeconds'] as num?)?.toInt()),
                if ((message['text'] as String? ?? '').isNotEmpty)
                  Text(message['text'] as String, style: AppTypography.bodyMedium(colors.textPrimary)),
              ],
              if (at != null)
                Text(formatTime(at), style: AppTypography.bodySmall(colors.textMuted).copyWith(fontSize: 10)),
            ],
          ),
        ),
      ),
    );
  }
}

class _MediaImage extends StatelessWidget {
  final String path;

  const _MediaImage({required this.path});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder(
      future: ChannelRepository.mediaBytes(path),
      builder: (context, snap) {
        if (snap.data == null) {
          return const SizedBox(width: 180, height: 120, child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
        }
        return Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.memory(snap.data!, width: 220, fit: BoxFit.cover)),
        );
      },
    );
  }
}

class _VoiceNote extends StatefulWidget {
  final String path;
  final int? seconds;

  const _VoiceNote({required this.path, this.seconds});

  @override
  State<_VoiceNote> createState() => _VoiceNoteState();
}

class _VoiceNoteState extends State<_VoiceNote> {
  final _player = AudioPlayer();
  bool _playing = false;
  bool _loading = false;
  StreamSubscription<void>? _done;

  @override
  void initState() {
    super.initState();
    _done = _player.onPlayerComplete.listen((_) {
      if (mounted) setState(() => _playing = false);
    });
  }

  @override
  void dispose() {
    _done?.cancel();
    _player.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_playing) {
      await _player.stop();
      setState(() => _playing = false);
      return;
    }
    setState(() => _loading = true);
    final bytes = await ChannelRepository.mediaBytes(widget.path);
    if (!mounted) return;
    setState(() => _loading = false);
    if (bytes == null) return;
    await _player.play(BytesSource(bytes, mimeType: 'audio/mp4'));
    setState(() => _playing = true);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          icon: _loading
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : Icon(_playing ? Icons.stop_rounded : Icons.play_arrow_rounded),
          onPressed: _loading ? null : _toggle,
        ),
        Text('Voice note${widget.seconds != null ? ' · ${widget.seconds}s' : ''}', style: AppTypography.bodySmall(colors.textSecondary)),
      ],
    );
  }
}
