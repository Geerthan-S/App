// Hospital registration and verification, as guided steps:
//   1. Hospital details (creates the organization and its main facility)
//   2. Establishment licence (optional while testing mode is on)
//   3. Submit for review, then follow the decision live.
// An approved hospital can post duties from the dashboard.

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:file_picker/file_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';
import '../../../core/config/backend_config.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/services/demo_content_service.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../settings/data/account_repository.dart' show callableErrorMessage;

/// City centres for the main facility, so nobody has to type coordinates.
const _cityCoordinates = <String, (double, double)>{
  'chennai': (13.0827, 80.2707), 'bengaluru': (12.9716, 77.5946), 'bangalore': (12.9716, 77.5946),
  'mumbai': (19.0760, 72.8777), 'delhi': (28.6139, 77.2090), 'new delhi': (28.6139, 77.2090),
  'hyderabad': (17.3850, 78.4867), 'kochi': (9.9312, 76.2673), 'kolkata': (22.5726, 88.3639),
  'pune': (18.5204, 73.8567), 'ahmedabad': (23.0225, 72.5714), 'coimbatore': (11.0168, 76.9558),
  'madurai': (9.9252, 78.1198), 'jaipur': (26.9124, 75.7873), 'lucknow': (26.8467, 80.9462),
  'trichy': (10.7905, 78.7047), 'tiruchirappalli': (10.7905, 78.7047), 'salem': (11.6643, 78.1460),
  'thiruvananthapuram': (8.5241, 76.9366), 'visakhapatnam': (17.6868, 83.2185), 'mysuru': (12.2958, 76.6394),
  'chandigarh': (30.7333, 76.7794), 'bhopal': (23.2599, 77.4126), 'nagpur': (21.1458, 79.0882),
};

/// Geographic centre of India, used when the city is not in the list.
const _indiaCentre = (20.5937, 78.9629);

class HospitalProfileScreen extends StatefulWidget {
  const HospitalProfileScreen({super.key});

  @override
  State<HospitalProfileScreen> createState() => _HospitalProfileScreenState();
}

class _HospitalProfileScreenState extends State<HospitalProfileScreen> {
  final _functions = BackendConfig.functions;
  List<Map<String, dynamic>> _organizations = [];
  String? _selectedId;
  String? _testingNotice;
  bool _evidenceRequired = true;
  bool _loading = true;
  bool _busy = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Map<String, dynamic>? get _selected => _organizations.where((o) => o['organizationId'] == _selectedId).firstOrNull;

  void _toast(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _load() async {
    try {
      final result = await _functions.httpsCallable('getMyOrganizations').call<Map<String, dynamic>>();
      final organizations = (result.data['organizations'] as List<dynamic>? ?? [])
          .map((item) => Map<String, dynamic>.from(item as Map))
          .toList();
      final policy = result.data['verificationPolicy'] as Map?;
      if (!mounted) return;
      setState(() {
        _organizations = organizations;
        _testingNotice = policy?['testingModeNotice'] as String?;
        _evidenceRequired = policy?['evidenceRequired'] != false;
        _selectedId = organizations.any((org) => org['organizationId'] == _selectedId)
            ? _selectedId
            : (organizations.isEmpty ? null : organizations.first['organizationId'] as String?);
        _loading = false;
        _loadError = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _loadError = callableErrorMessage(e, 'Could not load your hospital.'); });
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ── Step 1 ──────────────────────────────────────────────

  Future<void> _createOrganization(Map<String, String> details) => _run(() async {
        try {
          final created = await _functions.httpsCallable('createOrganizationDraft').call<Map<String, dynamic>>({
            ...details,
            'organizationType': details['organizationType'] ?? 'hospital',
          });
          final orgId = created.data['organizationId'] as String;
          final coords = _cityCoordinates[details['city']!.trim().toLowerCase()] ?? _indiaCentre;
          // The main facility is where duties are posted; it mirrors the hospital address.
          await _functions.httpsCallable('addFacility').call<Map<String, dynamic>>({
            'organizationId': orgId,
            'name': '${details['displayName']} – Main campus',
            'address': details['address'],
            'city': details['city'],
            'latitude': coords.$1,
            'longitude': coords.$2,
          });
          _selectedId = orgId;
          await _load();
          unawaited(DemoContentService.ensure());
          _toast('Hospital saved. Next: add your licence and submit for review.');
        } catch (e) {
          _toast(callableErrorMessage(e, 'Could not save the hospital. Check the details and try again.'));
        }
      });

  // ── Step 2 ──────────────────────────────────────────────

  Future<String> _ensureCase(String orgId) async {
    final result = await _functions.httpsCallable('createVerificationCase')
        .call<Map<String, dynamic>>({'subjectType': 'organization', 'subjectId': orgId});
    final caseId = result.data['caseId'] as String?;
    if (caseId == null || caseId.isEmpty) throw StateError('Could not open a verification case.');
    return caseId;
  }

  Future<void> _uploadLicense() async {
    final orgId = _selectedId;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (orgId == null || uid == null) return;
    final chosen = await FilePicker.platform.pickFiles(
      type: FileType.custom, allowedExtensions: ['pdf', 'png', 'jpg', 'jpeg'], withData: true,
    );
    if (chosen == null || chosen.files.isEmpty) return;
    final file = chosen.files.single;
    final bytes = file.bytes;
    if (bytes == null || bytes.isEmpty || bytes.length >= 10 * 1024 * 1024) {
      _toast('Choose a PDF or image smaller than 10 MB.');
      return;
    }
    final extension = file.extension?.toLowerCase();
    final contentType = switch (extension) {
      'pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' || 'jpeg' => 'image/jpeg', _ => null,
    };
    if (contentType == null) return;
    await _run(() async {
      try {
        final caseId = await _ensureCase(orgId);
        await FirebaseStorage.instance
            .ref('verification/organization/$orgId/$caseId/${const Uuid().v4()}.$extension')
            .putData(bytes, SettableMetadata(contentType: contentType, customMetadata: {'uploadedBy': uid}));
        await _load();
        _toast('Licence uploaded.');
      } catch (e) {
        _toast(callableErrorMessage(e, 'Upload failed. Check your connection and try again.'));
      }
    });
  }

  // ── Step 3 ──────────────────────────────────────────────

  Future<void> _submit() async {
    final orgId = _selectedId;
    if (orgId == null) return;
    await _run(() async {
      try {
        final caseId = await _ensureCase(orgId);
        await _functions.httpsCallable('submitVerificationCase').call<Map<String, dynamic>>({'caseId': caseId});
        await _load();
        _toast('Submitted. A HealthForce admin will review your hospital.');
      } catch (e) {
        _toast(callableErrorMessage(e, 'Could not submit. Try again.'));
      }
    });
  }

  Future<void> _addFacility() async {
    final org = _selected;
    if (org == null) return;
    final data = await showModalBottomSheet<Map<String, String>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _FacilitySheet(defaultCity: org['city'] as String? ?? ''),
    );
    if (data == null) return;
    final coords = _cityCoordinates[data['city']!.toLowerCase()] ?? _indiaCentre;
    await _run(() async {
      try {
        await _functions.httpsCallable('addFacility').call<Map<String, dynamic>>({
          'organizationId': org['organizationId'], ...data, 'latitude': coords.$1, 'longitude': coords.$2,
        });
        _toast('Facility added.');
      } catch (e) {
        _toast(callableErrorMessage(e, 'Could not add the facility.'));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final org = _selected;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: const Text('Hospital verification')),
      body: SafeArea(
        child: _loading
            ? const LoadingView()
            : _loadError != null
                ? ErrorView(message: _loadError!, onRetry: () { setState(() => _loading = true); _load(); })
                : ListView(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, AppSpacing.xl),
                    children: [
                      if (_testingNotice != null) TestingModeBanner(message: _testingNotice!),
                      if (_organizations.length > 1) ...[
                        DropdownButtonFormField<String>(
                          initialValue: _selectedId,
                          decoration: const InputDecoration(labelText: 'Hospital'),
                          items: _organizations.map((o) => DropdownMenuItem<String>(
                                value: o['organizationId'] as String,
                                child: Text(o['displayName'] as String? ?? o['legalName'] as String? ?? 'Hospital'),
                              )).toList(),
                          onChanged: (v) => setState(() => _selectedId = v),
                        ),
                        const SizedBox(height: AppSpacing.md),
                      ],
                      if (org == null)
                        _DetailsForm(busy: _busy, onSave: _createOrganization)
                      else
                        _Steps(
                          key: ValueKey(org['organizationId']),
                          org: org,
                          busy: _busy,
                          evidenceRequired: _evidenceRequired,
                          onUpload: _uploadLicense,
                          onSubmit: _submit,
                          onAddFacility: _addFacility,
                        ),
                    ],
                  ),
      ),
    );
  }
}

/// Amber notice shown wherever a production safeguard is relaxed for testing.
class TestingModeBanner extends StatelessWidget {
  final String message;
  const TestingModeBanner({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.amber.withValues(alpha: 0.12),
        border: Border.all(color: AppColors.amber.withValues(alpha: 0.5)),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.science_outlined, size: 18, color: AppColors.amber),
        const SizedBox(width: 8),
        Expanded(child: Text(message, style: AppTypography.bodySmall(context.appColors.textPrimary))),
      ]),
    );
  }
}

class _DetailsForm extends StatefulWidget {
  final bool busy;
  final Future<void> Function(Map<String, String>) onSave;
  const _DetailsForm({required this.busy, required this.onSave});

  @override
  State<_DetailsForm> createState() => _DetailsFormState();
}

class _DetailsFormState extends State<_DetailsForm> {
  final _form = GlobalKey<FormState>();
  final _legal = TextEditingController();
  final _display = TextEditingController();
  final _registration = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  String _type = 'hospital';

  @override
  void dispose() {
    for (final c in [_legal, _display, _registration, _address, _city]) { c.dispose(); }
    super.dispose();
  }

  String? _required(String? v, int min) => (v ?? '').trim().length < min ? 'Required (at least $min characters)' : null;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return AppCard(
      child: Form(
        key: _form,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Step 1 of 3 · Hospital details', style: AppTypography.overline(colors.textMuted)),
          const SizedBox(height: 4),
          Text('Register your hospital', style: AppTypography.headingMedium(colors.textPrimary)),
          const SizedBox(height: AppSpacing.xs),
          Text('Use the details on your establishment registration. A HealthForce admin checks them against the official register.',
              style: AppTypography.bodySmall(colors.textSecondary)),
          const SizedBox(height: AppSpacing.md),
          AppTextField(label: 'Legal name', hintText: 'As on the registration certificate', controller: _legal, validator: (v) => _required(v, 2)),
          const SizedBox(height: AppSpacing.md),
          AppTextField(label: 'Name shown to doctors', hintText: 'e.g. Sunshine Care Hospital', controller: _display, validator: (v) => _required(v, 2)),
          const SizedBox(height: AppSpacing.md),
          Text('Type', style: AppTypography.labelBold(colors.textSecondary)),
          const SizedBox(height: AppSpacing.xs),
          DropdownButtonFormField<String>(
            initialValue: _type,
            items: const [
              DropdownMenuItem(value: 'hospital', child: Text('Hospital')),
              DropdownMenuItem(value: 'clinic', child: Text('Clinic')),
              DropdownMenuItem(value: 'nursing_home', child: Text('Nursing home')),
            ],
            onChanged: (v) => setState(() => _type = v ?? _type),
          ),
          const SizedBox(height: AppSpacing.md),
          AppTextField(label: 'Establishment registration number', hintText: 'Clinical establishment / licence number', controller: _registration, validator: (v) => _required(v, 2)),
          const SizedBox(height: AppSpacing.md),
          AppTextField(label: 'Street address', hintText: 'Building, street, area', controller: _address, validator: (v) => _required(v, 5)),
          const SizedBox(height: AppSpacing.md),
          AppTextField(label: 'City', hintText: 'e.g. Chennai', controller: _city, validator: (v) => _required(v, 2)),
          const SizedBox(height: AppSpacing.lg),
          AppButton(
            label: 'Save and continue',
            isLoading: widget.busy,
            onPressed: widget.busy
                ? null
                : () {
                    if (!_form.currentState!.validate()) return;
                    widget.onSave({
                      'legalName': _legal.text.trim(), 'displayName': _display.text.trim(), 'organizationType': _type,
                      'registrationNumber': _registration.text.trim(), 'address': _address.text.trim(), 'city': _city.text.trim(),
                    });
                  },
          ),
        ]),
      ),
    );
  }
}

class _Steps extends StatelessWidget {
  final Map<String, dynamic> org;
  final bool busy;
  final bool evidenceRequired;
  final VoidCallback onUpload;
  final VoidCallback onSubmit;
  final VoidCallback onAddFacility;

  const _Steps({
    super.key,
    required this.org,
    required this.busy,
    required this.evidenceRequired,
    required this.onUpload,
    required this.onSubmit,
    required this.onAddFacility,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final orgId = org['organizationId'] as String;
    final caseId = org['verificationCaseId'] as String?;
    final canManage = ['owner', 'admin'].contains(org['memberRole']);
    final caseStream = caseId == null
        ? Stream<DocumentSnapshot<Map<String, dynamic>>?>.value(null)
        : FirebaseFirestore.instance.collection('verificationCases').doc(caseId).snapshots();
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>?>(
      stream: caseStream,
      builder: (context, snap) {
        final caseData = snap.data?.data();
        final status = org['verificationState'] == 'approved' ? 'approved' : (caseData?['status'] as String? ?? 'draft');
        final editable = status == 'draft' || status == 'needs_information';
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(org['displayName'] as String? ?? org['legalName'] as String? ?? '',
                    style: AppTypography.headingMedium(colors.textPrimary))),
                StatusBadge(status: _statusLabel(status)),
              ]),
              const SizedBox(height: 4),
              Text('${org['legalName'] ?? ''} · Reg. ${org['registrationNumber'] ?? '—'}',
                  style: AppTypography.bodySmall(colors.textSecondary)),
              Text('${org['address'] ?? ''}, ${org['city'] ?? ''}', style: AppTypography.bodySmall(colors.textSecondary)),
              const SizedBox(height: AppSpacing.sm),
              _StatusExplainer(status: status, reason: caseData?['decisionReason'] as String?),
              if (status == 'approved') ...[
                const SizedBox(height: AppSpacing.sm),
                AppButton(label: 'Go to dashboard', icon: Icons.dashboard_outlined, onPressed: () => context.go('/hospital-dashboard')),
              ],
            ]),
          ),
          const SizedBox(height: AppSpacing.lg),
          const GroupLabel('Steps'),
          RowGroup(children: [
            const ListRow(
              icon: Icons.check_circle,
              iconColor: AppColors.emerald,
              title: '1. Hospital details',
              subtitle: 'Saved',
            ),
            _EvidenceRow(
              orgId: orgId,
              caseId: caseId,
              required: evidenceRequired,
              enabled: canManage && editable && !busy,
              onUpload: onUpload,
            ),
            ListRow(
              icon: status == 'draft' || status == 'needs_information' ? Icons.send_outlined : Icons.check_circle,
              iconColor: status == 'draft' || status == 'needs_information' ? null : AppColors.emerald,
              title: '3. Submit for review',
              subtitle: switch (status) {
                'draft' => 'Send your hospital to a HealthForce admin',
                'needs_information' => 'Update what was asked, then submit again',
                _ => 'Submitted',
              },
              trailing: editable
                  ? FilledButton(onPressed: canManage && !busy ? onSubmit : null, child: Text(status == 'draft' ? 'Submit' : 'Resubmit'))
                  : null,
            ),
          ]),
          if (!canManage) ...[
            const SizedBox(height: AppSpacing.sm),
            Text('Only an owner or admin of this hospital can change its verification.',
                style: AppTypography.bodySmall(colors.textMuted)),
          ],
          const SizedBox(height: AppSpacing.lg),
          SectionHeader(
            title: 'Facilities',
            actionLabel: canManage ? 'Add' : null,
            onAction: canManage && !busy ? onAddFacility : null,
            padding: EdgeInsets.zero,
          ),
          const SizedBox(height: AppSpacing.xs),
          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: FirebaseFirestore.instance.collection('organizations').doc(orgId).collection('facilities').snapshots(),
            builder: (context, snapshot) {
              if (snapshot.hasError) return Text('Facilities unavailable.', style: AppTypography.bodySmall(colors.textMuted));
              if (!snapshot.hasData) return const LinearProgressIndicator(minHeight: 2);
              if (snapshot.data!.docs.isEmpty) {
                return Text('Add the campus where doctors will work.', style: AppTypography.bodySmall(colors.textMuted));
              }
              return RowGroup(children: [
                for (final doc in snapshot.data!.docs)
                  ListRow(
                    icon: Icons.location_city_outlined,
                    title: doc.data()['name'] as String? ?? 'Facility',
                    subtitle: '${doc.data()['address'] ?? ''}, ${doc.data()['city'] ?? ''}',
                  ),
              ]);
            },
          ),
        ]);
      },
    );
  }

  static String _statusLabel(String status) => switch (status) {
        'draft' => 'Not submitted',
        'submitted' => 'Submitted',
        'under_review' => 'Under review',
        'needs_information' => 'Needs information',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        _ => status,
      };
}

class _StatusExplainer extends StatelessWidget {
  final String status;
  final String? reason;
  const _StatusExplainer({required this.status, this.reason});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final cleanReason = reason?.split(':').skip(1).join(':').trim();
    final text = switch (status) {
      'draft' => 'Finish the steps below and submit. You can save draft duties meanwhile; publishing needs approval.',
      'submitted' || 'under_review' => 'A HealthForce admin is checking your hospital against the official register. You will be notified of the decision.',
      'needs_information' => 'The reviewer asked for more information${cleanReason == null || cleanReason.isEmpty ? '' : ': $cleanReason'}.',
      'approved' => 'Your hospital is verified. You can publish duties and select doctors.',
      'rejected' => 'Verification was not approved${cleanReason == null || cleanReason.isEmpty ? '' : ': $cleanReason'}. Contact support to appeal.',
      _ => '',
    };
    return Text(text, style: AppTypography.bodyMedium(colors.textSecondary).copyWith(fontSize: 14));
  }
}

class _EvidenceRow extends StatelessWidget {
  final String orgId;
  final String? caseId;
  final bool required;
  final bool enabled;
  final VoidCallback onUpload;

  const _EvidenceRow({required this.orgId, required this.caseId, required this.required, required this.enabled, required this.onUpload});

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    final stream = caseId == null || uid == null
        ? Stream<int>.value(0)
        : FirebaseFirestore.instance
            .collection('verificationDocuments')
            .where('uploadedBy', isEqualTo: uid)
            .limit(50)
            .snapshots()
            .map((s) => s.docs.where((d) => d.data()['caseId'] == caseId).length);
    return StreamBuilder<int>(
      stream: stream,
      builder: (context, snap) {
        final count = snap.data ?? 0;
        return ListRow(
          icon: count > 0 ? Icons.check_circle : Icons.upload_file_outlined,
          iconColor: count > 0 ? AppColors.emerald : null,
          title: required ? '2. Establishment licence' : '2. Establishment licence (optional while testing)',
          subtitle: count > 0 ? '$count file${count == 1 ? '' : 's'} uploaded' : 'PDF or photo of your registration certificate',
          trailing: TextButton(onPressed: enabled ? onUpload : null, child: Text(count > 0 ? 'Add' : 'Upload')),
        );
      },
    );
  }
}

class _FacilitySheet extends StatefulWidget {
  final String defaultCity;
  const _FacilitySheet({required this.defaultCity});

  @override
  State<_FacilitySheet> createState() => _FacilitySheetState();
}

class _FacilitySheetState extends State<_FacilitySheet> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _address = TextEditingController();
  late final _city = TextEditingController(text: widget.defaultCity);

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _city.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Padding(
      padding: EdgeInsets.fromLTRB(AppSpacing.gutter, 0, AppSpacing.gutter, MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg),
      child: Form(
        key: _form,
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Add a facility', style: AppTypography.headingMedium(colors.textPrimary)),
          const SizedBox(height: AppSpacing.md),
          AppTextField(label: 'Facility name', hintText: 'e.g. North wing', controller: _name,
              validator: (v) => (v ?? '').trim().length < 2 ? 'Required' : null),
          const SizedBox(height: AppSpacing.md),
          AppTextField(label: 'Street address', controller: _address,
              validator: (v) => (v ?? '').trim().length < 5 ? 'Required (at least 5 characters)' : null),
          const SizedBox(height: AppSpacing.md),
          AppTextField(label: 'City', controller: _city,
              validator: (v) => (v ?? '').trim().length < 2 ? 'Required' : null),
          const SizedBox(height: AppSpacing.md),
          AppButton(
            label: 'Add facility',
            onPressed: () {
              if (!_form.currentState!.validate()) return;
              Navigator.pop(context, {'name': _name.text.trim(), 'address': _address.text.trim(), 'city': _city.text.trim()});
            },
          ),
        ]),
      ),
    );
  }
}
