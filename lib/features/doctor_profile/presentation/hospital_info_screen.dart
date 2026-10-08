import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/state_views.dart';
import '../../hospital/data/hospital_repository.dart';

class HospitalInfoScreen extends StatefulWidget {
  final String? organizationId;
  const HospitalInfoScreen({super.key, this.organizationId});

  @override
  State<HospitalInfoScreen> createState() => _HospitalInfoScreenState();
}

class _HospitalInfoScreenState extends State<HospitalInfoScreen> {
  Map<String, dynamic>? _org;
  List<Map<String, dynamic>> _reviews = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    if (widget.organizationId != null) _load();
    else setState(() => _loading = false);
  }

  Future<void> _load() async {
    final org = await HospitalRepository.getOrganization(widget.organizationId!);
    if (!mounted) return;
    setState(() {
      _org = org;
      _loading = false;
    });
    HospitalRepository.watchOrgReviews(widget.organizationId!).listen((reviews) {
      if (mounted) setState(() => _reviews = reviews);
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text('Hospital Profile', style: AppTypography.headingMedium(colors.textPrimary)),
      ),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : widget.organizationId == null
                ? const EmptyStateView(
                    icon: Icons.local_hospital_outlined,
                    title: 'No hospital selected',
                    description: 'Tap a hospital from your duty assignments to view their profile.',
                  )
                : _org == null
                    ? const EmptyStateView(
                        icon: Icons.error_outline_rounded,
                        title: 'Organization not found',
                        description: 'This hospital profile could not be loaded.',
                      )
                    : _buildContent(colors),
      ),
    );
  }

  Widget _buildContent(AppColorsExtension colors) {
    final org = _org!;
    final isVerified = org['verificationStatus'] == 'approved';
    final avgRating = _reviews.isEmpty
        ? 0.0
        : _reviews.map((r) => (r['rating'] as num).toDouble()).reduce((a, b) => a + b) / _reviews.length;

    return SingleChildScrollView(
      padding: AppSpacing.paddingScreen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                      ),
                      child: const Icon(Icons.local_hospital_rounded, color: AppColors.primary, size: 28),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            Expanded(
                              child: Text(
                                org['displayName'] as String? ?? org['legalName'] as String? ?? '—',
                                style: AppTypography.headingSmall(colors.textPrimary),
                              ),
                            ),
                            if (isVerified) ...[
                              const SizedBox(width: 4),
                              const Icon(Icons.verified_rounded, color: AppColors.emerald, size: 18),
                            ],
                          ]),
                          const SizedBox(height: 2),
                          Text(
                            org['organizationType'] as String? ?? 'Healthcare Organization',
                            style: AppTypography.bodySmall(colors.textSecondary),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                if (_reviews.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Row(children: [
                    const Icon(Icons.star_rounded, color: AppColors.amber, size: 18),
                    const SizedBox(width: 4),
                    Text(
                      '${avgRating.toStringAsFixed(1)} (${_reviews.length} review${_reviews.length == 1 ? '' : 's'})',
                      style: AppTypography.labelBold(colors.textPrimary),
                    ),
                  ]),
                ],
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),

          Text('Contact & Location', style: AppTypography.headingSmall(colors.textPrimary)),
          const SizedBox(height: AppSpacing.xs),
          AppCard(
            child: Column(
              children: [
                _infoRow(colors, Icons.location_on_outlined, org['address'] as String? ?? '—'),
                const Divider(),
                _infoRow(colors, Icons.location_city_outlined, org['city'] as String? ?? '—'),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),

          if (_reviews.isNotEmpty) ...[
            Text('Reviews (${_reviews.length})', style: AppTypography.headingSmall(colors.textPrimary)),
            const SizedBox(height: AppSpacing.sm),
            ...(_reviews.take(5).map((r) => AppCard(
                  margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(r['reviewerName'] as String, style: AppTypography.labelBold(colors.textPrimary)),
                          Row(children: List.generate(
                            r['rating'] as int,
                            (_) => const Icon(Icons.star_rounded, color: AppColors.amber, size: 14),
                          )),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(r['comment'] as String, style: AppTypography.bodyMedium(colors.textSecondary)),
                    ],
                  ),
                ))),
          ] else ...[
            OutlinedButton.icon(
              icon: const Icon(Icons.reviews_outlined, size: 18),
              label: const Text('No reviews yet'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.primaryLight,
                side: BorderSide(color: colors.border),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              onPressed: null,
            ),
          ],

          const SizedBox(height: AppSpacing.lg),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              icon: const Icon(Icons.arrow_back_rounded, size: 18),
              label: const Text('Back to Profile'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.primaryLight,
                side: BorderSide(color: colors.border),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              onPressed: () => context.pop(),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
        ],
      ),
    );
  }

  Widget _infoRow(AppColorsExtension colors, IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, color: AppColors.primaryLight, size: 20),
          const SizedBox(width: AppSpacing.sm),
          Expanded(child: Text(text, style: AppTypography.bodyMedium(colors.textPrimary))),
        ],
      ),
    );
  }
}
