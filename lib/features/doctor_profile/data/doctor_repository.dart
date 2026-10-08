import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:intl/intl.dart';

class DoctorRepository {
  static final _db = FirebaseFirestore.instance;
  static final _functions = FirebaseFunctions.instance;
  static final _dateFmt = DateFormat('d MMM');

  static String? get _uid => FirebaseAuth.instance.currentUser?.uid;

  static Stream<Map<String, dynamic>?> watchProfile() {
    final uid = _uid;
    if (uid == null) return const Stream.empty();
    return _db.collection('doctors').doc(uid).snapshots().map(
      (doc) => doc.exists ? doc.data() : null,
    );
  }

  static Future<Map<String, dynamic>?> getProfile() async {
    final uid = _uid;
    if (uid == null) return null;
    final doc = await _db.collection('doctors').doc(uid).get();
    return doc.exists ? doc.data() : null;
  }

  static Future<void> saveProfile({
    required String fullName,
    required String council,
    required String registrationNo,
    required String qualification,
    required String primarySpecialty,
    required List<String> preferredCities,
    required int yearsOfExperience,
    String? bio,
  }) async {
    await _functions.httpsCallable('submitDoctorProfile').call<Map<String, dynamic>>({
      'fullName': fullName,
      'council': council,
      'registrationNo': registrationNo,
      'qualification': qualification,
      'specialties': [primarySpecialty],
      'primarySpecialty': primarySpecialty,
      'yearsOfExperience': yearsOfExperience,
      'preferredCities': preferredCities,
      if (bio != null && bio.isNotEmpty) 'bio': bio,
    });
  }

  static Stream<List<Map<String, dynamic>>> watchReviews(String targetId) {
    return _db
        .collection('feedback')
        .where('targetId', isEqualTo: targetId)
        .orderBy('createdAt', descending: true)
        .limit(20)
        .snapshots()
        .map((snap) => snap.docs.map((doc) {
              final d = doc.data();
              return {
                'reviewerName': d['reviewerName'] as String? ?? 'Anonymous',
                'rating': (d['rating'] as num?)?.toInt() ?? 5,
                'comment': d['comment'] as String? ?? '',
              };
            }).toList());
  }

  static Stream<List<Map<String, dynamic>>> watchAssignments() {
    final uid = _uid;
    if (uid == null) return const Stream.empty();
    return _db
        .collection('assignments')
        .where('doctorId', isEqualTo: uid)
        .orderBy('updatedAt', descending: true)
        .limit(30)
        .snapshots()
        .map((snap) => snap.docs.map((doc) {
              final d = doc.data();
              final terms = d['termsSnapshot'] as Map<String, dynamic>? ?? {};
              return {
                'assignmentId': d['assignmentId'] ?? doc.id,
                'dutyId': d['dutyId'] ?? '',
                'facilityName': d['facilityName'] ?? 'Unknown Facility',
                'department': d['department'] ?? '',
                'specialtyName': d['specialtyName'] ?? '',
                'status': d['status'] ?? 'selected',
                'amount': (terms['amount'] as num?)?.toInt() ?? 0,
                'startAt': _fmtIso(terms['startAt'] as String?),
                'organizationId': d['organizationId'] ?? '',
                'expiresAt': d['expiresAt'] as String? ?? '',
                'updatedAt': _relTime(d['updatedAt']),
              };
            }).toList());
  }

  /// [idempotencyKey] must stay the same across retries of one confirmation
  /// so a double tap or network retry is recognised by the server as a replay.
  static Future<void> confirmAssignment(String assignmentId, {required String idempotencyKey}) async {
    await _functions.httpsCallable('confirmAssignment').call<Map<String, dynamic>>({
      'assignmentId': assignmentId,
      'idempotencyKey': idempotencyKey,
    });
  }

  static Future<void> cancelAssignment(String assignmentId) async {
    await _functions.httpsCallable('cancelAssignment').call<Map<String, dynamic>>({
      'assignmentId': assignmentId,
    });
  }

  static Future<Map<String, dynamic>> getAssignmentContact(String assignmentId) async {
    final result = await _functions.httpsCallable('getAssignmentContact').call<Map<String, dynamic>>({
      'assignmentId': assignmentId,
    });
    return Map<String, dynamic>.from(result.data['contact'] as Map);
  }

  static Future<void> submitReview({
    required String targetId,
    required String targetType,
    required String assignmentId,
    required int rating,
    required String comment,
  }) async {
    await _functions.httpsCallable('submitFeedback').call<Map<String, dynamic>>({
      'targetId': targetId,
      'targetType': targetType,
      'assignmentId': assignmentId,
      'rating': rating,
      'comment': comment,
    });
  }

  static String _fmtIso(String? iso) {
    if (iso == null) return '—';
    try {
      return _dateFmt.format(DateTime.parse(iso).toLocal());
    } catch (_) {
      return iso;
    }
  }

  static String _relTime(dynamic ts) {
    DateTime? dt;
    if (ts is Timestamp) dt = ts.toDate();
    if (ts is String) dt = DateTime.tryParse(ts);
    if (ts is Map && ts['_seconds'] is num) {
      dt = DateTime.fromMillisecondsSinceEpoch(((ts['_seconds'] as num) * 1000).toInt());
    }
    if (dt == null) return '';
    final diff = DateTime.now().difference(dt.toLocal());
    if (diff.inDays == 0) return 'Today';
    if (diff.inDays == 1) return 'Yesterday';
    return '${diff.inDays}d ago';
  }
}
