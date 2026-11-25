// A hospital's payment orders: duty bookings and last-minute charges, with the
// charge breakdown and (in manual mode) the platform's payment instructions.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_badge.dart';
import '../data/business_repository.dart';

class HospitalPaymentsScreen extends StatelessWidget {
  final String organizationId;

  const HospitalPaymentsScreen({super.key, required this.organizationId});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: const Text('Payments')),
      body: StreamBuilder<List<Map<String, dynamic>>>(
        stream: BusinessRepository.watchOrgOrders(organizationId),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) return const LoadingView();
          final orders = snap.data ?? const [];
          if (orders.isEmpty) {
            return const EmptyStateView(
              icon: Icons.receipt_long_outlined,
              title: 'No payments yet',
              description: 'Payments for confirmed duties and last-minute requests appear here.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            itemCount: orders.length,
            separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
            itemBuilder: (context, i) => OrderCard(order: orders[i]),
          );
        },
      ),
    );
  }
}

/// One payment order with its lines and, while unpaid, how to pay.
class OrderCard extends StatelessWidget {
  final Map<String, dynamic> order;

  const OrderCard({super.key, required this.order});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final lines = List<Map<dynamic, dynamic>>.from((order['breakdown'] as Map?)?['lines'] as List? ?? const []);
    final status = order['status'] as String? ?? 'awaiting_payment';
    final instructions = order['instructions'] as String? ?? '';
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(order['description'] as String? ?? 'Order', style: AppTypography.labelBold(colors.textPrimary))),
              StatusBadge(status: status),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Expanded(child: Text(l['label'] as String? ?? '', style: AppTypography.bodySmall(colors.textSecondary))),
                  Text(formatPaise(l['amountPaise']), style: AppTypography.bodySmall(colors.textPrimary)),
                ],
              ),
            ),
          Divider(color: colors.border),
          Row(
            children: [
              Expanded(child: Text('Total', style: AppTypography.labelBold(colors.textPrimary))),
              Text(formatPaise(order['totalPaise']), style: AppTypography.labelBold(colors.textPrimary)),
            ],
          ),
          if (status == 'awaiting_payment') ...[
            const SizedBox(height: AppSpacing.sm),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.sm),
              decoration: BoxDecoration(
                color: colors.accentSoft,
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('How to pay', style: AppTypography.labelBold(colors.textPrimary)),
                  const SizedBox(height: 4),
                  SelectableText(
                    instructions.isNotEmpty ? instructions : 'The HealthForce team will share payment details with you.',
                    style: AppTypography.bodySmall(colors.textPrimary),
                  ),
                  const SizedBox(height: 4),
                  Text('Mention reference ${order['orderId']} with your payment.', style: AppTypography.bodySmall(colors.textMuted)),
                  TextButton.icon(
                    icon: const Icon(Icons.copy, size: 16),
                    label: const Text('Copy reference'),
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: order['orderId'] as String));
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Reference copied')));
                    },
                  ),
                ],
              ),
            ),
          ],
          if (status == 'refund_due')
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: Text('Refund in progress.', style: AppTypography.bodySmall(AppColors.amber)),
            ),
        ],
      ),
    );
  }
}
