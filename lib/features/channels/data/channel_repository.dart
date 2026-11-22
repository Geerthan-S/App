// Community channels and the AI assistant. Members read messages live from
// Firestore; posting, joining and moderation go through Cloud Functions.
// Media is read with the signed-in user's permissions (no public links).

import 'dart:io';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:uuid/uuid.dart';
import '../../../core/config/backend_config.dart';

class ChannelRepository {
  static final _db = FirebaseFirestore.instance;

  static Future<Map<String, dynamic>> _call(String name, [Map<String, dynamic> data = const {}]) async {
    final result = await BackendConfig.functions.httpsCallable(name).call<Map<String, dynamic>>(data);
    return Map<String, dynamic>.from(result.data);
  }

  static String? get uid => FirebaseAuth.instance.currentUser?.uid;

  /// Channels the user belongs to, by membership index, newest first.
  static Stream<List<String>> watchMyChannelIds() {
    final me = uid;
    if (me == null) return const Stream.empty();
    return _db
        .collection('channelMemberships')
        .where('uid', isEqualTo: me)
        .limit(200)
        .snapshots()
        .map((s) => s.docs.map((d) => d.data()['channelId'] as String).toList());
  }

  static Stream<Map<String, dynamic>?> watchChannel(String channelId) =>
      _db.collection('channels').doc(channelId).snapshots().map((d) => d.exists ? {'channelId': d.id, ...d.data()!} : null);

  static Stream<Map<String, dynamic>?> watchMyMembership(String channelId) {
    final me = uid;
    if (me == null) return const Stream.empty();
    return _db.collection('channels').doc(channelId).collection('members').doc(me).snapshots().map((d) => d.data());
  }

  static Stream<List<Map<String, dynamic>>> watchMessages(String channelId) => _db
      .collection('channels')
      .doc(channelId)
      .collection('messages')
      .orderBy('createdAt')
      .limitToLast(200)
      .snapshots()
      .map((s) => s.docs.map((d) => {'messageId': d.id, ...d.data()}).toList());

  static Future<List<Map<String, dynamic>>> recommended({String search = ''}) async {
    final result = await _call('listRecommendedChannels', {if (search.isNotEmpty) 'search': search});
    return List<Map<String, dynamic>>.from((result['channels'] as List).map((e) => Map<String, dynamic>.from(e as Map)));
  }

  static Future<Map<String, dynamic>> create({
    required String name,
    String description = '',
    List<String> tags = const [],
    bool private = false,
  }) =>
      _call('createChannel', {'name': name, 'description': description, 'tags': tags, 'visibility': private ? 'private' : 'public'});

  static Future<void> join(String channelId) => _call('joinChannel', {'channelId': channelId});

  static Future<String> joinByCode(String code) async => (await _call('joinChannelByCode', {'inviteCode': code}))['channelId'] as String;

  static Future<void> leave(String channelId) => _call('leaveChannel', {'channelId': channelId});

  static Future<String?> inviteCode(String channelId) async => (await _call('getChannelInvite', {'channelId': channelId}))['inviteCode'] as String?;

  static Future<void> sendText(String channelId, String text) =>
      _call('sendChannelMessage', {'channelId': channelId, 'type': 'text', 'text': text});

  /// Uploads into the member's own folder, then posts the message.
  static Future<void> sendMedia(String channelId, {required File file, required bool voice, int? durationSeconds, String caption = ''}) async {
    final me = uid!;
    final ext = voice ? 'm4a' : 'jpg';
    final path = 'channels/$channelId/$me/${const Uuid().v4()}.$ext';
    await FirebaseStorage.instance.ref(path).putFile(file, SettableMetadata(contentType: voice ? 'audio/mp4' : 'image/jpeg'));
    await _call('sendChannelMessage', {
      'channelId': channelId,
      'type': voice ? 'voice' : 'image',
      'text': caption,
      'mediaPath': path,
      if (durationSeconds != null) 'durationSeconds': durationSeconds,
    });
  }

  static final Map<String, Uint8List> _mediaCache = {};

  static Future<Uint8List?> mediaBytes(String path) async {
    if (_mediaCache.containsKey(path)) return _mediaCache[path];
    final bytes = await FirebaseStorage.instance.ref(path).getData(6 * 1024 * 1024);
    if (bytes != null) _mediaCache[path] = bytes;
    return bytes;
  }

  static Future<void> deleteMessage(String channelId, String messageId) =>
      _call('deleteChannelMessage', {'channelId': channelId, 'messageId': messageId});

  static Future<void> report(String channelId, String messageId, String reason, {String? details}) =>
      _call('reportChannelMessage', {'channelId': channelId, 'messageId': messageId, 'reason': reason, if (details != null) 'details': details});

  // ── AI assistant ──────────────────────────────────────────
  static Stream<List<Map<String, dynamic>>> watchAiThread() {
    final me = uid;
    if (me == null) return const Stream.empty();
    return _db
        .collection('aiThreads')
        .doc(me)
        .collection('messages')
        .orderBy('createdAtMs')
        .limitToLast(100)
        .snapshots()
        .map((s) => s.docs.map((d) => d.data()).toList());
  }

  static Future<Map<String, dynamic>> aiStatus() => _call('getAssistantStatus');

  static Future<Map<String, dynamic>> ask(String question, {File? image, bool consent = false}) async {
    String? imagePath;
    if (image != null) {
      imagePath = 'ai/${uid!}/${const Uuid().v4()}.jpg';
      await FirebaseStorage.instance.ref(imagePath).putFile(image, SettableMetadata(contentType: 'image/jpeg'));
    }
    return _call('askAssistant', {
      'question': question,
      if (imagePath != null) 'imagePath': imagePath,
      if (imagePath != null) 'patientConsentConfirmed': consent,
    });
  }
}
