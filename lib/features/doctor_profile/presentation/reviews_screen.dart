/**
 * Reviews Screen
 * Generic, reusable review list — used for both Doctor Reviews and
 * Hospital Reviews so no duplicate screen/model is needed per type.
 */

import 'package:flutter/material.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/widgets/state_views.dart';

class ReviewsScreen extends StatelessWidget {
  final String title;
  final List<Map<String, dynamic>> reviews;

  const ReviewsScreen({
    super.key,
    required this.title,
    required this.reviews,
  });

  double get _averageRating {
    if (reviews.isEmpty) return 0;
    final total = reviews.fold<num>(0, (sum, r) => sum + (r['rating'] as num));
    return total / reviews.length;
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text(title, style: AppTypography.headingMedium(colors.textPrimary)),
      ),
      body: SafeArea(
        child: reviews.isEmpty
            ? const EmptyStateView(
                icon: Icons.reviews_outlined,
                title: 'No reviews yet',
                description: 'Reviews will appear here once submitted.',
              )
            : ListView(
                padding: AppSpacing.paddingScreen,
                children: [
                  AppCard(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Overall Rating', style: AppTypography.bodySmall(colors.textMuted)),
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                Text(
                                  _averageRating.toStringAsFixed(1),
                                  style: AppTypography.headingLarge(colors.textPrimary),
                                ),
                                const SizedBox(width: 6),
                                const Icon(Icons.star_rounded, color: AppColors.amber, size: 22),
                              ],
                            ),
                          ],
                        ),
                        Text(
                          '${reviews.length} review${reviews.length == 1 ? '' : 's'}',
                          style: AppTypography.bodyMedium(colors.textSecondary),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  ...reviews.map(
                    (review) => Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    review['reviewerName'] as String,
                                    style: AppTypography.labelBold(colors.textPrimary),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                _StarRow(rating: review['rating'] as int),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              review['comment'] as String,
                              style: AppTypography.bodyMedium(colors.textSecondary),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _StarRow extends StatelessWidget {
  final int rating;

  const _StarRow({required this.rating});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(
        5,
        (i) => Icon(
          i < rating ? Icons.star_rounded : Icons.star_border_rounded,
          color: AppColors.amber,
          size: 16,
        ),
      ),
    );
  }
}
