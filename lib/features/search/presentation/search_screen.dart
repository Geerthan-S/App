import 'package:flutter/material.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/widgets/duty_post_card.dart';
import '../../../core/widgets/state_views.dart';
import '../../duty_marketplace/data/duty_repository.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final TextEditingController _searchController = TextEditingController();
  List<Map<String, dynamic>> _allDuties = [];
  String _query = '';

  @override
  void initState() {
    super.initState();
    DutyRepository.watchPublished().listen((duties) {
      if (mounted) setState(() => _allDuties = duties);
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _matchingDuties {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _allDuties;
    return _allDuties.where((duty) {
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
    final colors = context.appColors;
    final results = _matchingDuties;
    final isSearching = _query.trim().isNotEmpty;

    return Scaffold(
      backgroundColor: colors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: TextField(
                controller: _searchController,
                onChanged: (value) => setState(() => _query = value),
                style: AppTypography.bodyMedium(colors.textPrimary),
                decoration: InputDecoration(
                  hintText: 'Search by facility, specialty or city...',
                  hintStyle: AppTypography.bodyMedium(colors.textMuted),
                  prefixIcon: Icon(Icons.search_rounded, color: colors.textMuted),
                  suffixIcon: isSearching
                      ? IconButton(
                          icon: Icon(Icons.close_rounded, color: colors.textMuted),
                          onPressed: () => setState(() {
                            _searchController.clear();
                            _query = '';
                          }),
                        )
                      : null,
                  filled: true,
                  fillColor: colors.surfaceElevated,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    borderSide: BorderSide(color: colors.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    borderSide: BorderSide(color: colors.border),
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
                style: AppTypography.headingSmall(colors.textPrimary),
              ),
            ),
            Expanded(
              child: results.isEmpty
                  ? EmptyStateView(
                      icon: isSearching ? Icons.search_off_rounded : Icons.inbox_outlined,
                      title: isSearching ? 'No results found' : 'No duties available',
                      description: isSearching
                          ? 'Try a different facility, specialty, or city.'
                          : 'New duties matching your specialty will appear here.',
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
