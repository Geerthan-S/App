// One conversation: live messages and a composer. Opening it (and every new
// message while it is open) marks the thread read for the viewer's side.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/state_views.dart';
import '../../settings/data/account_repository.dart' show callableErrorMessage;
import '../data/chat_repository.dart';

class ChatScreen extends StatefulWidget {
  final String conversationId;
  final ChatSide viewer;
  final String title;

  const ChatScreen({super.key, required this.conversationId, required this.viewer, required this.title});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  late final Stream<List<ChatMessage>> _messages = ChatRepository.watchMessages(widget.conversationId);
  late final Stream<ChatThread?> _thread = ChatRepository.watchThread(widget.conversationId);
  StreamSubscription<ChatThread?>? _unreadSub;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    // Clear the badge whenever something new arrives while the chat is open.
    _unreadSub = _thread.listen((t) {
      if (t != null && t.unreadFor(widget.viewer) > 0) ChatRepository.markRead(widget.conversationId).ignore();
    });
  }

  @override
  void dispose() {
    _unreadSub?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ChatRepository.send(widget.conversationId, text);
      _input.clear();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(callableErrorMessage(e, 'Message not sent. Try again.'))));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        titleSpacing: 0,
        title: StreamBuilder<ChatThread?>(
          stream: _thread,
          builder: (context, snap) {
            final t = snap.data;
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t?.counterpartName(widget.viewer) ?? widget.title, maxLines: 1, overflow: TextOverflow.ellipsis),
              if (t?.dutyTitle != null)
                Text(t!.dutyTitle!, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: AppTypography.bodySmall(colors.textMuted)),
            ]);
          },
        ),
      ),
      body: SafeArea(
        child: Column(children: [
          Expanded(
            child: StreamBuilder<List<ChatMessage>>(
              stream: _messages,
              builder: (context, snap) {
                if (snap.hasError) return const ErrorView(message: 'Could not load this conversation.');
                if (!snap.hasData) return const LoadingView();
                final messages = snap.data!;
                if (messages.isEmpty) {
                  return const EmptyStateView(
                    icon: Icons.chat_bubble_outline,
                    title: 'Say hello',
                    description: 'Messages stay between you and the other side of this duty.',
                  );
                }
                // Newest at the bottom; the reversed list keeps it pinned there.
                return ListView.builder(
                  controller: _scroll,
                  reverse: true,
                  padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 12, AppSpacing.gutter, 12),
                  itemCount: messages.length,
                  itemBuilder: (context, i) {
                    final m = messages[messages.length - 1 - i];
                    final previous = i + 1 < messages.length ? messages[messages.length - 2 - i] : null;
                    final showDay = previous == null || !_sameDay(previous.at, m.at);
                    return Column(children: [
                      if (showDay) _DayLabel(at: m.at),
                      _Bubble(message: m, mine: m.senderSide == widget.viewer.key),
                    ]);
                  },
                );
              },
            ),
          ),
          Container(
            decoration: BoxDecoration(color: colors.surface, border: Border(top: BorderSide(color: colors.border))),
            padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, 8, 8),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  minLines: 1,
                  maxLines: 5,
                  maxLength: 2000,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(hintText: 'Message', counterText: '', border: InputBorder.none),
                  onSubmitted: (_) => _send(),
                ),
              ),
              IconButton(
                tooltip: 'Send',
                onPressed: _sending ? null : _send,
                icon: _sending
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Icon(Icons.send_rounded, color: colors.accent),
              ),
            ]),
          ),
        ]),
      ),
    );
  }

  bool _sameDay(DateTime? a, DateTime? b) {
    if (a == null || b == null) return true;
    final x = a.toLocal();
    final y = b.toLocal();
    return x.year == y.year && x.month == y.month && x.day == y.day;
  }
}

class _DayLabel extends StatelessWidget {
  final DateTime? at;
  const _DayLabel({required this.at});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    if (at == null) return const SizedBox.shrink();
    final local = at!.toLocal();
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(local.year, local.month, local.day);
    final label = day == today
        ? 'Today'
        : day == today.subtract(const Duration(days: 1))
            ? 'Yesterday'
            : DateFormat('EEE d MMM').format(local);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Text(label, style: AppTypography.bodySmall(colors.textMuted)),
    );
  }
}

class _Bubble extends StatelessWidget {
  final ChatMessage message;
  final bool mine;
  const _Bubble({required this.message, required this.mine});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final bg = mine ? colors.accent : colors.surface;
    final fg = mine ? colors.onAccent : colors.textPrimary;
    final time = message.at == null ? '' : DateFormat('h:mm a').format(message.at!.toLocal());
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 3),
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 8),
          decoration: BoxDecoration(
            color: bg,
            border: mine ? null : Border.all(color: colors.border),
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(18),
              topRight: const Radius.circular(18),
              bottomLeft: Radius.circular(mine ? 18 : 4),
              bottomRight: Radius.circular(mine ? 4 : 18),
            ),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Align(
              alignment: Alignment.centerLeft,
              child: Text(message.text, style: AppTypography.bodyMedium(fg).copyWith(fontSize: 15, height: 1.35)),
            ),
            const SizedBox(height: 2),
            Text(time, style: AppTypography.bodySmall(mine ? fg.withValues(alpha: 0.7) : colors.textMuted).copyWith(fontSize: 11)),
          ]),
        ),
      ),
    );
  }
}
