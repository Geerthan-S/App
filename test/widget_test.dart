import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:healthcare_workforce/core/design_system/app_theme.dart';
import 'package:healthcare_workforce/core/errors/error_envelope.dart';
import 'package:healthcare_workforce/features/auth/presentation/consent_screen.dart';

void main() {
  group('callable domain error codes', () {
    test('reads the server domain code from details', () {
      final e = FirebaseFunctionsException(
        message: 'Assignment offer has expired',
        code: 'deadline-exceeded',
        details: {'code': 'OFFER_EXPIRED', 'correlationId': 'corr_1'},
      );
      expect(e.domainCode, 'OFFER_EXPIRED');
    });

    test('falls back to the transport code when no domain code is present', () {
      final e = FirebaseFunctionsException(message: 'boom', code: 'unavailable');
      expect(e.domainCode, 'unavailable');
    });
  });

  testWidgets('consent screen offers an explicit accept action', (tester) async {
    await tester.pumpWidget(ProviderScope(child: MaterialApp(theme: AppTheme.lightTheme, home: const ConsentScreen())));
    expect(find.text('Healthcare Integrity Consent'), findsOneWidget);
    expect(find.text('I Accept & Agree'), findsOneWidget);
  });
}
