/**
 * Chat Screen
 * Shown from Duty Details ("Interested / Chat") and from tapping a
 * conversation on the Messages list. Reuses MockData.duties /
 * MockData.conversations / MockData.chatMessages — no new data model.
 */

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/mock_data.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';

class ChatScreen extends StatefulWidget {
  final Map<String, dynamic> conversation;

  const ChatScreen({super.key, required this.conversation});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _inputController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  late final String _conversationId = widget.conversation['conversationId'] as String;

  Map<String, dynamic>? get _duty {
    for (final duty in MockData.duties) {
      if (duty['dutyId'] == widget.conversation['dutyId']) return duty;
    }
    return null;
  }

  List<Map<String, dynamic>> get _messages =>
      MockData.chatMessages[_conversationId] ?? const [];

  List<String> get _quickReplies {
    final duty = _duty;
    if (duty == null) {
      return const [
        'Is this still available?',
        'Is the pay negotiable?',
        'Can you share the exact location?',
        'What are the shift timings?',
      ];
    }

    final city = duty['city'] as String? ?? 'the city';
    final amount = duty['amount'];

    return [
      'Is this duty still available?',
      if (amount != null) 'Is the ₹$amount rate negotiable?',
      'How far is this from $city city center?',
      'Can you share the exact address?',
      'What are the exact shift timings?',
    ];
  }

  @override
  void initState() {
    super.initState();
    // Opening the conversation marks it as read.
    widget.conversation['unreadCount'] = 0;
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom(animate: false));
  }

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom({bool animate = true}) {
    if (!_scrollController.hasClients) return;
    final target = _scrollController.position.maxScrollExtent;
    if (animate) {
      _scrollController.animateTo(target, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    } else {
      _scrollController.jumpTo(target);
    }
  }

  void _sendMessage([String? presetText]) {
    final text = (presetText ?? _inputController.text).trim();
    if (text.isEmpty) return;

    final message = {
      'sender': 'doctor',
      'text': text,
      'time': DateFormat('hh:mm a').format(DateTime.now()),
    };

    setState(() {
      MockData.chatMessages.putIfAbsent(_conversationId, () => []).add(message);
      widget.conversation['lastMessage'] = text;
      widget.conversation['lastMessageTime'] = message['time'];
      if (presetText == null) _inputController.clear();
    });

    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final duty = _duty;
    final hospitalName = widget.conversation['hospitalName'] as String;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: AppColors.primary.withOpacity(0.12),
              child: const Icon(Icons.local_hospital_rounded, color: AppColors.primary, size: 18),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    hospitalName,
                    style: AppTypography.labelBold(colors.textPrimary),
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    'Duty Coordinator',
                    style: AppTypography.bodySmall(colors.textMuted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (duty != null) _buildDutyContextCard(duty),
            Expanded(
              child: _messages.isEmpty
                  ? Center(
                      child: Text(
                        'Say hello to start the conversation.',
                        style: AppTypography.bodyMedium(colors.textMuted),
                      ),
                    )
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                      itemCount: _messages.length,
                      itemBuilder: (context, index) => _buildMessageBubble(_messages[index]),
                    ),
            ),
            _buildQuickReplies(),
            _buildInputBar(),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickReplies() {
    final colors = context.appColors;
    final suggestions = _quickReplies;
    if (suggestions.isEmpty) return const SizedBox.shrink();

    return Container(
      color: colors.surface,
      padding: const EdgeInsets.only(top: 8),
      child: SizedBox(
        height: 36,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          itemCount: suggestions.length,
          separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.xs),
          itemBuilder: (context, index) {
            final suggestion = suggestions[index];
            return InkWell(
              onTap: () => _sendMessage(suggestion),
              borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: colors.surfaceElevated,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
                  border: Border.all(color: colors.border),
                ),
                child: Text(
                  suggestion,
                  maxLines: 1,
                  softWrap: false,
                  style: AppTypography.bodySmall(AppColors.primary),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildDutyContextCard(Map<String, dynamic> duty) {
    final colors = context.appColors;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: colors.surfaceElevated,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        children: [
          const Icon(Icons.medical_services_outlined, color: AppColors.primaryLight, size: 20),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${duty['specialtyName']} • ${duty['shiftType']}',
                  style: AppTypography.labelBold(colors.textPrimary),
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  '${duty['startAt']} - ${duty['endAt']}',
                  style: AppTypography.bodySmall(colors.textMuted),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          Text(
            '₹${duty['amount']}',
            style: AppTypography.labelBold(AppColors.emerald),
          ),
        ],
      ),
    );
  }

  Widget _buildMessageBubble(Map<String, dynamic> message) {
    final colors = context.appColors;
    final isDoctor = message['sender'] == 'doctor';

    return Align(
      alignment: isDoctor ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 280),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isDoctor ? AppColors.primary : colors.surfaceElevated,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(AppSpacing.radiusMd),
            topRight: const Radius.circular(AppSpacing.radiusMd),
            bottomLeft: Radius.circular(isDoctor ? AppSpacing.radiusMd : 2),
            bottomRight: Radius.circular(isDoctor ? 2 : AppSpacing.radiusMd),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              message['text'] as String,
              style: AppTypography.bodyMedium(isDoctor ? Colors.white : colors.textPrimary),
            ),
            const SizedBox(height: 2),
            Text(
              message['time'] as String,
              style: AppTypography.bodySmall(isDoctor ? Colors.white.withOpacity(0.75) : colors.textMuted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInputBar() {
    final colors = context.appColors;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: colors.surfaceElevated,
                borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
                border: Border.all(color: colors.border),
              ),
              child: TextField(
                controller: _inputController,
                minLines: 1,
                maxLines: 4,
                textCapitalization: TextCapitalization.sentences,
                style: AppTypography.bodyMedium(colors.textPrimary),
                decoration: InputDecoration(
                  hintText: 'Type a message...',
                  hintStyle: AppTypography.bodyMedium(colors.textMuted),
                  border: InputBorder.none,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                ),
                onSubmitted: (_) => _sendMessage(),
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          GestureDetector(
            onTap: _sendMessage,
            child: Container(
              width: 44,
              height: 44,
              decoration: const BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.send_rounded, color: Colors.white, size: 20),
            ),
          ),
        ],
      ),
    );
  }
}
