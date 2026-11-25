// Current device position for features that ask at the moment of use
// (practice map pin, duty alerts near me, SOS). Returns null when location is
// off or refused; callers decide what to do without it.

import 'package:geolocator/geolocator.dart';

class DeviceLocation {
  static Future<Map<String, dynamic>?> current({Duration timeLimit = const Duration(seconds: 15)}) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) return null;
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(accuracy: LocationAccuracy.high, timeLimit: timeLimit),
      );
      return {
        'latitude': pos.latitude,
        'longitude': pos.longitude,
        'accuracyMeters': pos.accuracy,
      };
    } catch (_) {
      return null;
    }
  }
}
