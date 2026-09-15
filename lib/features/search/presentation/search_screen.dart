/**
 * Search Screen
 * Lets the doctor search duty/job posts from the existing mock data by
 * facility, specialty, city, or department. Tapping a result opens chat.
 */

import 'package:flutter/material.dart';
import '../../../core/constants/mock_data.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/widgets/duty_post_card.dart';
import '../../../core/widgets/state_views.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _matchingDuties {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return MockData.duties;

    return MockData.duties.where((duty) {
      final haystack = [
        duty['facilityName'],
        duty['specialtyName'],
        duty['city'],
        duty['department'],
        duty['qualificationRequired'],
      ].whereType<String>().join(' ').toLowerCase();
      return haystack.contains(query);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final results = _matchingDuties;
    final isSearching = _query.trim().isNotEmpty;

    return Scaffold(
      backgroundColor: AppColors.bgLight,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: TextField(
                controller: _searchController,
                onChanged: (value) => setState(() => _query = value),
                style: AppTypography.bodyMedium(AppColors.textLightPrimary),
                decoration: InputDecoration(
                  hintText: 'Search by facility, specialty or city...',
                  hintStyle: AppTypography.bodyMedium(AppColors.textLightMuted),
                  prefixIcon: const Icon(Icons.search_rounded, color: AppColors.textLightMuted),
                  suffixIcon: isSearching
                      ? IconButton(
                          icon: const Icon(Icons.close_rounded, color: AppColors.textLightMuted),
                          onPressed: () => setState(() {
                            _searchController.clear();
                            _query = '';
                          }),
                        )
                      : null,
                  filled: true,
                  fillColor: AppColors.surfaceElevatedLight,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    borderSide: const BorderSide(color: AppColors.borderLight),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    borderSide: const BorderSide(color: AppColors.borderLight),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Text(
                isSearching ? 'Search Results' : 'Recommended For You',
                style: AppTypography.headingSmall(AppColors.textLightPrimary),
              ),
            ),
            Expanded(
              child: results.isEmpty
                  ? const EmptyStateView(
                      icon: Icons.search_off_rounded,
                      title: 'No results found',
                      description: 'Try a different facility, specialty, or city.',
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                      itemCount: results.length,
                      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                      itemBuilder: (context, index) => DutyPostCard(duty: results[index]),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
