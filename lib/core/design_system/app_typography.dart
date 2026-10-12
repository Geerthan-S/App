/**
 * Design System — Typography Tokens
 *
 * One clean sans-serif family (Plus Jakarta Sans) with a restrained
 * hierarchy: page title → section heading → card title → body → metadata.
 */

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppTypography {
  /// Large page titles and greetings.
  static TextStyle display(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 26,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.6,
    height: 1.2,
    color: color,
  );

  /// Page titles.
  static TextStyle headingLarge(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 22,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.4,
    height: 1.25,
    color: color,
  );

  /// Section headings and app bar titles.
  static TextStyle headingMedium(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 18,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.2,
    height: 1.3,
    color: color,
  );

  /// Card titles.
  static TextStyle headingSmall(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.1,
    height: 1.35,
    color: color,
  );

  static TextStyle bodyLarge(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 15,
    fontWeight: FontWeight.w500,
    height: 1.45,
    color: color,
  );

  static TextStyle bodyMedium(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    height: 1.45,
    color: color,
  );

  /// Metadata and captions.
  static TextStyle bodySmall(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    height: 1.4,
    color: color,
  );

  static TextStyle labelBold(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 13,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
    color: color,
  );

  /// Small uppercase-free overline used above grouped fields.
  static TextStyle overline(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 11,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.6,
    color: color,
  );
}
