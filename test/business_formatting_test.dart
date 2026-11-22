import 'package:flutter_test/flutter_test.dart';
import 'package:healthcare_workforce/features/business/data/business_repository.dart';

void main() {
  test('paise format with Indian digit grouping', () {
    expect(formatPaise(511800), '₹5,118.00');
    expect(formatPaise(11800), '₹118.00');
    expect(formatPaise(12345678900), '₹12,34,56,789.00');
    expect(formatPaise(180), '₹1.80');
    expect(formatPaise(null), '₹0.00');
  });

  test('standby dates are India calendar dates', () {
    expect(indiaDate(DateTime.utc(2026, 11, 22, 20)), '2026-11-23');
    expect(indiaDate(DateTime.utc(2026, 11, 22, 10)), '2026-11-22');
  });

  test('plan activity follows the end date', () {
    expect(BusinessRepository.isActive(DateTime.now().add(const Duration(days: 1)).toIso8601String()), isTrue);
    expect(BusinessRepository.isActive(DateTime.now().subtract(const Duration(days: 1)).toIso8601String()), isFalse);
    expect(BusinessRepository.isActive(null), isFalse);
  });
}
