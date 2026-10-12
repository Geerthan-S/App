import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_inputs.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/duty_post_card.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';
import '../data/duty_repository.dart';

class DutyMarketplaceScreen extends ConsumerStatefulWidget {
  const DutyMarketplaceScreen({super.key});

  @override
  ConsumerState<DutyMarketplaceScreen> createState() => _DutyMarketplaceScreenState();
}

class _DutyMarketplaceScreenState extends ConsumerState<DutyMarketplaceScreen> {
  String _selectedSpecialty = 'All';
  String _searchQuery = '';
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final loc = ref.watch(localizationProvider);

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text(loc.translate('marketplace')),
        actions: [
          IconButton(
            icon: const Icon(Icons.translate_outlined),
            tooltip: 'Change Language',
            onPressed: () => LanguageSelectorDialog.show(context),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_none_outlined),
            onPressed: () => context.push('/notifications'),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 8, AppSpacing.gutter, 12),
              child: AppSearchField(
                controller: _searchController,
                hintText: 'Search by specialty, hospital or area...',
                onChanged: (v) => setState(() => _searchQuery = v.toLowerCase()),
                showClear: _searchQuery.isNotEmpty,
                onClear: () => setState(() {
                  _searchController.clear();
                  _searchQuery = '';
                }),
              ),
            ),
            SizedBox(
              height: 42,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.gutter, vertical: 2),
                itemCount: AppConstants.specialties.length + 1,
                separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.xs),
                itemBuilder: (context, i) {
                  final label = i == 0 ? 'All' : AppConstants.specialties[i - 1];
                  return AppFilterChip(
                    label: label,
                    icon: i == 0 ? Icons.apps_outlined : null,
                    selected: _selectedSpecialty == label,
                    onTap: () => setState(() => _selectedSpecialty = label),
                  );
                },
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Expanded(
              child: StreamBuilder<List<Map<String, dynamic>>>(
                stream: DutyRepository.watchPublished(
                  specialty: _selectedSpecialty == 'All' ? null : _selectedSpecialty,
                ),
                builder: (context, snap) {
                  if (snap.connectionState == ConnectionState.waiting) {
                    return const LoadingView();
                  }
                  if (snap.hasError) {
                    return const EmptyStateView(
                      icon: Icons.cloud_off_outlined,
                      title: 'Could not load duties',
                      description: 'Check your connection and try again.',
                    );
                  }
                  var duties = snap.data ?? [];
                  if (_searchQuery.isNotEmpty) {
                    duties = duties.where((d) {
                      final facility = (d['facilityName'] as String).toLowerCase();
                      final spec = (d['specialtyName'] as String).toLowerCase();
                      final city = (d['city'] as String).toLowerCase();
                      return facility.contains(_searchQuery) ||
                          spec.contains(_searchQuery) ||
                          city.contains(_searchQuery);
                    }).toList();
                  }
                  if (duties.isEmpty) {
                    return const EmptyStateView(
                      icon: Icons.search_off_outlined,
                      title: 'No duties found',
                      description: 'Try a different specialty or check back later.',
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, 12, AppSpacing.gutter, AppSpacing.lg),
                    itemCount: duties.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                    itemBuilder: (context, index) => DutyPostCard(duty: duties[index]),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
