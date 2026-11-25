// A verified doctor posts a relief duty for their own shift. The server creates
// a `solo_practice` organization (approved on the strength of the doctor's own
// verification) and the practice is added as its one facility, with the map pin
// taken from the phone's location. The doctor keeps their doctor role.

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/config/backend_config.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/errors/error_envelope.dart';
import '../../../core/utils/device_location.dart';

class SoloPracticeScreen extends StatefulWidget {
  const SoloPracticeScreen({super.key});

  @override
  State<SoloPracticeScreen> createState() => _SoloPracticeScreenState();
}

class _SoloPracticeScreenState extends State<SoloPracticeScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  Map<String, dynamic>? _pin;
  bool _locating = false;
  bool _busy = false;
  String? _error;
  bool _hasPractice = false;

  @override
  void initState() {
    super.initState();
    _checkExisting();
  }

  /// A doctor who already has a solo practice goes straight to posting.
  Future<void> _checkExisting() async {
    try {
      final result = await BackendConfig.functions.httpsCallable('getMyOrganizations').call<Map<String, dynamic>>({});
      final orgs = (result.data['organizations'] as List? ?? const []).whereType<Map>();
      if (mounted && orgs.any((o) => o['organizationType'] == 'solo_practice')) setState(() => _hasPractice = true);
    } catch (_) {
      // Without the list the form still works; it simply creates a practice.
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _city.dispose();
    super.dispose();
  }

  Future<void> _locate() async {
    setState(() => _locating = true);
    final pin = await DeviceLocation.current();
    if (!mounted) return;
    setState(() {
      _locating = false;
      _pin = pin;
      _error = pin == null ? 'Location is off or not allowed. Turn it on and stand at your practice.' : null;
    });
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    if (_pin == null) {
      setState(() => _error = 'Set the map pin for your practice first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final name = _name.text.trim();
      final created = await BackendConfig.functions.httpsCallable('createOrganizationDraft').call<Map<String, dynamic>>({
        'legalName': name,
        'displayName': name,
        'organizationType': 'solo_practice',
        'address': _address.text.trim(),
        'city': _city.text.trim(),
      });
      final orgId = created.data['organizationId'] as String;
      await BackendConfig.functions.httpsCallable('addFacility').call<Map<String, dynamic>>({
        'organizationId': orgId,
        'name': name,
        'address': _address.text.trim(),
        'city': _city.text.trim(),
        'latitude': _pin!['latitude'],
        'longitude': _pin!['longitude'],
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Practice ready. You can post your relief duty now.')),
      );
      context.go('/hospital-dashboard');
    } on FirebaseFunctionsException catch (e) {
      setState(() => _error = switch (e.domainCode) {
            'DOCTOR_NOT_VERIFIED' => 'Your doctor profile must be verified before you can post.',
            'FEATURE_DISABLED' => 'Posting your own relief duties is not available yet.',
            _ => e.message ?? 'Could not create your practice. Try again.',
          });
    } catch (_) {
      setState(() => _error = 'Could not create your practice. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    String? required(String? v, int min) => (v ?? '').trim().length < min ? 'Required' : null;
    return Scaffold(
      appBar: AppBar(title: const Text('Post a relief duty')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: AppSpacing.paddingScreen,
            children: [
              Text('Your own practice', style: AppTypography.headingLarge(colors.textPrimary)),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Find a verified doctor to cover your shift. Your verified doctor profile stands in for a hospital '
                'licence, and you stay signed in as a doctor.',
                style: AppTypography.bodyMedium(colors.textSecondary),
              ),
              if (_hasPractice) ...[
                const SizedBox(height: AppSpacing.md),
                AppButton(label: 'Open my practice', onPressed: () => context.go('/hospital-dashboard')),
                const SizedBox(height: AppSpacing.sm),
                Text('Or create another practice below.', style: AppTypography.bodySmall(colors.textSecondary)),
              ],
              const SizedBox(height: AppSpacing.lg),
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Practice name', hintText: 'e.g. Dr. Priya Clinic'),
                validator: (v) => required(v, 2),
              ),
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _address,
                decoration: const InputDecoration(labelText: 'Practice address'),
                validator: (v) => required(v, 5),
              ),
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _city,
                decoration: const InputDecoration(labelText: 'City'),
                validator: (v) => required(v, 2),
              ),
              const SizedBox(height: AppSpacing.md),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(_pin == null ? Icons.location_off_outlined : Icons.location_on_outlined, color: colors.textPrimary),
                title: Text(_pin == null ? 'Map pin not set' : 'Map pin set', style: AppTypography.bodyMedium(colors.textPrimary)),
                subtitle: Text(
                  _pin == null
                      ? 'Stand at your practice and use your location.'
                      : '${(_pin!['latitude'] as double).toStringAsFixed(5)}, ${(_pin!['longitude'] as double).toStringAsFixed(5)}',
                  style: AppTypography.bodySmall(colors.textSecondary),
                ),
                trailing: TextButton(
                  onPressed: _locating ? null : _locate,
                  child: Text(_locating ? 'Locating…' : 'Use my location'),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.sm),
                Text(_error!, style: AppTypography.bodySmall(AppColors.rose)),
              ],
              const SizedBox(height: AppSpacing.lg),
              AppButton(label: 'Create practice', isLoading: _busy, onPressed: _busy ? null : _submit),
            ],
          ),
        ),
      ),
    );
  }
}
