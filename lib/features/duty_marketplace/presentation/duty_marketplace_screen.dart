/**
 * Duty Marketplace Screen — Doctor Browse, Search & Filter
 */

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/mock_data.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/language_selector_dialog.dart';
import '../../../core/localization/language_provider.dart';

class DutyMarketplaceScreen extends ConsumerStatefulWidget {
  const DutyMarketplaceScreen({super.key});

  @override
  ConsumerState<DutyMarketplaceScreen> createState() => _DutyMarketplaceScreenState();
}

class _DutyMarketplaceScreenState extends ConsumerState<DutyMarketplaceScreen> {
  String _selectedSpecialty = 'All';
  String _selectedSort = 'Nearest';
  final _searchController = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final loc = ref.watch(localizationProvider);
    final filteredDuties = _selectedSpecialty == 'All'
        ? MockData.duties
        : MockData.duties.where((d) => d['specialtyName'] == _selectedSpecialty).toList();

    return Scaffold(
      appBar: AppBar(
        title: Text(loc.translate('marketplace')),
        actions: [
          IconButton(
            icon: const Icon(Icons.language_rounded),
            tooltip: 'Change Language',
            onPressed: () => LanguageSelectorDialog.show(context),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => context.push('/notifications'),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Search & Filter Header
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: TextField(
                controller: _searchController,
                style: AppTypography.bodyMedium(colors.textPrimary),
                decoration: InputDecoration(
                  hintText: 'Search by specialty, hospital or area...',
                  hintStyle: AppTypography.bodyMedium(colors.textMuted),
                  prefixIcon: Icon(Icons.search_rounded, color: colors.textMuted),
                  filled: true,
                  fillColor: colors.surfaceElevated,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    borderSide: BorderSide(color: colors.border),
                  ),
                ),
              ),
            ),

            // Specialty Filter Chips
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: [
                  _buildFilterChip('All'),
                  ...AppConstants.specialties.map((s) => _buildFilterChip(s)),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.xs),

            // Duty Feed List
            Expanded(
              child: ListView.separated(
                padding: AppSpacing.paddingScreen,
                itemCount: filteredDuties.length,
                separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                itemBuilder: (context, index) {
                  final duty = filteredDuties[index];
                  return _buildDutyCard(context, duty);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterChip(String label) {
    final colors = context.appColors;
    final isSelected = _selectedSpecialty == label;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label),
        selected: isSelected,
        labelStyle: AppTypography.labelBold(isSelected ? Colors.white : colors.textSecondary),
        backgroundColor: colors.surfaceElevated,
        selectedColor: AppColors.primary,
        checkmarkColor: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusPill),
          side: BorderSide(color: isSelected ? AppColors.primary : colors.border),
        ),
        onSelected: (_) => setState(() => _selectedSpecialty = label),
      ),
    );
  }

  Widget _buildDutyCard(BuildContext context, Map<String, dynamic> duty) {
    final colors = context.appColors;
    return AppCard(
      onTap: () => context.push('/duty-details', extra: duty),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Text(
                    duty['facilityName'] as String,
                    style: AppTypography.headingSmall(colors.textPrimary),
                  ),
                  const SizedBox(width: 6),
                  if (duty['isVerifiedOrg'] == true)
                    const Icon(Icons.verified_rounded, color: AppColors.emerald, size: 16),
                ],
              ),
              StatusBadge(status: duty['status'] as String),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            '${duty['city']} • ${duty['distanceKm']} km away',
            style: AppTypography.bodySmall(colors.textMuted),
          ),
          const SizedBox(height: AppSpacing.sm),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: colors.surfaceElevated,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.medical_services_outlined, size: 16, color: AppColors.primaryLight),
                    const SizedBox(width: 6),
                    Text(
                      duty['specialtyName'] as String,
                      style: AppTypography.labelBold(colors.textPrimary),
                    ),
                  ],
                ),
                Text(
                  '₹${duty['amount']} / shift',
                  style: AppTypography.labelBold(AppColors.emerald),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Icon(Icons.access_time_rounded, size: 14, color: colors.textMuted),
              const SizedBox(width: 4),
              Text(
                '${duty['startAt']} - ${duty['endAt']}',
                style: AppTypography.bodySmall(colors.textSecondary),
              ),
              const Spacer(),
              Text(
                '${duty['remainingHeadcount']} slot open',
                style: AppTypography.bodySmall(AppColors.amber),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
