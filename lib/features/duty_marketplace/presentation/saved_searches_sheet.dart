// Save the current marketplace filter and manage alerts for saved searches.

import 'package:flutter/material.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../settings/data/account_repository.dart';
import '../data/saved_search_repository.dart';

class SavedSearchesSheet extends StatefulWidget {
  /// The specialty chip selected in the marketplace; null means all.
  final String? specialty;

  const SavedSearchesSheet({super.key, this.specialty});

  /// Returns the specialty of a saved search the user chose to apply, or
  /// 'All' for one without a specialty.
  static Future<String?> show(BuildContext context, {String? specialty}) => showModalBottomSheet<String>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => SavedSearchesSheet(specialty: specialty),
      );

  @override
  State<SavedSearchesSheet> createState() => _SavedSearchesSheetState();
}

class _SavedSearchesSheetState extends State<SavedSearchesSheet> {
  late final _name = TextEditingController(text: widget.specialty == null ? 'All duties' : '${widget.specialty} duties');
  final _city = TextEditingController();
  final _minPay = TextEditingController();
  List<Map<String, dynamic>>? _searches;
  String? _error;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _city.dispose();
    _minPay.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final searches = await SavedSearchRepository.list();
      if (mounted) setState(() => _searches = searches);
    } catch (e) {
      if (mounted) setState(() => _error = callableErrorMessage(e, 'Could not load saved searches.'));
    }
  }

  Future<void> _guard(Future<void> Function() action) async {
    try {
      await action();
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = callableErrorMessage(e));
    }
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final minPayText = _minPay.text.trim();
    final minPay = minPayText.isEmpty ? null : num.tryParse(minPayText);
    if (name.length < 2) {
      setState(() => _error = 'Give the search a name');
      return;
    }
    if (minPayText.isNotEmpty && (minPay == null || minPay < 0)) {
      setState(() => _error = 'Minimum pay must be a number');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    await _guard(() => SavedSearchRepository.save(
          name: name,
          specialtyName: widget.specialty,
          city: _city.text.trim(),
          minPay: minPay,
        ));
    if (mounted) setState(() => _saving = false);
  }

  String _summary(Map<String, dynamic> s) => [
        s['specialtyName'] ?? 'Any specialty',
        if (s['city'] != null) s['city'],
        if (s['minPay'] != null) '₹${s['minPay']}+',
      ].join(' · ');

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final searches = _searches;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.gutter, 0, AppSpacing.gutter, MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Save this search', style: AppTypography.headingMedium(colors.textPrimary)),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'We notify you when a new duty matching ${widget.specialty ?? 'any specialty'} is posted.',
              style: AppTypography.bodySmall(colors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(controller: _name, maxLength: 60, decoration: const InputDecoration(labelText: 'Name')),
            Row(children: [
              Expanded(
                child: TextField(controller: _city, decoration: const InputDecoration(labelText: 'City (optional)')),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: TextField(
                  controller: _minPay,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Min pay ₹ (optional)'),
                ),
              ),
            ]),
            if (_error != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(_error!, style: AppTypography.bodySmall(AppColors.rose)),
            ],
            const SizedBox(height: AppSpacing.md),
            AppButton(label: 'Save search', icon: Icons.bookmark_add_outlined, isLoading: _saving, onPressed: _saving ? null : _save),
            const SizedBox(height: AppSpacing.lg),
            const GroupLabel('Your saved searches'),
            if (searches == null)
              const Center(child: Padding(padding: EdgeInsets.all(AppSpacing.md), child: CircularProgressIndicator()))
            else if (searches.isEmpty)
              Text('None yet.', style: AppTypography.bodyMedium(colors.textSecondary))
            else
              RowGroup(children: [
                for (final s in searches)
                  ListRow(
                    icon: Icons.bookmark_outline,
                    title: s['name'] as String? ?? 'Saved search',
                    subtitle: _summary(s),
                    onTap: () => Navigator.pop(context, s['specialtyName'] as String? ?? 'All'),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      Switch(
                        value: s['alertsEnabled'] == true,
                        onChanged: (on) => _guard(() => SavedSearchRepository.setAlerts(s['searchId'] as String, on)),
                      ),
                      IconButton(
                        tooltip: 'Delete',
                        icon: Icon(Icons.delete_outline, color: colors.textMuted),
                        onPressed: () => _guard(() => SavedSearchRepository.delete(s['searchId'] as String)),
                      ),
                    ]),
                  ),
              ]),
          ],
        ),
      ),
    );
  }
}
