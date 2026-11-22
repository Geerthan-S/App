// Hospital: request the last-minute confirmation service for a duty that
// starts soon. Shown on open duties; the server decides final eligibility.

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../data/business_repository.dart';
import 'hospital_payments_screen.dart';

class LastMinuteButton extends StatefulWidget {
  final Map<String, dynamic> duty;

  const LastMinuteButton({super.key, required this.duty});

  /// Open duties that start within a day are offered the service.
  static bool applies(Map<String, dynamic> duty) {
    if (!const ['published', 'early_access'].contains(duty['status'])) return false;
    if ((duty['remainingHeadcount'] as num? ?? 0) <= 0) return false;
    final start = DateTime.tryParse(duty['startAtIso'] as String? ?? '');
    if (start == null) return false;
    final hours = start.difference(DateTime.now()).inMinutes / 60;
    return hours > 1 && hours <= 24;
  }

  @override
  State<LastMinuteButton> createState() => _LastMinuteButtonState();
}

class _LastMinuteButtonState extends State<LastMinuteButton> {
  bool _busy = false;

  Future<void> _request() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Last-minute confirmation'),
        content: const Text(
          'We alert doctors on our private standby list for this date. The first to accept is confirmed and '
          'contacts are shared. If nobody accepts before the search closes, the full charge is refunded.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Continue')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      final result = await BusinessRepository.requestLastMinute(widget.duty['dutyId'] as String);
      if (!mounted) return;
      final breakdown = result['breakdown'] as Map? ?? const {};
      await showModalBottomSheet<void>(
        context: context,
        useSafeArea: true,
        isScrollControlled: true,
        builder: (ctx) => Padding(
          padding: const EdgeInsets.all(AppSpacing.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(result['status'] == 'searching' ? 'Searching the standby list' : 'Pay to start the search',
                  style: AppTypography.headingSmall(ctx.appColors.textPrimary)),
              const SizedBox(height: AppSpacing.sm),
              if (result['orderId'] != null)
                OrderCard(order: {
                  'orderId': result['orderId'],
                  'description': 'Last-minute confirmation',
                  'status': 'awaiting_payment',
                  'breakdown': breakdown,
                  'totalPaise': breakdown['totalPaise'],
                  'instructions': result['instructions'],
                })
              else
                const Text('Standby doctors are being alerted now.'),
              const SizedBox(height: AppSpacing.sm),
              Text(result['terms'] as String? ?? '', style: AppTypography.bodySmall(ctx.appColors.textMuted)),
              const SizedBox(height: AppSpacing.md),
            ],
          ),
        ),
      );
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(backgroundColor: AppColors.rose, content: Text(e.message ?? 'Not available.')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      icon: _busy
          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
          : const Icon(Icons.bolt_outlined, size: 18),
      label: const Text('Need a doctor fast?'),
      onPressed: _busy ? null : _request,
    );
  }
}
