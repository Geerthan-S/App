/**
 * Design System — Typography Tokens
 */

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppTypography {
  static TextStyle headingLarge(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 24,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.5,
    color: color,
  );

  static TextStyle headingMedium(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 20,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.3,
    color: color,
  );

  static TextStyle headingSmall(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 16,
    fontWeight: FontWeight.w600,
    color: color,
  );

  static TextStyle bodyLarge(Color color) => GoogleFonts.inter(
    fontSize: 15,
    fontWeight: FontWeight.w500,
    color: color,
  );

  static TextStyle bodyMedium(Color color) => GoogleFonts.inter(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    color: color,
  );

  static TextStyle bodySmall(Color color) => GoogleFonts.inter(
    fontSize: 11,
    fontWeight: FontWeight.w400,
    color: color,
  );

  static TextStyle labelBold(Color color) => GoogleFonts.plusJakartaSans(
    fontSize: 12,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.2,
    color: color,
  );
}
