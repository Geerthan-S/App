/**
 * Floating Frosted Bottom Navigation Bar
 * Home / Search / Add Post / Messages / Profile
 *
 * Controlled glassmorphism: a rounded, translucent white bar floating above
 * the content with a light blur, hairline border and a diffuse shadow. Every
 * item shows an outline icon with a label; the selected item sits in a soft
 * accent-tinted pill.
 */

import 'dart:ui';

import 'package:flutter/material.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_spacing.dart';
import '../design_system/app_typography.dart';

class _NavDestination {
  final IconData icon;
  final String label;

  const _NavDestination({
    required this.icon,
    required this.label,
  });
}

class AppBottomNavBar extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onTap;

  const AppBottomNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  static const List<_NavDestination> _destinations = [
    _NavDestination(icon: Icons.home_outlined, label: 'Home'),
    _NavDestination(icon: Icons.search_outlined, label: 'Search'),
    _NavDestination(icon: Icons.add_box_outlined, label: 'Add Post'),
    _NavDestination(icon: Icons.chat_bubble_outline_outlined, label: 'Messages'),
    _NavDestination(icon: Icons.person_outline_outlined, label: 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final double bottomInset = MediaQuery.of(context).padding.bottom;
    final radius = BorderRadius.circular(AppSpacing.radiusXl);

    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, bottomInset > 0 ? bottomInset : 12),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: radius,
          boxShadow: [
            BoxShadow(
              color: colors.shadow.withValues(alpha: colors.shadow.a * 1.6),
              blurRadius: 28,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: radius,
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
            child: Container(
              height: 68,
              padding: const EdgeInsets.symmetric(horizontal: 6),
              decoration: BoxDecoration(
                color: colors.surface.withValues(alpha: 0.86),
                borderRadius: radius,
                border: Border.all(color: colors.border.withValues(alpha: 0.9)),
              ),
              child: Row(
                children: List.generate(
                  _destinations.length,
                  (index) => Expanded(child: _buildNavItem(colors, index)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem(AppColorsExtension colors, int index) {
    final destination = _destinations[index];
    final bool isActive = index == currentIndex;
    final Color fg = isActive ? colors.accent : colors.textMuted;

    return Semantics(
      selected: isActive,
      button: true,
      label: destination.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => onTap(index),
        child: Center(
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: isActive ? colors.accentSoft : Colors.transparent,
              borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(destination.icon, size: 22, color: fg),
                const SizedBox(height: 3),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    destination.label,
                    maxLines: 1,
                    softWrap: false,
                    style: AppTypography.bodySmall(fg).copyWith(
                      fontSize: 10.5,
                      height: 1.1,
                      fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
