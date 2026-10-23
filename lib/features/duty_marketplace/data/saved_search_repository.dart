// Saved searches with new-duty alerts (blueprint §5.2).

import '../../../core/config/backend_config.dart';

class SavedSearchRepository {
  static Future<Map<String, dynamic>> _call(String name, Map<String, dynamic> data) async {
    final result = await BackendConfig.functions.httpsCallable(name).call<Map<String, dynamic>>(data);
    return Map<String, dynamic>.from(result.data);
  }

  static Future<List<Map<String, dynamic>>> list() async {
    final data = await _call('listSavedSearches', {});
    return (data['searches'] as List? ?? []).map((s) => Map<String, dynamic>.from(s as Map)).toList();
  }

  static Future<void> save({
    required String name,
    String? specialtyName,
    String? city,
    num? minPay,
    bool alertsEnabled = true,
  }) =>
      _call('saveSearch', {
        'name': name,
        if (specialtyName != null) 'specialtyName': specialtyName,
        if (city != null && city.isNotEmpty) 'city': city,
        if (minPay != null) 'minPay': minPay,
        'alertsEnabled': alertsEnabled,
      });

  static Future<void> setAlerts(String searchId, bool enabled) =>
      _call('updateSavedSearch', {'searchId': searchId, 'alertsEnabled': enabled});

  static Future<void> delete(String searchId) => _call('updateSavedSearch', {'searchId': searchId, 'delete': true});
}
