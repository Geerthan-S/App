// Mute categories and quiet hours (blueprint §11.4). The inbox always keeps
// every notification; these settings only silence pushes. Selection results,
// cancellations and expiries are always delivered.

import 'package:flutter/material.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/ui_kit.dart';
import '../data/account_repository.dart';

class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  State<NotificationPreferencesScreen> createState() => _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState extends State<NotificationPreferencesScreen> {
  NotificationPreferences? _prefs;
  Object? _loadError;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final prefs = await AccountRepository.getNotificationPreferences();
      if (mounted) setState(() => _prefs = prefs);
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  Future<void> _save(NotificationPreferences next) async {
    final previous = _prefs;
    setState(() {
      _prefs = next;
      _saving = true;
    });
    try {
      await AccountRepository.updateNotificationPreferences(next);
    } catch (e) {
      if (!mounted) return;
      setState(() => _prefs = previous);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(callableErrorMessage(e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickTime(bool start) async {
    final prefs = _prefs!;
    final current = (start ? prefs.quietStart : prefs.quietEnd).split(':');
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: int.parse(current[0]), minute: int.parse(current[1])),
    );
    if (picked == null) return;
    final value = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
    await _save(start ? prefs.copyWith(quietStart: value) : prefs.copyWith(quietEnd: value));
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final prefs = _prefs;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: const Text('Notification preferences'),
        bottom: _saving ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator(minHeight: 2)) : null,
      ),
      body: SafeArea(
        child: _loadError != null
            ? ErrorView(message: callableErrorMessage(_loadError!, 'Could not load your preferences.'), onRetry: _load)
            : prefs == null
                ? const LoadingView()
                : ListView(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, AppSpacing.lg),
                    children: [
                      const GroupLabel('Push categories'),
                      RowGroup(children: [
                        for (final entry in NotificationPreferences.categories.entries)
                          ListRow(
                            title: entry.value.$1,
                            subtitle: entry.value.$2,
                            trailing: Switch(
                              value: !prefs.muted.contains(entry.key),
                              onChanged: (on) => _save(prefs.copyWith(
                                muted: on ? ({...prefs.muted}..remove(entry.key)) : {...prefs.muted, entry.key},
                              )),
                            ),
                          ),
                      ]),
                      const SizedBox(height: AppSpacing.lg),
                      const GroupLabel('Quiet hours (India time)'),
                      RowGroup(children: [
                        ListRow(
                          icon: Icons.bedtime_outlined,
                          title: 'Quiet hours',
                          subtitle: 'Hold pushes overnight; they stay in your inbox',
                          trailing: Switch(
                            value: prefs.quietEnabled,
                            onChanged: (on) => _save(prefs.copyWith(quietEnabled: on)),
                          ),
                        ),
                        if (prefs.quietEnabled) ...[
                          ListRow(title: 'From', subtitle: prefs.quietStart, onTap: () => _pickTime(true)),
                          ListRow(title: 'Until', subtitle: prefs.quietEnd, onTap: () => _pickTime(false)),
                        ],
                      ]),
                      const SizedBox(height: AppSpacing.md),
                      Text(
                        'Selection results, cancellations and offer expiries always notify you, even when muted.',
                        style: AppTypography.bodySmall(colors.textSecondary),
                      ),
                    ],
                  ),
      ),
    );
  }
}
