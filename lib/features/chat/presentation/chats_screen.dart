// Conversation list. Doctors see their threads with hospitals; hospital staff
// (organizationId set) see the hospital's threads with doctors.

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/ui_kit.dart';
import '../data/chat_repository.dart';

class ChatsScreen extends StatelessWidget {
  final String? organizationId;
  final String? organizationName;

  const ChatsScreen({super.key, this.organizationId, this.organizationName});

  ChatSide get _side => organizationId == null ? ChatSide.doctor : ChatSide.organization;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final stream = organizationId == null ? ChatRepository.watchDoctorThreads() : ChatRepository.watchOrgThreads(organizationId!);
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: Text(organizationName == null ? 'Chats' : '$organizationName · Chats')),
      body: SafeArea(
        child: StreamBuilder<List<ChatThread>>(
          stream: stream,
          builder: (context, snap) {
            if (snap.hasError) {
              return const ErrorView(message: 'Could not load your chats. Check your connection and try again.');
            }
            if (!snap.hasData) return const LoadingView();
            final threads = snap.data!;
            if (threads.isEmpty) {
              return EmptyStateView(
                icon: Icons.chat_bubble_outline,
                title: 'No chats yet',
                description: _side == ChatSide.doctor
                    ? 'Apply to a duty, then message the hospital from the duty page.'
                    : 'Message an applicant from "Review applicants" on any duty.',
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, AppSpacing.lg),
              itemCount: threads.length,
              separatorBuilder: (_, __) => Divider(height: 1, color: colors.border),
              itemBuilder: (context, i) => ChatThreadTile(thread: threads[i], viewer: _side),
            );
          },
        ),
      ),
    );
  }
}

String chatTimeLabel(DateTime? at) {
  if (at == null) return '';
  final local = at.toLocal();
  final now = DateTime.now();
  if (local.year == now.year && local.month == now.month && local.day == now.day) return DateFormat('h:mm a').format(local);
  if (now.difference(local).inDays < 7) return DateFormat('EEE').format(local);
  return DateFormat('d MMM').format(local);
}

class ChatThreadTile extends StatelessWidget {
  final ChatThread thread;
  final ChatSide viewer;

  const ChatThreadTile({super.key, required this.thread, required this.viewer});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final unread = thread.unreadFor(viewer);
    final name = thread.counterpartName(viewer);
    final fromMe = thread.lastSenderSide == viewer.key;
    final initials = name.replaceAll(RegExp(r'^Dr\.?\s*'), '').split(RegExp(r'\s+')).where((p) => p.isNotEmpty)
        .take(2).map((p) => p[0].toUpperCase()).join();
    return InkWell(
      onTap: () => context.push('/chat', extra: {'conversationId': thread.id, 'side': viewer.key, 'title': name}),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CircleAvatar(
            radius: 22,
            backgroundColor: colors.surfaceElevated,
            child: Text(initials, style: AppTypography.labelBold(colors.textPrimary)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: AppTypography.labelBold(colors.textPrimary).copyWith(fontSize: 15)),
                ),
                Text(chatTimeLabel(thread.lastAt),
                    style: AppTypography.bodySmall(unread > 0 ? colors.textPrimary : colors.textMuted)),
              ]),
              if (thread.dutyTitle != null) ...[
                const SizedBox(height: 2),
                Text(thread.dutyTitle!, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: AppTypography.bodySmall(colors.textMuted)),
              ],
              const SizedBox(height: 4),
              Row(children: [
                Expanded(
                  child: Text(
                    '${fromMe ? 'You: ' : ''}${thread.lastText ?? 'No messages yet'}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.bodyMedium(unread > 0 ? colors.textPrimary : colors.textSecondary).copyWith(fontSize: 14),
                  ),
                ),
                if (thread.isDemo) ...[
                  const SizedBox(width: 8),
                  const _SampleTag(),
                ],
                if (unread > 0) ...[
                  const SizedBox(width: 8),
                  CountBadge(count: unread, color: AppColors.emerald),
                ],
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _SampleTag extends StatelessWidget {
  const _SampleTag();

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        border: Border.all(color: colors.border),
        borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
      ),
      child: Text('Sample', style: AppTypography.bodySmall(colors.textMuted).copyWith(fontSize: 11)),
    );
  }
}

/// Chat entry point with an unread badge (doctor side by default).
class ChatButton extends StatelessWidget {
  final String? organizationId;
  final String? organizationName;

  const ChatButton({super.key, this.organizationId, this.organizationName});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<int>(
      stream: ChatRepository.watchUnread(organizationId: organizationId),
      builder: (context, snap) {
        final count = snap.data ?? 0;
        return CircleIconButton(
          icon: Icons.chat_bubble_outline,
          tooltip: 'Chats',
          onPressed: () => context.push('/chats', extra: {
            if (organizationId != null) 'organizationId': organizationId!,
            if (organizationName != null) 'organizationName': organizationName!,
          }),
          badge: count > 0 ? CountBadge(count: count, color: AppColors.emerald) : null,
        );
      },
    );
  }
}
