import 'package:cloud_functions/cloud_functions.dart';

/// Where the app's backend runs.
class BackendConfig {
  /// Cloud Functions run in Mumbai, next to the Firestore database and the
  /// app's users. Must match `setGlobalOptions` in functions/src/index.ts.
  static const functionsRegion = 'asia-south1';

  /// The Cloud Functions client. Use this instead of `FirebaseFunctions.instance`,
  /// which calls us-central1 where no functions are deployed.
  static FirebaseFunctions get functions => FirebaseFunctions.instanceFor(region: functionsRegion);
}
