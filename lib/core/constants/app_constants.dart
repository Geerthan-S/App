/**
 * Application Constants & Master Data
 */

class AppConstants {
  static const String appName = 'HealthForce';
  static const String packageName = 'com.geerthan.healthcareworkforce';
  static const String currentConsentVersion = 'v1.0_2026';

  // Centralized Assignment Offer Expiry Policy
  static const int defaultOfferExpiryHours = 12;
  static const String defaultOfferExpiryLabel = '12 Hours';

  // Supported Languages
  static const Map<String, String> supportedLanguages = {
    'en': 'English',
    'ta': 'தமிழ் (Tamil)',
    'hi': 'हिन्दी (Hindi)',
    'te': 'తెలుగు (Telugu)',
    'ml': 'മലയാളം (Malayalam)',
    'kn': 'ಕನ್ನಡ (Kannada)',
  };

  // Major Indian Medical Councils
  static const List<String> medicalCouncils = [
    'National Medical Commission (NMC)',
    'Tamil Nadu Medical Council',
    'Karnataka Medical Council',
    'Maharashtra Medical Council',
    'Delhi Medical Council',
    'Andhra Pradesh Medical Council',
    'Telangana State Medical Council',
    'Kerala State Medical Council',
    'West Bengal Medical Council',
    'Gujarat Medical Council',
  ];

  // Clinical Specialties
  static const List<String> specialties = [
    'General Medicine',
    'Emergency & Critical Care',
    'General Surgery',
    'Pediatrics',
    'Obstetrics & Gynecology',
    'Anesthesiology',
    'Orthopedics',
    'Cardiology',
    'Dermatology',
    'Pulmonology',
    'Radiology',
    'Psychiatry',
  ];

  // Primary Metro & Tier-1/2 Hubs
  static const List<String> majorCities = [
    'Chennai',
    'Bengaluru',
    'Hyderabad',
    'Mumbai',
    'Delhi NCR',
    'Kolkata',
    'Coimbatore',
    'Kochi',
    'Pune',
    'Ahmedabad',
  ];
}
