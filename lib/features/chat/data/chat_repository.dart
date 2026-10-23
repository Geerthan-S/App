// Doctor ↔ hospital chat. Threads and messages are read live from Firestore
// (rules allow only the two sides); every write goes through a callable.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../core/config/backend_config.dart';

/// Which side of a thread the viewer is on.
enum ChatSide { doctor, organization }

extension ChatSideKey on ChatSide {
  String get key => this == ChatSide.doctor ? 'doctor' : 'organization';
}

class ChatThread {
  final String id;
  final String organizationId;
  final String organizationName;
  final String doctorId;
  final String doctorName;
  final String? dutyTitle;
  final String? lastText;
  final String? lastSenderSide;
  final DateTime? lastAt;
  final Map<String, int> unread;
  final bool isDemo;

  const ChatThread({
    required this.id,
    required this.organizationId,
    required this.organizationName,
    required this.doctorId,
    required this.doctorName,
    this.dutyTitle,
    this.lastText,
    this.lastSenderSide,
    this.lastAt,
    this.unread = const {},
    this.isDemo = false,
  });

  factory ChatThread.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? {};
    final last = d['lastMessage'] as Map<String, dynamic>?;
    final unread = (d['unread'] as Map<String, dynamic>? ?? {}).map((k, v) => MapEntry(k, (v as num?)?.toInt() ?? 0));
    return ChatThread(
      id: doc.id,
      organizationId: d['organizationId'] as String? ?? '',
      organizationName: d['organizationName'] as String? ?? 'Hospital',
      doctorId: d['doctorId'] as String? ?? '',
      doctorName: d['doctorName'] as String? ?? 'Doctor',
      dutyTitle: d['dutyTitle'] as String?,
      lastText: last?['text'] as String?,
      lastSenderSide: last?['senderSide'] as String?,
      lastAt: (last?['at'] as Timestamp?)?.toDate() ?? (d['updatedAt'] as Timestamp?)?.toDate(),
      unread: unread,
      isDemo: d['isDemo'] == true,
    );
  }

  /// The other party's name, as the viewer sees it.
  String counterpartName(ChatSide viewer) => viewer == ChatSide.doctor ? organizationName : doctorName;

  int unreadFor(ChatSide viewer) => unread[viewer.key] ?? 0;
}

class ChatMessage {
  final String id;
  final String senderSide;
  final String senderName;
  final String text;
  final DateTime? at;

  const ChatMessage({required this.id, required this.senderSide, required this.senderName, required this.text, this.at});

  factory ChatMessage.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data();
    return ChatMessage(
      id: doc.id,
      senderSide: d['senderSide'] as String? ?? 'doctor',
      senderName: d['senderName'] as String? ?? '',
      text: d['text'] as String? ?? '',
      at: (d['createdAt'] as Timestamp?)?.toDate(),
    );
  }
}

class ChatRepository {
  static final _db = FirebaseFirestore.instance;

  static Future<Map<String, dynamic>> _call(String name, Map<String, dynamic> data) async {
    final result = await BackendConfig.functions.httpsCallable(name).call<Map<String, dynamic>>(data);
    return Map<String, dynamic>.from(result.data);
  }

  /// Threads where the signed-in user is the doctor.
  static Stream<List<ChatThread>> watchDoctorThreads() {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return const Stream.empty();
    return _db
        .collection('conversations')
        .where('doctorId', isEqualTo: uid)
        .orderBy('updatedAt', descending: true)
        .limit(100)
        .snapshots()
        .map((s) => s.docs.map(ChatThread.fromDoc).toList());
  }

  /// Threads of a hospital the user belongs to.
  static Stream<List<ChatThread>> watchOrgThreads(String organizationId) => _db
      .collection('conversations')
      .where('organizationId', isEqualTo: organizationId)
      .orderBy('updatedAt', descending: true)
      .limit(100)
      .snapshots()
      .map((s) => s.docs.map(ChatThread.fromDoc).toList());

  static Stream<int> watchUnread({String? organizationId}) {
    final side = organizationId == null ? ChatSide.doctor : ChatSide.organization;
    final threads = organizationId == null ? watchDoctorThreads() : watchOrgThreads(organizationId);
    return threads.map((list) => list.fold<int>(0, (total, t) => total + t.unreadFor(side)));
  }

  static Stream<ChatThread?> watchThread(String conversationId) =>
      _db.collection('conversations').doc(conversationId).snapshots().map((d) => d.exists ? ChatThread.fromDoc(d) : null);

  static Stream<List<ChatMessage>> watchMessages(String conversationId) => _db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .orderBy('createdAt')
      .limitToLast(300)
      .snapshots()
      .map((s) => s.docs.map(ChatMessage.fromDoc).toList());

  static Future<void> send(String conversationId, String text) =>
      _call('sendChatMessage', {'conversationId': conversationId, 'text': text});

  static Future<void> markRead(String conversationId) => _call('markConversationRead', {'conversationId': conversationId});

  /// Opens (or reuses) the thread for a duty. Hospital staff pass the applicant.
  static Future<String> start({required String dutyId, String? doctorId}) async {
    final data = await _call('startConversation', {'dutyId': dutyId, if (doctorId != null) 'doctorId': doctorId});
    return data['conversationId'] as String;
  }
}
