/**
 * Floating Bottom Navigation Bar
 * Home / Search / Post / Duties / Profile
 *
 * A solid rounded surface floating above the content with a diffuse shadow.
 * Inactive destinations are muted outline icons; the selected destination
 * becomes a dark ink pill showing its icon and label. The "Duties" tab is the
 * existing `/messages` branch, which hosts My Duties (offers, confirmed and
 * completed assignments).
 */

import 'package:flutter/material.dart';
import '../design_system/app_colors.dart';
import '../design_system/app_spacing.dart';
import '../design_system/app_typography.dart';

class _NavDestination {
  final IconData icon;
  final String label;

  const _NavDestination({required this.icon, required this.label});
}

class AppBottomNavBar extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onTap;

  const AppBottomNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  /// Order must match the shell branches in `app_router.dart`.
  static const List<_NavDestination> _destinations = [
    _NavDestination(icon: Icons.home_outlined, label: 'Home'),
    _NavDestination(icon: Icons.search_outlined, label: 'Search'),
    _NavDestination(icon: Icons.add_box_outlined, label: 'Post'),
    _NavDestination(icon: Icons.event_note_outlined, label: 'Duties'),
    _NavDestination(icon: Icons.person_outline_outlined, label: 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final double bottomInset = MediaQuery.of(context).padding.bottom;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        0,
        16,
        bottomInset > 0 ? bottomInset + 4 : 14,
      ),
      child: Container(
        height: 64,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(22),
          boxShadow: AppShadows.soft(colors),
        ),
        child: Row(
          children: List.generate(
            _destinations.length,
            (index) => Expanded(
              // The selected pill carries a label, so it gets more room.
              flex: index == currentIndex ? 2 : 1,
              child: _buildNavItem(colors, index),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem(AppColorsExtension colors, int index) {
    final destination = _destinations[index];
    final bool isActive = index == currentIndex;

    return Semantics(
      selected: isActive,
      button: true,
      label: destination.label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => onTap(index),
        child: Center(
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            height: 44,
            padding: EdgeInsets.symmetric(horizontal: isActive ? 14 : 0),
            decoration: BoxDecoration(
              color: isActive ? colors.accent : Colors.transparent,
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  destination.icon,
                  size: isActive ? 19 : 22,
                  color: isActive ? colors.onAccent : colors.textMuted,
                ),
                if (isActive) ...[
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      destination.label,
                      maxLines: 1,
                      softWrap: false,
                      overflow: TextOverflow.fade,
                      style: AppTypography.labelBold(
                        colors.onAccent,
                      ).copyWith(fontSize: 12.5),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
