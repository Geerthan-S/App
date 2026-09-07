/**
 * Secure Local Storage Service
 * Wraps flutter_secure_storage for encrypted local data, tokens, and preferences.
 */

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStorageService {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(
      encryptedSharedPreferences: true,
    ),
  );

  static const String keyAuthToken = 'auth_token';
  static const String keyUserRole = 'user_active_role';
  static const String keyLanguage = 'preferred_language';

  static Future<void> write(String key, String value) async {
    await _storage.write(key: key, value: value);
  }

  static Future<String?> read(String key) async {
    return await _storage.read(key: key);
  }

  static Future<void> delete(String key) async {
    await _storage.delete(key: key);
  }

  static Future<void> clearAll() async {
    await _storage.deleteAll();
  }
}
