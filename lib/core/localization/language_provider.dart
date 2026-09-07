/**
 * Riverpod Language State Management Provider
 * Supports reactive locale switching across the application.
 */

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app_localizations.dart';

class LanguageNotifier extends StateNotifier<String> {
  LanguageNotifier() : super('en');

  void setLanguage(String code) {
    state = code;
  }
}

final languageProvider = StateNotifierProvider<LanguageNotifier, String>((ref) {
  return LanguageNotifier();
});

final localizationProvider = Provider<AppLocalizations>((ref) {
  final langCode = ref.watch(languageProvider);
  return AppLocalizations(langCode);
});
