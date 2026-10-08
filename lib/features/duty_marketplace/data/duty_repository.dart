import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

class DutyRepository {
  static final _db = FirebaseFirestore.instance;
  static final _functions = FirebaseFunctions.instance;
  static final _dateFmt = DateFormat('d MMM, hh:mm a');

  static Stream<List<Map<String, dynamic>>> watchPublished({String? specialty}) {
    Query<Map<String, dynamic>> q = _db
        .collection('duties')
        .where('status', isEqualTo: 'published')
        .orderBy('createdAt', descending: true)
        .limit(50);
    if (specialty != null && specialty != 'All') {
      q = q.where('specialtyName', isEqualTo: specialty);
    }
    return q.snapshots().map(
      (snap) => snap.docs.map((doc) => _toUiMap(doc.id, doc.data())).toList(),
    );
  }

  static Future<void> applyToDuty(String dutyId, {String? note}) async {
    await _functions.httpsCallable('applyToDuty').call<Map<String, dynamic>>({
      'dutyId': dutyId,
      'idempotencyKey': const Uuid().v4(),
      if (note != null && note.isNotEmpty) 'note': note,
    });
  }

  static Future<String> createAndPublish({
    required String organizationId,
    required String facilityId,
    required String facilityName,
    required String city,
    required String department,
    required String specialtyName,
    required String qualificationRequired,
    required int experienceMinYears,
    required DateTime startAt,
    required DateTime endAt,
    required double amount,
    required int headcount,
    String? notes,
  }) async {
    final shiftType = _shiftType(startAt, endAt);
    final createResult = await _functions.httpsCallable('createDuty').call<Map<String, dynamic>>({
      'organizationId': organizationId,
      'facilityId': facilityId,
      'facilityName': facilityName,
      'city': city,
      'department': department,
      'specialtyId': specialtyName.toLowerCase().replaceAll(' ', '_'),
      'specialtyName': specialtyName,
      'qualificationRequired': qualificationRequired,
      'experienceMinYears': experienceMinYears,
      'schedule': {
        'startAt': startAt.toUtc().toIso8601String(),
        'endAt': endAt.toUtc().toIso8601String(),
        'shiftType': shiftType,
      },
      'headcount': headcount,
      'paymentTerms': {
        'amount': amount,
        'currency': 'INR',
        'basis': 'per_shift',
        'expectedPaymentTiming': 'end_of_shift',
      },
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    });
    final dutyId = (createResult.data as Map<String, dynamic>)['dutyId'] as String;
    await _functions.httpsCallable('publishDuty').call<Map<String, dynamic>>({'dutyId': dutyId});
    return dutyId;
  }

  static Map<String, dynamic> _toUiMap(String docId, Map<String, dynamic> data) {
    final schedule = data['schedule'] as Map<String, dynamic>? ?? {};
    final paymentTerms = data['paymentTerms'] as Map<String, dynamic>? ?? {};
    final startRaw = schedule['startAt'] as String?;
    final endRaw = schedule['endAt'] as String?;

    return {
      'dutyId': data['dutyId'] ?? docId,
      'facilityName': data['facilityName'] ?? 'Unknown Facility',
      'city': data['city'] ?? '',
      'distanceKm': data['distanceKm'],
      'department': data['department'] ?? '',
      'specialtyName': data['specialtyName'] ?? '',
      'qualificationRequired': data['qualificationRequired'] ?? '',
      'startAt': _fmt(startRaw),
      'endAt': _fmt(endRaw),
      'shiftType': _shiftTypeStr(startRaw, endRaw),
      'headcount': (data['headcount'] as num?)?.toInt() ?? 1,
      'remainingHeadcount': (data['remainingHeadcount'] as num?)?.toInt() ?? 1,
      'amount': (paymentTerms['amount'] as num?)?.toInt() ?? 0,
      'basis': paymentTerms['basis'] ?? 'per_shift',
      'isVerifiedOrg': data['isVerifiedOrg'] ?? false,
      'status': data['status'] ?? 'published',
      'notes': data['notes'] ?? '',
      'organizationId': data['organizationId'] ?? '',
      'facilityId': data['facilityId'] ?? '',
    };
  }

  static String _fmt(String? iso) {
    if (iso == null) return '—';
    try {
      return _dateFmt.format(DateTime.parse(iso).toLocal());
    } catch (_) {
      return iso;
    }
  }

  static String _shiftType(DateTime s, DateTime e) {
    final h = s.hour;
    if (h >= 20 || h < 6) return 'night';
    if (h < 14) return 'morning';
    return 'evening';
  }

  static String _shiftTypeStr(String? startIso, String? endIso) {
    if (startIso == null || endIso == null) return 'Shift';
    try {
      final s = DateTime.parse(startIso);
      final e = DateTime.parse(endIso);
      final hours = e.difference(s).inHours;
      if (s.hour >= 20 || s.hour < 6) return 'Night Duty ($hours hrs)';
      if (s.hour < 14) return 'Morning Shift ($hours hrs)';
      return 'Day Shift ($hours hrs)';
    } catch (_) {
      return 'Shift';
    }
  }
}
