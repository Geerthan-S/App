import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../lib/core/config/local_test_config.dart';
import '../lib/core/design_system/app_colors.dart';
import '../lib/features/auth/data/auth_repository.dart';
import '../lib/features/auth/presentation/login_screen.dart';

class FakeAuth extends Fake implements FirebaseAuth {}

class FakeGoogle extends Fake implements GoogleSignIn {}

class FakeCredential extends Fake implements UserCredential {}

class TestRepository extends AuthRepository {
  TestRepository({this.fail = false})
    : super(firebaseAuth: FakeAuth(), googleSignIn: FakeGoogle());
  final bool fail;
  int testLogins = 0;
  @override
  Future<UserCredential> signInToLocalTestAccount() async {
    testLogins++;
    if (fail) throw StateError('emulator offline');
    return FakeCredential();
  }
}

void main() {
  testWidgets('empty phone field signs in and opens Home in local test build', (
    tester,
  ) async {
    expect(LocalTestConfig.enabled, isTrue);
    final repository = TestRepository();
    final router = GoRouter(
      initialLocation: '/login',
      routes: [
        GoRoute(
          path: '/login',
          builder: (_, _) => LoginScreen(authRepository: repository),
        ),
        GoRoute(
          path: '/home',
          builder: (_, _) => const Scaffold(body: Text('Test account home')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp.router(
          theme: ThemeData(extensions: const [AppColorsExtension.light]),
          routerConfig: router,
        ),
      ),
    );
    await tester.tap(find.text('Get Verification OTP'));
    await tester.pumpAndSettle();
    expect(repository.testLogins, 1);
    expect(find.text('Test account home'), findsOneWidget);
  }, skip: !LocalTestConfig.enabled);

  testWidgets('emulator failure stays on login and reports failure', (
    tester,
  ) async {
    final repository = TestRepository(fail: true);
    final router = GoRouter(
      initialLocation: '/login',
      routes: [
        GoRoute(
          path: '/login',
          builder: (_, _) => LoginScreen(authRepository: repository),
        ),
        GoRoute(
          path: '/home',
          builder: (_, _) => const Text('Test account home'),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp.router(
          theme: ThemeData(extensions: const [AppColorsExtension.light]),
          routerConfig: router,
        ),
      ),
    );
    await tester.tap(find.text('Get Verification OTP'));
    await tester.pumpAndSettle();
    expect(find.text('Test account home'), findsNothing);
    expect(
      find.text('Start the local Firebase test services and try again.'),
      findsOneWidget,
    );
  }, skip: !LocalTestConfig.enabled);
  testWidgets('normal build still requires a valid phone number', (
    tester,
  ) async {
    final repository = TestRepository();
    final router = GoRouter(
      initialLocation: '/login',
      routes: [
        GoRoute(
          path: '/login',
          builder: (_, _) => LoginScreen(authRepository: repository),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp.router(
          theme: ThemeData(extensions: const [AppColorsExtension.light]),
          routerConfig: router,
        ),
      ),
    );
    await tester.tap(find.text('Get Verification OTP'));
    await tester.pumpAndSettle();
    expect(repository.testLogins, 0);
    expect(find.text('Enter a valid 10-digit mobile number'), findsOneWidget);
  }, skip: LocalTestConfig.enabled);
}
