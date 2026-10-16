import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:file_picker/file_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../../core/config/backend_config.dart';

class HospitalProfileScreen extends ConsumerStatefulWidget {
  const HospitalProfileScreen({super.key});

  @override
  ConsumerState<HospitalProfileScreen> createState() => _HospitalProfileScreenState();
}

class _HospitalProfileScreenState extends ConsumerState<HospitalProfileScreen> {
  final _functions = BackendConfig.functions;
  List<Map<String, dynamic>> _organizations = [];
  String? _selectedId;
  bool _busy = false;
  String? _message;

  @override
  void initState() {
    super.initState();
    _loadOrganizations();
  }

  Future<void> _loadOrganizations() async {
    try {
      final result = await _functions.httpsCallable('getMyOrganizations')
          .call<Map<String, dynamic>>();
      final organizations = (result.data['organizations'] as List<dynamic>? ?? [])
          .map((item) => Map<String, dynamic>.from(item as Map))
          .toList();
      if (!mounted) return;
      setState(() {
        _organizations = organizations;
        _selectedId = organizations.any((org) => org['organizationId'] == _selectedId)
            ? _selectedId
            : (organizations.isEmpty ? null : organizations.first['organizationId'] as String?);
        _message = null;
      });
    } catch (_) {
      if (mounted) setState(() => _message = 'Organization records are unavailable. Check your connection and sign-in.');
    }
  }

  Future<void> _createOrganization() async {
    // The dialog owns its text controllers and disposes them when its route is
    // removed. Disposing them here, as soon as showDialog returned, freed them
    // while the closing animation still rendered the fields, which tripped
    // the framework's `_dependents.isEmpty` assertion.
    final data = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => const _CreateOrganizationDialog(),
    );
    if (data == null) return;
    setState(() => _busy = true);
    try {
      await _functions.httpsCallable('createOrganizationDraft').call<Map<String, dynamic>>(data);
      await _loadOrganizations();
    } catch (_) {
      if (mounted) setState(() => _message = 'Could not create organization. Check the required legal details.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String> _ensureCase(String orgId) async {
    final result = await _functions.httpsCallable('createVerificationCase')
        .call<Map<String, dynamic>>({'subjectType': 'organization', 'subjectId': orgId});
    final caseId = result.data['caseId'] as String?;
    if (caseId == null || caseId.isEmpty) throw StateError('Could not create organization case.');
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
      setState(() => _message = 'Choose a non-empty PDF or image smaller than 10 MB.');
      return;
    }
    final extension = file.extension?.toLowerCase();
    final contentType = switch (extension) {
      'pdf' => 'application/pdf', 'png' => 'image/png',
      'jpg' || 'jpeg' => 'image/jpeg', _ => null,
    };
    if (contentType == null) return;
    setState(() => _busy = true);
    try {
      final caseId = await _ensureCase(orgId);
      final objectName = '${const Uuid().v4()}.$extension';
      await FirebaseStorage.instance
          .ref('verification/organization/$orgId/$caseId/$objectName')
          .putData(bytes, SettableMetadata(contentType: contentType, customMetadata: {'uploadedBy': uid, 'originalName': file.name}));
      if (mounted) setState(() => _message = 'License uploaded. Security screening is pending.');
    } catch (_) {
      if (mounted) setState(() => _message = 'License upload failed. Confirm your organization role and Storage setup.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitCase() async {
    final orgId = _selectedId;
    if (orgId == null) return;
    setState(() => _busy = true);
    try {
      final caseId = await _ensureCase(orgId);
      await _functions.httpsCallable('submitVerificationCase').call<Map<String, dynamic>>({'caseId': caseId});
      await _loadOrganizations();
      if (mounted) setState(() => _message = 'Organization case submitted for verifier review.');
    } catch (_) {
      if (mounted) setState(() => _message = 'Could not submit this organization case.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addFacility() async {
    final orgId = _selectedId;
    if (orgId == null) return;
    final data = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => _AddFacilityDialog(organizationId: orgId),
    );
    if (data == null) return;
    setState(() => _busy = true);
    try {
      await _functions.httpsCallable('addFacility').call<Map<String, dynamic>>(data);
      if (mounted) setState(() => _message = 'Facility saved.');
    } catch (_) {
      if (mounted) setState(() => _message = 'Could not add facility. Check the address and coordinates.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final selected = _organizations.where((org) => org['organizationId'] == _selectedId).firstOrNull;
    final canManage = selected != null && ['owner', 'admin'].contains(selected['memberRole']);
    return Scaffold(
      appBar: AppBar(title: const Text('Hospital organization')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (_message != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_message!)),
        FilledButton(onPressed: _busy ? null : _createOrganization, child: const Text('Create organization')),
        if (_organizations.isNotEmpty)
          DropdownButtonFormField<String>(
            value: _selectedId,
            decoration: const InputDecoration(labelText: 'Your organization'),
            items: _organizations.map((org) => DropdownMenuItem<String>(
              value: org['organizationId'] as String,
              child: Text(org['displayName'] as String? ?? org['legalName'] as String? ?? 'Organization'),
            )).toList(),
            onChanged: (value) => setState(() => _selectedId = value),
          ),
        if (selected != null) ...[
          const SizedBox(height: 16),
          Text(selected['legalName'] as String? ?? '', style: Theme.of(context).textTheme.titleLarge),
          Text('Registration: ${selected['registrationNumber'] ?? '—'}'),
          Text('City: ${selected['city'] ?? '—'}'),
          Text('Verification: ${selected['verificationState'] ?? 'draft'}'),
          if (selected['verificationCaseId'] is String)
            StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
              stream: FirebaseFirestore.instance.collection('verificationCases')
                  .doc(selected['verificationCaseId'] as String).snapshots(),
              builder: (context, snapshot) {
                if (snapshot.hasError) return const Text('Case status unavailable.');
                return Text('Case: ${snapshot.data?.data()?['status'] ?? 'loading'}');
              },
            ),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy || !canManage ? null : _uploadLicense, child: const Text('Upload establishment license')),
          FilledButton(onPressed: _busy || !canManage ? null : _submitCase, child: const Text('Submit organization for review')),
          const SizedBox(height: 16),
          Text('Uploaded evidence remains private and unavailable to reviewers until screened.',
              style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 20),
          Text('Facilities', style: Theme.of(context).textTheme.titleMedium),
          FilledButton(onPressed: _busy || !canManage ? null : _addFacility, child: const Text('Add facility')),
          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: FirebaseFirestore.instance.collection('organizations').doc(_selectedId!)
                .collection('facilities').snapshots(),
            builder: (context, snapshot) {
              if (snapshot.hasError) return const Text('Facility list unavailable.');
              if (!snapshot.hasData) return const LinearProgressIndicator();
              if (snapshot.data!.docs.isEmpty) return const Text('No facilities registered yet.');
              return Column(children: snapshot.data!.docs.map((doc) {
                final facility = doc.data();
                return ListTile(
                  title: Text(facility['name'] as String? ?? 'Facility'),
                  subtitle: Text('${facility['address'] ?? ''}, ${facility['city'] ?? ''}'),
                );
              }).toList());
            },
          ),
        ],
      ]),
    );
  }
}

class _CreateOrganizationDialog extends StatefulWidget {
  const _CreateOrganizationDialog();

  @override
  State<_CreateOrganizationDialog> createState() => _CreateOrganizationDialogState();
}

class _CreateOrganizationDialogState extends State<_CreateOrganizationDialog> {
  final _legal = TextEditingController();
  final _display = TextEditingController();
  final _registration = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  String _type = 'hospital';

  @override
  void dispose() {
    for (final controller in [_legal, _display, _registration, _address, _city]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Create hospital organization'),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: _legal, decoration: const InputDecoration(labelText: 'Legal name')),
        TextField(controller: _display, decoration: const InputDecoration(labelText: 'Display name')),
        DropdownButtonFormField<String>(
          value: _type,
          items: const ['hospital', 'clinic', 'nursing_home']
              .map((value) => DropdownMenuItem(value: value, child: Text(value))).toList(),
          onChanged: (value) => setState(() => _type = value ?? _type),
        ),
        TextField(controller: _registration, decoration: const InputDecoration(labelText: 'Establishment registration number')),
        TextField(controller: _address, decoration: const InputDecoration(labelText: 'Street address')),
        TextField(controller: _city, decoration: const InputDecoration(labelText: 'City')),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(context, {
          'legalName': _legal.text.trim(), 'displayName': _display.text.trim(),
          'organizationType': _type, 'registrationNumber': _registration.text.trim(),
          'address': _address.text.trim(), 'city': _city.text.trim(),
        }), child: const Text('Create')),
      ],
    );
  }
}

class _AddFacilityDialog extends StatefulWidget {
  final String organizationId;

  const _AddFacilityDialog({required this.organizationId});

  @override
  State<_AddFacilityDialog> createState() => _AddFacilityDialogState();
}

class _AddFacilityDialogState extends State<_AddFacilityDialog> {
  final _name = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _latitude = TextEditingController();
  final _longitude = TextEditingController();

  @override
  void dispose() {
    for (final controller in [_name, _address, _city, _latitude, _longitude]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add a facility'),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Facility name')),
        TextField(controller: _address, decoration: const InputDecoration(labelText: 'Street address')),
        TextField(controller: _city, decoration: const InputDecoration(labelText: 'City')),
        TextField(controller: _latitude, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Latitude')),
        TextField(controller: _longitude, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Longitude')),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(context, {
          'organizationId': widget.organizationId, 'name': _name.text.trim(), 'address': _address.text.trim(),
          'city': _city.text.trim(), 'latitude': double.tryParse(_latitude.text.trim()),
          'longitude': double.tryParse(_longitude.text.trim()),
        }), child: const Text('Add')),
      ],
    );
  }
}
