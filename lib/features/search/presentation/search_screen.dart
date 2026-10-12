import 'dart:async';

import 'package:flutter/material.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/widgets/duty_post_card.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../duty_marketplace/data/duty_repository.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  static const String _anyShift = 'Any shift';
  static const String _allSpecialties = 'All specialties';
  static const List<String> _shiftFilters = [_anyShift, 'Morning', 'Day', 'Night'];

  final TextEditingController _searchController = TextEditingController();
  StreamSubscription<List<Map<String, dynamic>>>? _subscription;
  List<Map<String, dynamic>> _allDuties = [];
  bool _loaded = false;
  String _query = '';
  String _specialty = _allSpecialties;
  String _shift = _anyShift;

  @override
  void initState() {
    super.initState();
    _subscription = DutyRepository.watchPublished().listen((duties) {
      if (mounted) {
        setState(() {
          _allDuties = duties;
          _loaded = true;
        });
      }
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  List<String> get _specialties {
    final set = <String>{
      for (final d in _allDuties)
        if ((d['specialtyName'] as String? ?? '').isNotEmpty) d['specialtyName'] as String,
    };
    return set.toList()..sort();
  }

  List<Map<String, dynamic>> get _matchingDuties {
    final query = _query.trim().toLowerCase();
    return _allDuties.where((duty) {
      if (_specialty != _allSpecialties && duty['specialtyName'] != _specialty) return false;
      if (_shift != _anyShift) {
        final shiftType = (duty['shiftType'] as String? ?? '').toLowerCase();
        if (!shiftType.startsWith(_shift.toLowerCase())) return false;
      }
      if (query.isEmpty) return true;
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

  bool get _hasFilters => _specialty != _allSpecialties || _shift != _anyShift;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final results = _matchingDuties;
    final isSearching = _query.trim().isNotEmpty || _hasFilters;
    final specialties = _specialties;
    if (!specialties.contains(_specialty)) _specialty = _allSpecialties;

    return Scaffold(
      backgroundColor: colors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 16, AppSpacing.gutter, 0),
              child: Text('Search', style: AppTypography.headingLarge(colors.textPrimary)),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 4, AppSpacing.gutter, 16),
              child: Text(
                'Find duties by hospital, specialty or city',
                style: AppTypography.bodyMedium(colors.textSecondary),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.gutter),
              child: AppSearchField(
                controller: _searchController,
                hintText: 'Search by facility, specialty or city...',
                onChanged: (value) => setState(() => _query = value),
                showClear: _query.trim().isNotEmpty,
                onClear: () => setState(() {
                  _searchController.clear();
                  _query = '';
                }),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            _FilterRow(
              icon: Icons.schedule_outlined,
              options: _shiftFilters,
              selected: _shift,
              onSelected: (v) => setState(() => _shift = v),
            ),
            if (specialties.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.xs),
              _FilterRow(
                icon: Icons.medical_services_outlined,
                options: [_allSpecialties, ...specialties],
                selected: _specialty,
                onSelected: (v) => setState(() => _specialty = v),
              ),
            ],
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 20, AppSpacing.gutter, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      isSearching ? 'Search Results' : 'Recommended For You',
                      style: AppTypography.headingMedium(colors.textPrimary).copyWith(fontSize: 17),
                    ),
                  ),
                  if (_loaded)
                    Text(
                      '${results.length} ${results.length == 1 ? 'duty' : 'duties'}',
                      style: AppTypography.bodySmall(colors.textSecondary),
                    ),
                  if (_hasFilters) ...[
                    const SizedBox(width: AppSpacing.sm),
                    GestureDetector(
                      onTap: () => setState(() {
                        _specialty = _allSpecialties;
                        _shift = _anyShift;
                      }),
                      child: Text('Clear', style: AppTypography.labelBold(colors.accent)),
                    ),
                  ],
                ],
              ),
            ),
            Expanded(
              child: !_loaded
                  ? const LoadingView()
                  : results.isEmpty
                      ? SingleChildScrollView(
                          child: EmptyStateView(
                            icon: isSearching ? Icons.search_off_outlined : Icons.inbox_outlined,
                            title: isSearching ? 'No results found' : 'No duties available',
                            description: isSearching
                                ? 'Try a different facility, specialty, or city.'
                                : 'New duties matching your specialty will appear here.',
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(
                            AppSpacing.gutter, 0, AppSpacing.gutter, AppSpacing.navBarClearance),
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

class _FilterRow extends StatelessWidget {
  final IconData icon;
  final List<String> options;
  final String selected;
  final ValueChanged<String> onSelected;

  const _FilterRow({
    required this.icon,
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.gutter, vertical: 2),
        itemCount: options.length,
        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.xs),
        itemBuilder: (context, i) => AppFilterChip(
          label: options[i],
          icon: i == 0 ? icon : null,
          selected: options[i] == selected,
          onTap: () => onSelected(options[i]),
        ),
      ),
    );
  }
}
