/**
 * Messages Screen
 * Lists mock conversations (MockData.conversations). Tapping one opens the
 * shared ChatScreen — the same screen used by Duty Details' "Interested / Chat".
 */

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/mock_data.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/widgets/state_views.dart';

class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key});

  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  Future<void> _openConversation(Map<String, dynamic> conversation) async {
    await context.push('/chat', extra: conversation);
    if (mounted) setState(() {}); // Refresh last message / unread state.
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final conversations = MockData.conversations;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text('Messages', style: AppTypography.headingMedium(colors.textPrimary)),
      ),
      body: SafeArea(
        child: conversations.isEmpty
            ? const EmptyStateView(
                icon: Icons.chat_bubble_outline_rounded,
                title: 'No conversations yet',
                description: 'Chats you start from a duty post will appear here.',
              )
            : ListView.separated(
                itemCount: conversations.length,
                separatorBuilder: (_, __) => const Divider(height: 1, indent: 76),
                itemBuilder: (context, index) => _buildConversationTile(conversations[index]),
              ),
      ),
    );
  }

  Widget _buildConversationTile(Map<String, dynamic> conversation) {
    final colors = context.appColors;
    final unreadCount = conversation['unreadCount'] as int;
    final isUnread = unreadCount > 0;

    return InkWell(
      onTap: () => _openConversation(conversation),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: AppColors.primary.withOpacity(0.12),
              child: const Icon(Icons.local_hospital_rounded, color: AppColors.primary, size: 22),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          conversation['hospitalName'] as String,
                          style: AppTypography.labelBold(colors.textPrimary),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        conversation['lastMessageTime'] as String,
                        style: AppTypography.bodySmall(
                          isUnread ? AppColors.primary : colors.textMuted,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          conversation['lastMessage'] as String,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: isUnread
                              ? AppTypography.bodyMedium(colors.textPrimary).copyWith(fontWeight: FontWeight.w600)
                              : AppTypography.bodyMedium(colors.textSecondary),
                        ),
                      ),
                      if (isUnread) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: const BoxDecoration(
                            color: AppColors.primary,
                            borderRadius: BorderRadius.all(Radius.circular(AppSpacing.radiusPill)),
                          ),
                          child: Text(
                            '$unreadCount',
                            style: AppTypography.bodySmall(Colors.white).copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
