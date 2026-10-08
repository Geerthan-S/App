import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:intl/intl.dart';

class NotificationRepository {
  static final _db = FirebaseFirestore.instance;
  static final _fmt = DateFormat('d MMM');

  static String? get _uid => FirebaseAuth.instance.currentUser?.uid;

  static Stream<List<Map<String, dynamic>>> watchAll() {
    final uid = _uid;
    if (uid == null) return const Stream.empty();
    return _db
        .collection('inboxNotifications')
        .where('userId', isEqualTo: uid)
        .orderBy('createdAt', descending: true)
        .limit(50)
        .snapshots()
        .map((snap) => snap.docs.map((doc) => _toUiMap(doc.id, doc.data())).toList());
  }

  static Stream<int> watchUnreadCount() {
    final uid = _uid;
    if (uid == null) return Stream.value(0);
    return _db
        .collection('inboxNotifications')
        .where('userId', isEqualTo: uid)
        .where('isRead', isEqualTo: false)
        .snapshots()
        .map((snap) => snap.docs.length);
  }

  static Future<void> markRead(String notifId) {
    return _db.collection('inboxNotifications').doc(notifId).update({
      'isRead': true,
      'readAt': FieldValue.serverTimestamp(),
    });
  }

  static Map<String, dynamic> _toUiMap(String docId, Map<String, dynamic> data) {
    final payload = data['payload'] as Map<String, dynamic>? ?? {};
    return {
      'notificationId': docId,
      'type': data['type'] ?? 'info',
      'title': data['title'] ?? '',
      'body': data['body'] ?? '',
      'time': _relTime(data['createdAt']),
      'isRead': data['isRead'] ?? false,
      'dutyId': payload['dutyId'],
    };
  }

  static String _relTime(dynamic ts) {
    DateTime? dt;
    if (ts is Timestamp) {
      dt = ts.toDate();
    } else if (ts is String) {
      dt = DateTime.tryParse(ts);
    }
    if (dt == null) return '';
    final diff = DateTime.now().difference(dt.toLocal());
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays == 1) return 'Yesterday';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return _fmt.format(dt.toLocal());
  }
}
