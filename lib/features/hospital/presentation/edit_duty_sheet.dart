// Edit a posted duty (blueprint §4.4). Only changed fields are sent; the
// server versions the change, refuses pay/schedule edits once a doctor holds a
// seat, and notifies open applicants of material changes.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../settings/data/account_repository.dart';
import '../data/hospital_repository.dart';

class EditDutySheet extends StatefulWidget {
  final Map<String, dynamic> duty;

  const EditDutySheet({super.key, required this.duty});

  /// Returns a confirmation message when the duty was saved.
  static Future<String?> show(BuildContext context, Map<String, dynamic> duty) => showModalBottomSheet<String>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => EditDutySheet(duty: duty),
      );

  @override
  State<EditDutySheet> createState() => _EditDutySheetState();
}

class _EditDutySheetState extends State<EditDutySheet> {
  late final _department = TextEditingController(text: widget.duty['department'] as String? ?? '');
  late final _amount = TextEditingController(text: '${widget.duty['amount'] ?? ''}');
  late final _headcount = TextEditingController(text: '${widget.duty['headcount'] ?? 1}');
  late final _notes = TextEditingController(text: widget.duty['notes'] as String? ?? '');
  late DateTime? _start = _parse(widget.duty['startAtIso']);
  late DateTime? _end = _parse(widget.duty['endAtIso']);
  bool _saving = false;
  String? _error;

  static DateTime? _parse(Object? iso) => iso is String ? DateTime.tryParse(iso)?.toLocal() : null;

  @override
  void dispose() {
    _department.dispose();
    _amount.dispose();
    _headcount.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _pick(bool isStart) async {
    final base = (isStart ? _start : _end) ?? DateTime.now().add(const Duration(days: 1));
    final date = await showDatePicker(
      context: context,
      initialDate: base,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(base));
    if (time == null) return;
    final picked = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    setState(() {
      if (isStart) {
        final length = (_start != null && _end != null) ? _end!.difference(_start!) : const Duration(hours: 8);
        _start = picked;
        _end = picked.add(length);
      } else {
        _end = picked;
      }
    });
  }

  String _shiftTypeFor(DateTime start, DateTime end) {
    if (end.difference(start).inHours >= 12) return 'full_day';
    if (start.hour >= 19 || start.hour < 5) return 'night';
    if (start.hour >= 13) return 'evening';
    return 'morning';
  }

  Map<String, dynamic> _changes() {
    final d = widget.duty;
    final changes = <String, dynamic>{};
    final department = _department.text.trim();
    if (department != d['department']) changes['department'] = department;
    final notes = _notes.text.trim();
    if (notes != (d['notes'] ?? '')) changes['notes'] = notes;
    final headcount = int.tryParse(_headcount.text.trim());
    if (headcount == null || headcount < 1) throw const FormatException('Seats must be a whole number of at least 1');
    if (headcount != d['headcount']) changes['headcount'] = headcount;
    final amount = num.tryParse(_amount.text.trim());
    if (amount == null || amount <= 0) throw const FormatException('Enter the pay amount');
    if (amount != d['amount']) {
      changes['paymentTerms'] = {
        'amount': amount,
        'currency': 'INR',
        'basis': d['basis'] ?? 'per_shift',
        'expectedPaymentTiming': d['expectedPaymentTiming'] ?? 'end_of_shift',
      };
    }
    final start = _start;
    final end = _end;
    if (start != null && end != null) {
      final startIso = start.toUtc().toIso8601String();
      final endIso = end.toUtc().toIso8601String();
      final moved = _parse(d['startAtIso']) != start || _parse(d['endAtIso']) != end;
      if (moved) {
        changes['schedule'] = {'startAt': startIso, 'endAt': endIso, 'shiftType': _shiftTypeFor(start, end)};
      }
    }
    return changes;
  }

  Future<void> _save() async {
    Map<String, dynamic> changes;
    try {
      changes = _changes();
    } on FormatException catch (e) {
      setState(() => _error = e.message);
      return;
    }
    if (changes.isEmpty) {
      Navigator.pop(context);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await HospitalRepository.updateDuty(
        dutyId: widget.duty['dutyId'] as String,
        expectedVersion: (widget.duty['version'] as num?)?.toInt() ?? 1,
        changes: changes,
      );
      final notified = (result['applicantsNotified'] as num?)?.toInt() ?? 0;
      if (mounted) {
        Navigator.pop(context, notified > 0 ? 'Duty updated. $notified applicant(s) were told what changed.' : 'Duty updated');
      }
    } catch (e) {
      setState(() {
        _saving = false;
        _error = callableErrorMessage(e, 'Could not save the duty.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final fmt = DateFormat('EEE d MMM, h:mm a');
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.gutter, 0, AppSpacing.gutter, MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Edit duty', style: AppTypography.headingMedium(colors.textPrimary)),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Applicants are notified when pay, timing or requirements change. Pay and timing lock once a doctor is selected.',
              style: AppTypography.bodySmall(colors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(controller: _department, decoration: const InputDecoration(labelText: 'Department')),
            const SizedBox(height: AppSpacing.sm),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: _amount,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: 'Pay (₹ ${widget.duty['basis'] == 'per_hour' ? 'per hour' : 'per shift'})',
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              SizedBox(
                width: 96,
                child: TextField(
                  controller: _headcount,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Seats'),
                ),
              ),
            ]),
            const SizedBox(height: AppSpacing.sm),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.play_circle_outline),
              title: const Text('Starts'),
              subtitle: Text(_start == null ? 'Not set' : fmt.format(_start!)),
              onTap: () => _pick(true),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.stop_circle_outlined),
              title: const Text('Ends'),
              subtitle: Text(_end == null ? 'Not set' : fmt.format(_end!)),
              onTap: () => _pick(false),
            ),
            TextField(
              controller: _notes,
              maxLines: 3,
              maxLength: 1000,
              decoration: const InputDecoration(labelText: 'Notes for doctors'),
            ),
            if (_error != null) ...[
              Text(_error!, style: AppTypography.bodySmall(AppColors.rose)),
              const SizedBox(height: AppSpacing.sm),
            ],
            AppButton(label: 'Save changes', isLoading: _saving, onPressed: _saving ? null : _save),
          ],
        ),
      ),
    );
  }
}
