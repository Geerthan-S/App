import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

class HospitalRepository {
  static Stream<List<Map<String, dynamic>>> watchOrgDuties(String orgId) {
    return FirebaseFirestore.instance
        .collection('duties')
        .where('organizationId', isEqualTo: orgId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snap) => snap.docs.map((d) => _toDutyMap(d.id, d.data())).toList());
  }

  static Stream<List<Map<String, dynamic>>> watchOrgAssignments(String orgId) {
    return FirebaseFirestore.instance
        .collection('assignments')
        .where('organizationId', isEqualTo: orgId)
        .orderBy('updatedAt', descending: true)
        .snapshots()
        .map((snap) => snap.docs.map((doc) {
              final d = doc.data();
              // The server freezes schedule and pay into termsSnapshot at selection.
              final terms = d['termsSnapshot'] as Map<String, dynamic>? ?? {};
              return {
                'assignmentId': doc.id,
                'dutyId': d['dutyId'] ?? '',
                'doctorId': d['doctorId'] ?? '',
                'doctorName': d['doctorName'] ?? 'Doctor',
                'facilityName': d['facilityName'] ?? '',
                'specialtyName': d['specialtyName'] ?? '',
                'department': d['department'] ?? '',
                'status': d['status'] ?? '',
                'amount': terms['amount'],
                'startAt': _formatTs(terms['startAt']),
                'endAt': _formatTs(terms['endAt']),
              };
            }).toList());
  }

  /// Applicants live at duties/{dutyId}/applications/{doctorId}; the credential
  /// details shown to the hospital come from the immutable snapshot captured
  /// when the doctor applied.
  static Future<List<Map<String, dynamic>>> getApplicationsForDuty(String dutyId) async {
    final db = FirebaseFirestore.instance;
    final snap = await db
        .collection('duties')
        .doc(dutyId)
        .collection('applications')
        .where('status', whereIn: ['submitted', 'shortlisted'])
        .get();
    return Future.wait(snap.docs.map((doc) async {
      final d = doc.data();
      final snapshotId = d['snapshotRef'] as String?;
      final snapshotDoc = snapshotId == null
          ? null
          : await db.collection('applicationSnapshots').doc(snapshotId).get();
      final profile = snapshotDoc?.data()?['doctorProfileSnapshot'] as Map<String, dynamic>? ?? {};
      return {
        'applicationId': d['applicationId'] ?? doc.id,
        'doctorId': d['doctorId'] ?? doc.id,
        'name': profile['fullName'] ?? d['doctorName'] ?? 'Doctor',
        'regNo': profile['registrationNo'] ?? '',
        'council': profile['council'] ?? '',
        'qualification': profile['qualification'] ?? '',
        'note': d['note'] ?? '',
        'isVerified': profile['isVerified'] == true,
        'status': d['status'] ?? 'submitted',
      };
    }));
  }

  static Future<void> selectDoctor(String dutyId, String doctorId) async {
    await FirebaseFunctions.instance.httpsCallable('atomicSelectDoctor').call<Map<String, dynamic>>({
      'dutyId': dutyId,
      'doctorId': doctorId,
      'idempotencyKey': const Uuid().v4(),
    });
  }

  static Future<Map<String, dynamic>?> getOrganization(String orgId) async {
    final doc = await FirebaseFirestore.instance.collection('organizations').doc(orgId).get();
    if (!doc.exists) return null;
    return {'organizationId': doc.id, ...doc.data()!};
  }

  static Stream<List<Map<String, dynamic>>> watchOrgReviews(String orgId) {
    return FirebaseFirestore.instance
        .collection('feedback')
        .where('targetId', isEqualTo: orgId)
        .where('targetType', isEqualTo: 'organization')
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snap) => snap.docs.map((doc) {
              final d = doc.data();
              return {
                'feedbackId': doc.id,
                'reviewerName': d['reviewerName'] ?? 'Doctor',
                'rating': d['rating'] ?? 0,
                'comment': d['comment'] ?? '',
              };
            }).toList());
  }

  static Map<String, dynamic> _toDutyMap(String id, Map<String, dynamic> d) {
    final sched = d['schedule'] as Map<String, dynamic>? ?? {};
    final pay = d['paymentTerms'] as Map<String, dynamic>? ?? {};
    return {
      'dutyId': id,
      'specialtyName': d['specialtyName'] ?? '',
      'department': d['department'] ?? '',
      'facilityName': d['facilityName'] ?? '',
      'timing': '${_formatTs(sched['startAt'])} – ${_formatTs(sched['endAt'])}',
      'headcount': d['headcount'] ?? 1,
      'remainingHeadcount': d['remainingHeadcount'] ?? d['headcount'] ?? 1,
      'status': d['status'] ?? 'draft',
      'amount': pay['amount'] ?? 0,
      'organizationId': d['organizationId'] ?? '',
    };
  }

  static String _formatTs(dynamic ts) {
    if (ts == null) return '—';
    try {
      final DateTime? parsed = ts is String
          ? DateTime.tryParse(ts)
          : ts is Timestamp
              ? ts.toDate()
              : null;
      if (parsed == null) return '—';
      final dt = parsed.toLocal();
      return DateFormat('dd MMM, h:mm a').format(dt);
    } catch (_) {
      return ts.toString();
    }
  }
}
