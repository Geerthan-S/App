// Hospital side of QR attendance: confirmed and in-progress shifts with
// "Show check-in / check-out code", flagged discrepancies to acknowledge, and
// "Mark complete". Also links to the hospital's payments.

import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/ui_kit.dart';
import '../data/business_repository.dart';
import 'hospital_payments_screen.dart';

class HospitalShiftsSection extends StatelessWidget {
  final String organizationId;

  const HospitalShiftsSection({super.key, required this.organizationId});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text('Active Shifts', style: AppTypography.headingSmall(colors.textPrimary))),
            TextButton.icon(
              icon: const Icon(Icons.account_balance_wallet_outlined, size: 18),
              label: const Text('Payments'),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => HospitalPaymentsScreen(organizationId: organizationId),
              )),
            ),
          ],
        ),
        Text('Show the QR code when the doctor arrives and when they leave.',
            style: AppTypography.bodySmall(colors.textMuted)),
        const SizedBox(height: AppSpacing.sm),
        StreamBuilder<List<Map<String, dynamic>>>(
          stream: BusinessRepository.watchActiveShifts(organizationId),
          builder: (context, snap) {
            final shifts = snap.data ?? const [];
            if (shifts.isEmpty) {
              return AppCard(child: Text('No confirmed shifts right now.', style: AppTypography.bodyMedium(colors.textMuted)));
            }
            return Column(
              children: [
                for (final s in shifts) ...[
                  _ShiftCard(shift: s),
                  const SizedBox(height: AppSpacing.sm),
                ],
              ],
            );
          },
        ),
      ],
    );
  }
}

class _ShiftCard extends StatelessWidget {
  final Map<String, dynamic> shift;

  const _ShiftCard({required this.shift});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final assignmentId = shift['assignmentId'] as String;
    final terms = shift['termsSnapshot'] as Map? ?? const {};
    final start = parseIsoLocal(terms['startAt']);
    final status = shift['status'] as String? ?? 'confirmed';
    return AppCard(
      child: StreamBuilder<Map<String, dynamic>?>(
        stream: BusinessRepository.watchAttendance(assignmentId),
        builder: (context, snap) {
          final attendance = snap.data;
          final checkedIn = attendance?['checkIn'] != null;
          final checkedOut = attendance?['checkOut'] != null;
          final pending = List<Map<dynamic, dynamic>>.from(attendance?['pendingDiscrepancies'] as List? ?? const []);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(shift['doctorName'] as String? ?? 'Doctor', style: AppTypography.labelBold(colors.textPrimary)),
                        Text(
                          '${shift['specialtyName'] ?? ''} · ${start != null ? formatDayTime(start) : ''}',
                          style: AppTypography.bodySmall(colors.textMuted),
                        ),
                      ],
                    ),
                  ),
                  StatusBadge(status: status),
                ],
              ),
              if (checkedIn) ...[
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'In: ${_time(attendance!['checkIn'])}${checkedOut ? '   Out: ${_time(attendance['checkOut'])}' : ''}',
                  style: AppTypography.bodySmall(colors.textSecondary),
                ),
              ],
              if (pending.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.sm),
                Container(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.amber.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Needs your acknowledgement', style: AppTypography.labelBold(AppColors.amber)),
                      for (final p in pending)
                        Text('• ${p['text']}', style: AppTypography.bodySmall(colors.textPrimary)),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: () => _acknowledge(context, assignmentId),
                          child: const Text('Acknowledge'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: AppSpacing.xs,
                runSpacing: AppSpacing.xs,
                children: [
                  if (status == 'confirmed')
                    OutlinedButton.icon(
                      icon: const Icon(Icons.qr_code_2, size: 18),
                      label: const Text('Show check-in code'),
                      onPressed: () => AttendanceQrSheet.show(context, assignmentId: assignmentId, checkIn: true),
                    ),
                  if (status == 'in_progress' && !checkedOut)
                    OutlinedButton.icon(
                      icon: const Icon(Icons.qr_code_2, size: 18),
                      label: const Text('Show check-out code'),
                      onPressed: () => AttendanceQrSheet.show(context, assignmentId: assignmentId, checkIn: false),
                    ),
                  if (status == 'in_progress')
                    TextButton(
                      onPressed: () => _complete(context, assignmentId),
                      child: const Text('Mark complete'),
                    ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }

  String _time(Object? record) {
    final iso = (record as Map?)?['atIso'];
    final dt = parseIsoLocal(iso);
    return dt == null ? '—' : formatTime(dt);
  }

  Future<void> _acknowledge(BuildContext context, String assignmentId) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Acknowledge attendance'),
        content: TextField(controller: note, decoration: const InputDecoration(hintText: 'Optional note, e.g. traffic delay')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Acknowledge')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await BusinessRepository.acknowledgeAttendance(assignmentId, note: note.text.trim());
    } on FirebaseFunctionsException catch (e) {
      if (context.mounted) _snack(context, e.message ?? 'Could not save.');
    }
  }

  Future<void> _complete(BuildContext context, String assignmentId) async {
    try {
      await BusinessRepository.completeAssignment(assignmentId);
      if (context.mounted) _snack(context, 'Shift marked complete.');
    } on FirebaseFunctionsException catch (e) {
      if (context.mounted) _snack(context, e.message ?? 'Could not complete.');
    }
  }
}

void _snack(BuildContext context, String message) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

/// Full-screen QR code that renews itself before it expires.
class AttendanceQrSheet extends StatefulWidget {
  final String assignmentId;
  final bool checkIn;

  const AttendanceQrSheet({super.key, required this.assignmentId, required this.checkIn});

  static Future<void> show(BuildContext context, {required String assignmentId, required bool checkIn}) =>
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (_) => AttendanceQrSheet(assignmentId: assignmentId, checkIn: checkIn),
      );

  @override
  State<AttendanceQrSheet> createState() => _AttendanceQrSheetState();
}

class _AttendanceQrSheetState extends State<AttendanceQrSheet> {
  String? _code;
  DateTime? _expiresAt;
  String? _error;
  Timer? _timer;
  StreamSubscription<Map<String, dynamic>?>? _attendance;

  @override
  void initState() {
    super.initState();
    _issue();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      final exp = _expiresAt;
      if (exp != null && exp.difference(DateTime.now()).inSeconds <= 5) _issue();
      setState(() {});
    });
    // Close automatically once the doctor's scan is recorded.
    _attendance = BusinessRepository.watchAttendance(widget.assignmentId).listen((a) {
      final done = widget.checkIn ? (a?['checkIn'] != null) : (a?['checkOut'] != null);
      if (done && mounted) {
        Navigator.of(context).pop();
        _snack(context, widget.checkIn ? 'Doctor checked in.' : 'Doctor checked out.');
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _attendance?.cancel();
    super.dispose();
  }

  bool _issuing = false;

  Future<void> _issue() async {
    if (_issuing) return;
    _issuing = true;
    try {
      final result = await BusinessRepository.issueAttendanceCode(widget.assignmentId, checkIn: widget.checkIn);
      if (!mounted) return;
      setState(() {
        _code = result['code'] as String;
        _expiresAt = DateTime.tryParse(result['expiresAt'] as String? ?? '')?.toLocal();
        _error = null;
      });
    } on FirebaseFunctionsException catch (e) {
      if (mounted) setState(() => _error = e.message ?? 'Could not create a code.');
      _timer?.cancel();
    } finally {
      _issuing = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final secondsLeft = _expiresAt?.difference(DateTime.now()).inSeconds;
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.gutter),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SheetHeader(
            title: widget.checkIn ? 'Check-in code' : 'Check-out code',
            subtitle: 'Ask the doctor to scan this in the HealthForce app.',
            onClose: () => Navigator.pop(context),
          ),
          const SizedBox(height: AppSpacing.lg),
          if (_error != null)
            Text(_error!, style: AppTypography.bodyMedium(AppColors.rose), textAlign: TextAlign.center)
          else if (_code == null)
            const Padding(padding: EdgeInsets.all(AppSpacing.xl), child: CircularProgressIndicator())
          else ...[
            Container(
              color: Colors.white,
              padding: const EdgeInsets.all(AppSpacing.md),
              child: QrImageView(data: _code!, size: 260, backgroundColor: Colors.white),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              secondsLeft != null && secondsLeft > 0 ? 'Renews in ${secondsLeft}s' : 'Renewing…',
              style: AppTypography.bodySmall(colors.textMuted),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
        ],
      ),
    );
  }
}
