// Attendance, plans, payments and the last-minute service.
// Reads are live Firestore streams (rules limit each to its owner); every write
// goes through a Cloud Function.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../core/config/backend_config.dart';

class BusinessRepository {
  static final _db = FirebaseFirestore.instance;

  static Future<Map<String, dynamic>> _call(String name, [Map<String, dynamic> data = const {}]) async {
    final result = await BackendConfig.functions.httpsCallable(name).call<Map<String, dynamic>>(data);
    return Map<String, dynamic>.from(result.data);
  }

  static String? get _uid => FirebaseAuth.instance.currentUser?.uid;

  // ── Attendance ────────────────────────────────────────────
  static Future<Map<String, dynamic>> issueAttendanceCode(String assignmentId, {required bool checkIn}) =>
      _call('issueAttendanceCode', {'assignmentId': assignmentId, 'kind': checkIn ? 'check_in' : 'check_out'});

  static Future<Map<String, dynamic>> scanAttendanceCode(String code, Map<String, dynamic>? location) =>
      _call('scanAttendanceCode', {'code': code, 'location': location});

  static Future<void> acknowledgeAttendance(String assignmentId, {String? note}) =>
      _call('acknowledgeAttendance', {'assignmentId': assignmentId, if (note != null && note.isNotEmpty) 'note': note});

  static Stream<Map<String, dynamic>?> watchAttendance(String assignmentId) =>
      _db.collection('attendance').doc(assignmentId).snapshots().map((d) => d.data());

  /// Confirmed and in-progress shifts of a hospital, soonest first.
  static Stream<List<Map<String, dynamic>>> watchActiveShifts(String organizationId) => _db
      .collection('assignments')
      .where('organizationId', isEqualTo: organizationId)
      .where('status', whereIn: ['confirmed', 'in_progress'])
      .limit(50)
      .snapshots()
      .map((s) {
        final list = s.docs.map((d) => {'assignmentId': d.id, ...d.data()}).toList();
        String startOf(Map<String, dynamic> a) => (a['termsSnapshot'] as Map?)?['startAt'] as String? ?? '';
        list.sort((a, b) => startOf(a).compareTo(startOf(b)));
        return list;
      });

  static Future<void> completeAssignment(String assignmentId) => _call('completeAssignment', {'assignmentId': assignmentId});

  // ── Plans ─────────────────────────────────────────────────
  static Stream<Map<String, dynamic>?> watchMySubscription() {
    final uid = _uid;
    if (uid == null) return const Stream.empty();
    return _db.collection('subscriptions').doc(uid).snapshots().map((d) => d.data());
  }

  static bool isActive(Object? untilIso) {
    if (untilIso is! String) return false;
    final until = DateTime.tryParse(untilIso);
    return until != null && until.isAfter(DateTime.now());
  }

  static Future<Map<String, dynamic>> requestSubscription(String planId) =>
      _call('requestSubscription', {'planId': planId});

  /// Payment orders the signed-in doctor placed (plans, AI).
  static Stream<List<Map<String, dynamic>>> watchMyOrders() {
    final uid = _uid;
    if (uid == null) return const Stream.empty();
    return _db
        .collection('paymentOrders')
        .where('payerUid', isEqualTo: uid)
        .orderBy('createdAt', descending: true)
        .limit(30)
        .snapshots()
        .map((s) => s.docs.map((d) => {'orderId': d.id, ...d.data()}).toList());
  }

  /// Payment orders of a hospital (duty bookings, last-minute charges).
  static Stream<List<Map<String, dynamic>>> watchOrgOrders(String organizationId) => _db
      .collection('paymentOrders')
      .where('organizationId', isEqualTo: organizationId)
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .map((s) => s.docs.map((d) => {'orderId': d.id, ...d.data()}).toList());

  // ── Early access duties (premium) ─────────────────────────
  static Stream<List<Map<String, dynamic>>> watchEarlyAccessDuties() => _db
      .collection('duties')
      .where('status', isEqualTo: 'early_access')
      .orderBy('createdAt', descending: true)
      .limit(30)
      .snapshots()
      .map((s) => s.docs.map((d) => {'dutyId': d.id, ...d.data()}).toList());

  // ── Last-minute service ───────────────────────────────────
  static Stream<Map<String, dynamic>?> watchMyStandby() {
    final uid = _uid;
    if (uid == null) return const Stream.empty();
    return _db.collection('standbyPool').doc(uid).snapshots().map((d) => d.data());
  }

  static Future<List<String>> setStandbyDates(List<String> dates, {String? note}) async {
    final result = await _call('setStandbyAvailability', {'dates': dates, if (note != null && note.isNotEmpty) 'note': note});
    return List<String>.from(result['dates'] as List? ?? const []);
  }

  static Future<Map<String, dynamic>> requestLastMinute(String dutyId) =>
      _call('requestLastMinuteConfirmation', {'dutyId': dutyId});

  static Future<Map<String, dynamic>> acceptLastMinute(String dutyId) => _call('acceptLastMinuteDuty', {'dutyId': dutyId});

  /// Duties currently searching the standby list. The server checks the date when accepting.
  static Stream<List<Map<String, dynamic>>> watchLastMinuteOffers() => _db
      .collection('duties')
      .where('status', isEqualTo: 'published')
      .where('lastMinute.status', isEqualTo: 'searching')
      .limit(30)
      .snapshots()
      .map((s) => s.docs.map((d) => {'dutyId': d.id, ...d.data()}).toList());
}

/// "₹5,118.00" from paise.
String formatPaise(Object? paise) {
  final value = (paise is num ? paise : 0) / 100;
  final whole = value.truncate();
  final fraction = ((value - whole) * 100).round().toString().padLeft(2, '0');
  final digits = whole.toString();
  // Indian grouping: last 3 digits, then groups of 2.
  final buffer = StringBuffer();
  if (digits.length <= 3) {
    buffer.write(digits);
  } else {
    final head = digits.substring(0, digits.length - 3);
    final tail = digits.substring(digits.length - 3);
    final groups = <String>[];
    for (var i = head.length; i > 0; i -= 2) {
      groups.insert(0, head.substring(i - 2 < 0 ? 0 : i - 2, i));
    }
    buffer.write('${groups.join(',')},$tail');
  }
  return '₹$buffer.$fraction';
}

/// The India date (YYYY-MM-DD) of a moment, matching the server's standby dates.
String indiaDate(DateTime moment) {
  final ist = moment.toUtc().add(const Duration(hours: 5, minutes: 30));
  String two(int n) => n.toString().padLeft(2, '0');
  return '${ist.year}-${two(ist.month)}-${two(ist.day)}';
}

/// Which modules are on, plan prices and last-minute rules (cached per session).
class BusinessFeatures {
  static Future<Map<String, dynamic>>? _cache;

  static Future<Map<String, dynamic>> load({bool refresh = false}) {
    if (refresh || _cache == null) {
      _cache = BackendConfig.functions
          .httpsCallable('getBusinessFeatures')
          .call<Map<String, dynamic>>(<String, dynamic>{})
          .then((r) => Map<String, dynamic>.from(r.data))
          .catchError((Object _) {
        _cache = null;
        return <String, dynamic>{'flags': <String, dynamic>{}, 'plans': <dynamic>[]};
      });
    }
    return _cache!;
  }

  static bool isOn(Map<String, dynamic> features, String flag) => (features['flags'] as Map?)?[flag] == true;
}
