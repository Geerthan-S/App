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
              final sched = d['schedule'] as Map<String, dynamic>? ?? {};
              final pay = d['paymentTerms'] as Map<String, dynamic>? ?? {};
              return {
                'assignmentId': doc.id,
                'dutyId': d['dutyId'] ?? '',
                'doctorId': d['doctorId'] ?? '',
                'doctorName': d['snapshotName'] ?? d['doctorName'] ?? 'Doctor',
                'facilityName': d['facilityName'] ?? '',
                'specialtyName': d['specialtyName'] ?? '',
                'department': d['department'] ?? '',
                'status': d['status'] ?? '',
                'amount': pay['amount'] ?? d['amount'] ?? 0,
                'startAt': _formatTs(sched['startAt'] ?? d['startAt']),
              };
            }).toList());
  }

  static Future<List<Map<String, dynamic>>> getApplicationsForDuty(String dutyId) async {
    final snap = await FirebaseFirestore.instance
        .collection('assignments')
        .where('dutyId', isEqualTo: dutyId)
        .where('status', whereIn: ['applied', 'shortlisted'])
        .get();
    return snap.docs.map((doc) {
      final d = doc.data();
      return {
        'assignmentId': doc.id,
        'doctorId': d['doctorId'] ?? '',
        'name': d['snapshotName'] ?? 'Doctor',
        'regNo': d['snapshotRegNo'] ?? '',
        'council': d['snapshotCouncil'] ?? '',
        'qualification': d['snapshotQualification'] ?? '',
        'note': d['note'] ?? '',
        'isVerified': d['snapshotIsVerified'] ?? false,
        'status': d['status'] ?? 'applied',
      };
    }).toList();
  }

  static Future<void> selectDoctor(String dutyId, String doctorId) async {
    await FirebaseFunctions.instance.httpsCallable('atomicSelectDoctor').call({
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
      final dt = (ts is String ? DateTime.parse(ts) : DateTime.now()).toLocal();
      return DateFormat('dd MMM, h:mm a').format(dt);
    } catch (_) {
      return ts.toString();
    }
  }
}
