import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import '../lib/main.dart' as app;
import '../lib/core/config/local_test_config.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'Android button authenticates against the local Firebase emulator',
    (tester) async {
      expect(LocalTestConfig.enabled, isTrue);
      await app.initializeFirebaseServices();
      await FirebaseAuth.instance.signOut();
      await tester.pumpWidget(
        const ProviderScope(child: app.HealthcareWorkforceApp()),
      );
      final button = find.text('Get Verification OTP');
      for (
        var attempt = 0;
        attempt < 60 && button.evaluate().isEmpty;
        attempt++
      ) {
        await tester.pump(const Duration(seconds: 1));
      }
      expect(button, findsOneWidget);
      await tester.tap(button);
      for (var attempt = 0; attempt < 30; attempt++) {
        await tester.pump(const Duration(seconds: 1));
        if (FirebaseAuth.instance.currentUser?.email == LocalTestConfig.email)
          break;
      }
      expect(
        FirebaseAuth.instance.app.options.projectId,
        LocalTestConfig.projectId,
      );
      expect(FirebaseAuth.instance.currentUser?.email, LocalTestConfig.email);
      await tester.pump(const Duration(seconds: 1));
      expect(button, findsNothing);
    },
  );
}
