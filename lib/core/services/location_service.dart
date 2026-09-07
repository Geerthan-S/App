/**
 * Geospatial Distance Helper & Navigation Service
 */

import 'dart:math' as math;
import 'package:url_launcher/url_launcher.dart';

class LocationService {
  /// Calculates Haversine distance in kilometers rounded to 1 decimal place
  static double calculateDistanceKm({
    required double lat1,
    required double lon1,
    required double lat2,
    required double lon2,
  }) {
    const double p = 0.017453292519943295; // Math.PI / 180
    final double a = 0.5 -
        math.cos((lat2 - lat1) * p) / 2 +
        math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2;
    final double rawKm = 12742 * math.asin(math.sqrt(a)); // 2 * R; R = 6371 km
    return (rawKm * 10).roundToDouble() / 10.0;
  }

  /// Launches Google Maps Navigation Intent to the specified coordinates
  static Future<bool> launchNavigationIntent(double lat, double lng, {String? label}) async {
    final uri = Uri.parse('geo:$lat,$lng?q=$lat,$lng(${Uri.encodeComponent(label ?? 'Duty Facility')})');
    final fallbackWebUri = Uri.parse('https://www.google.com/maps/search/?api=1&query=$lat,$lng');

    try {
      if (await canLaunchUrl(uri)) {
        return await launchUrl(uri);
      } else {
        return await launchUrl(fallbackWebUri, mode: LaunchMode.externalApplication);
      }
    } catch (_) {
      return false;
    }
  }
}
