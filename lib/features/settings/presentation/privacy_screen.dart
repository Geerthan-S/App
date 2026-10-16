// Your data: export, correction requests and account deletion (blueprint §8.5).

import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../auth/data/auth_repository.dart';
import '../data/account_repository.dart';

class PrivacyScreen extends StatefulWidget {
  const PrivacyScreen({super.key});

  @override
  State<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends State<PrivacyScreen> {
  bool _exporting = false;

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _export() async {
    setState(() => _exporting = true);
    try {
      final data = await AccountRepository.exportMyData();
      final bytes = Uint8List.fromList(utf8.encode(const JsonEncoder.withIndent('  ').convert(data)));
      final stamp = DateFormat('yyyyMMdd-HHmm').format(DateTime.now());
      final path = await FilePicker.platform.saveFile(
        dialogTitle: 'Save your HealthForce data',
        fileName: 'healthforce-data-$stamp.json',
        bytes: bytes,
      );
      _toast(path == null ? 'Export cancelled' : 'Your data was saved');
    } catch (e) {
      _toast(callableErrorMessage(e, 'Could not export your data. Try again later.'));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _request() async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _PrivacyRequestSheet(),
    );
    if (sent == true) _toast('Request sent. Our team replies within 7 days.');
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(context: context, builder: (_) => const _DeleteDialog());
    if (confirmed != true || !mounted) return;
    try {
      await AccountRepository.deleteMyAccount();
      try {
        await AuthRepository().signOut();
      } catch (_) {
        // The account is already gone server-side; local sign-out may fail harmlessly.
      }
      if (mounted) context.go('/login');
    } catch (e) {
      _toast(callableErrorMessage(e, 'Could not delete your account.'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: const Text('Your data')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, AppSpacing.lg),
          children: [
            const GroupLabel('Your rights'),
            RowGroup(children: [
              ListRow(
                icon: Icons.download_outlined,
                title: 'Download a copy',
                subtitle: 'Profile, applications, duties, reviews and notifications as JSON',
                trailing: _exporting
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : null,
                onTap: _exporting ? null : _export,
              ),
              ListRow(
                icon: Icons.edit_note_outlined,
                title: 'Correct or restrict data',
                subtitle: 'Ask our team to fix something or limit how it is used',
                onTap: _request,
              ),
            ]),
            const SizedBox(height: AppSpacing.lg),
            const GroupLabel('Delete account'),
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Text(
                'Deleting removes your profile, saved searches and open applications and signs you out everywhere. '
                'Verification decisions, completed duty records and audit logs are kept as the law requires, '
                'with your name removed. You cannot delete while you hold an upcoming duty or are a hospital\'s only owner.',
                style: AppTypography.bodySmall(colors.textSecondary),
              ),
            ),
            AppSecondaryButton(
              label: 'Delete my account',
              icon: Icons.delete_outline,
              foregroundColor: AppColors.rose,
              onPressed: _delete,
            ),
          ],
        ),
      ),
    );
  }
}

class _PrivacyRequestSheet extends StatefulWidget {
  const _PrivacyRequestSheet();

  @override
  State<_PrivacyRequestSheet> createState() => _PrivacyRequestSheetState();
}

class _PrivacyRequestSheetState extends State<_PrivacyRequestSheet> {
  final _details = TextEditingController();
  String _type = 'correction';
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_details.text.trim().length < 10) {
      setState(() => _error = 'Describe what you need (at least 10 characters)');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await AccountRepository.submitPrivacyRequest(type: _type, details: _details.text.trim());
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() {
        _sending = false;
        _error = callableErrorMessage(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.gutter, 0, AppSpacing.gutter, MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Privacy request', style: AppTypography.headingMedium(colors.textPrimary)),
          const SizedBox(height: AppSpacing.md),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'correction', label: Text('Correct')),
              ButtonSegment(value: 'restriction', label: Text('Restrict')),
              ButtonSegment(value: 'other', label: Text('Other')),
            ],
            selected: {_type},
            onSelectionChanged: (s) => setState(() => _type = s.first),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _details,
            maxLines: 5,
            maxLength: 2000,
            decoration: InputDecoration(
              hintText: 'What should we change, and where does it appear?',
              errorText: _error,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          AppButton(label: 'Send request', isLoading: _sending, onPressed: _sending ? null : _send),
        ],
      ),
    );
  }
}

class _DeleteDialog extends StatefulWidget {
  const _DeleteDialog();

  @override
  State<_DeleteDialog> createState() => _DeleteDialogState();
}

class _DeleteDialogState extends State<_DeleteDialog> {
  final _confirm = TextEditingController();

  @override
  void dispose() {
    _confirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ready = _confirm.text.trim() == 'DELETE';
    return AlertDialog(
      title: const Text('Delete your account?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('This cannot be undone. Type DELETE to confirm.'),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            controller: _confirm,
            autofocus: true,
            textCapitalization: TextCapitalization.characters,
            onChanged: (_) => setState(() {}),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        TextButton(
          onPressed: ready ? () => Navigator.pop(context, true) : null,
          style: TextButton.styleFrom(foregroundColor: AppColors.rose),
          child: const Text('Delete'),
        ),
      ],
    );
  }
}
