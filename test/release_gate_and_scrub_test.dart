import 'package:flutter_test/flutter_test.dart';
import 'package:healthcare_workforce/core/services/crash_reporting.dart';
import 'package:healthcare_workforce/core/widgets/app_release_gate.dart';
import 'package:healthcare_workforce/features/settings/data/account_repository.dart';

void main() {
  group('compareVersions', () {
    test('compares numerically, not as text', () {
      expect(compareVersions('1.10.0', '1.9.3'), 1);
      expect(compareVersions('1.2.0', '1.2.0'), 0);
      expect(compareVersions('1.2.0', '1.2.1'), -1);
    });

    test('ignores build numbers and pads short versions', () {
      expect(compareVersions('1.2.0+45', '1.2.0'), 0);
      expect(compareVersions('2', '1.9.9'), 1);
    });
  });

  group('CrashReporting.scrub', () {
    test('removes emails, phone numbers and long tokens', () {
      final out = CrashReporting.scrub(
        'user dr.rao@example.com phone +91 98765 43210 token eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9abc',
      );
      expect(out, isNot(contains('example.com')));
      expect(out, isNot(contains('98765')));
      expect(out, isNot(contains('eyJhbGci')));
      expect(out, contains('[email]'));
      expect(out, contains('[number]'));
      expect(out, contains('[token]'));
    });

    test('keeps ordinary messages readable', () {
      expect(CrashReporting.scrub('Widget build failed at step 3'), 'Widget build failed at step 3');
    });
  });

  group('NotificationPreferences', () {
    test('round-trips the server shape', () {
      final prefs = NotificationPreferences.fromMap({
        'mutedCategories': ['team'],
        'quietHours': {'enabled': true, 'start': '22:30', 'end': '06:00'},
      });
      expect(prefs.muted, {'team'});
      expect(prefs.toMap(), {
        'mutedCategories': ['team'],
        'quietHours': {'enabled': true, 'start': '22:30', 'end': '06:00'},
      });
    });

    test('defaults when the server has nothing stored', () {
      final prefs = NotificationPreferences.fromMap({});
      expect(prefs.muted, isEmpty);
      expect(prefs.quietEnabled, isFalse);
      expect(prefs.quietStart, '22:00');
    });
  });
}
