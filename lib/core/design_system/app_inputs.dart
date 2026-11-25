/**
 * Design System — Text Field & Input Components
 */

import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'app_typography.dart';
import 'app_spacing.dart';

class AppTextField extends StatelessWidget {
  final String label;
  final String? hintText;
  final TextEditingController? controller;
  final String? Function(String?)? validator;
  final TextInputType keyboardType;
  final bool obscureText;
  final Widget? prefixIcon;
  final Widget? suffixIcon;
  final int maxLines;
  final void Function(String)? onChanged;

  const AppTextField({
    super.key,
    required this.label,
    this.hintText,
    this.controller,
    this.validator,
    this.keyboardType = TextInputType.text,
    this.obscureText = false,
    this.prefixIcon,
    this.suffixIcon,
    this.maxLines = 1,
    this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTypography.labelBold(colors.textSecondary)),
        const SizedBox(height: AppSpacing.xs),
        TextFormField(
          controller: controller,
          validator: validator,
          keyboardType: keyboardType,
          obscureText: obscureText,
          maxLines: maxLines,
          onChanged: onChanged,
          style: AppTypography.bodyLarge(
            colors.textPrimary,
          ).copyWith(fontSize: 14),
          cursorColor: colors.accent,
          decoration: InputDecoration(
            hintText: hintText,
            prefixIcon: prefixIcon,
            suffixIcon: suffixIcon,
          ),
        ),
      ],
    );
  }
}

/// Minimal search field: flat surface, no border until focused, outline
/// search icon. Used by Search, the Marketplace and other list filters.
class AppSearchField extends StatelessWidget {
  final TextEditingController? controller;
  final String hintText;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onClear;
  final bool showClear;
  final Widget? trailing;
  final bool autofocus;

  const AppSearchField({
    super.key,
    this.controller,
    required this.hintText,
    this.onChanged,
    this.onClear,
    this.showClear = false,
    this.trailing,
    this.autofocus = false,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return TextField(
      controller: controller,
      onChanged: onChanged,
      autofocus: autofocus,
      textInputAction: TextInputAction.search,
      cursorColor: colors.accent,
      style: AppTypography.bodyLarge(colors.textPrimary).copyWith(fontSize: 14),
      decoration: InputDecoration(
        hintText: hintText,
        prefixIcon: Icon(
          Icons.search_outlined,
          color: colors.textMuted,
          size: 20,
        ),
        suffixIcon: showClear
            ? IconButton(
                icon: Icon(
                  Icons.close_outlined,
                  color: colors.textMuted,
                  size: 18,
                ),
                onPressed: onClear,
              )
            : trailing,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 15,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }
}
