import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/state_views.dart';
import '../../doctor_profile/data/doctor_repository.dart';

class MessagesScreen extends StatelessWidget {
  const MessagesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text('My Duties', style: AppTypography.headingMedium(colors.textPrimary)),
      ),
      body: SafeArea(
        child: StreamBuilder<List<Map<String, dynamic>>>(
          stream: DoctorRepository.watchAssignments(),
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            final assignments = snap.data ?? [];
            if (assignments.isEmpty) {
              return const EmptyStateView(
                icon: Icons.assignment_outlined,
                title: 'No active assignments',
                description: 'When a hospital selects you for a duty, it will appear here.',
              );
            }
            return ListView.separated(
              itemCount: assignments.length,
              separatorBuilder: (_, __) => const Divider(height: 1, indent: 76),
              itemBuilder: (context, index) =>
                  _AssignmentTile(assignment: assignments[index]),
            );
          },
        ),
      ),
    );
  }
}

class _AssignmentTile extends StatefulWidget {
  final Map<String, dynamic> assignment;
  const _AssignmentTile({required this.assignment});

  @override
  State<_AssignmentTile> createState() => _AssignmentTileState();
}

class _AssignmentTileState extends State<_AssignmentTile> {
  bool _isConfirming = false;
  bool _isDeclining = false;

  String? _expiryLabel() {
    final exp = widget.assignment['expiresAt'] as String?;
    if (exp == null || exp.isEmpty) return null;
    try {
      final diff = DateTime.parse(exp).toLocal().difference(DateTime.now());
      if (diff.isNegative) return 'Offer expired';
      if (diff.inHours > 0) return 'Expires in ${diff.inHours}h ${diff.inMinutes % 60}m';
      return 'Expires in ${diff.inMinutes}m';
    } catch (_) {
      return null;
    }
  }

  Future<void> _accept() async {
    setState(() => _isConfirming = true);
    try {
      await DoctorRepository.confirmAssignment(
        widget.assignment['assignmentId'] as String,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.emerald,
            content: Text('Offer accepted! Contact details are now available.'),
          ),
        );
      }
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        final msg = e.code == 'OFFER_EXPIRED'
            ? 'This offer has expired and can no longer be accepted.'
            : e.message ?? 'Could not accept. Try again.';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(backgroundColor: AppColors.rose, content: Text(msg)),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.rose,
            content: Text('Could not accept. Check your connection.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isConfirming = false);
    }
  }

  Future<void> _decline() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        final colors = ctx.appColors;
        return AlertDialog(
          backgroundColor: colors.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
          title: Text('Decline Offer?', style: AppTypography.headingSmall(colors.textPrimary)),
          content: Text(
            'Are you sure you want to decline this duty offer? This cannot be undone.',
            style: AppTypography.bodyMedium(colors.textSecondary),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text('Keep Offer', style: TextStyle(color: colors.textMuted)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.rose),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Decline'),
            ),
          ],
        );
      },
    );
    if (confirmed != true || !mounted) return;

    setState(() => _isDeclining = true);
    try {
      await DoctorRepository.cancelAssignment(
        widget.assignment['assignmentId'] as String,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Offer declined.')),
        );
      }
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.rose,
            content: Text(e.message ?? 'Could not decline. Try again.'),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.rose,
            content: Text('Could not decline. Check your connection.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isDeclining = false);
    }
  }

  Future<void> _showContact() async {
    try {
      final contact = await DoctorRepository.getAssignmentContact(
        widget.assignment['assignmentId'] as String,
      );
      if (!mounted) return;
      final colors = context.appColors;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: colors.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
          title: Row(
            children: [
              const Icon(Icons.contact_phone_rounded, color: AppColors.primary),
              const SizedBox(width: 8),
              Text('Hospital Contact', style: AppTypography.headingSmall(colors.textPrimary)),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                contact['name'] as String? ?? '—',
                style: AppTypography.labelBold(colors.textPrimary),
              ),
              const SizedBox(height: 6),
              if ((contact['phone'] as String? ?? '').isNotEmpty) ...[
                Row(
                  children: [
                    Icon(Icons.phone_outlined, size: 14, color: colors.textMuted),
                    const SizedBox(width: 4),
                    Text(
                      contact['phone'] as String,
                      style: AppTypography.bodyMedium(colors.textSecondary),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
              ],
              if ((contact['address'] as String? ?? '').isNotEmpty)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.location_on_outlined, size: 14, color: colors.textMuted),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        contact['address'] as String,
                        style: AppTypography.bodySmall(colors.textMuted),
                      ),
                    ),
                  ],
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.rose,
            content: Text(e.message ?? 'Could not fetch contact.'),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.rose,
            content: Text('Could not fetch contact. Try again.'),
          ),
        );
      }
    }
  }

  void _showReviewModal(BuildContext context) {
    final commentCtrl = TextEditingController();
    int selectedRating = 0;
    bool submitting = false;
    final colors = context.appColors;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: colors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpacing.radiusLg)),
      ),
      builder: (ctx) => StatefulBuilder(builder: (bCtx, setSheet) {
        return Padding(
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 20,
            bottom: MediaQuery.of(bCtx).viewInsets.bottom + 20,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Review Hospital',
                  style: AppTypography.headingSmall(colors.textPrimary),
                ),
                const SizedBox(height: 4),
                Text(
                  'How was your experience at ${widget.assignment['facilityName']}?',
                  style: AppTypography.bodySmall(colors.textMuted),
                ),
                const SizedBox(height: AppSpacing.md),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(
                    5,
                    (i) => IconButton(
                      icon: Icon(
                        i < selectedRating
                            ? Icons.star_rounded
                            : Icons.star_border_rounded,
                        color: AppColors.amber,
                        size: 36,
                      ),
                      onPressed: () => setSheet(() => selectedRating = i + 1),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: commentCtrl,
                  maxLines: 3,
                  maxLength: 500,
                  decoration: InputDecoration(
                    hintText: 'Share your experience at this hospital...',
                    hintStyle: AppTypography.bodyMedium(colors.textMuted),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                AppButton(
                  label: 'Submit Review',
                  isLoading: submitting,
                  onPressed: selectedRating > 0
                      ? () async {
                          if (commentCtrl.text.trim().isEmpty) return;
                          setSheet(() => submitting = true);
                          try {
                            await DoctorRepository.submitReview(
                              targetId: widget.assignment['organizationId'] as String,
                              targetType: 'organization',
                              assignmentId: widget.assignment['assignmentId'] as String,
                              rating: selectedRating,
                              comment: commentCtrl.text.trim(),
                            );
                            if (ctx.mounted) Navigator.pop(ctx);
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  backgroundColor: AppColors.emerald,
                                  content: Text('Review submitted successfully.'),
                                ),
                              );
                            }
                          } on FirebaseFunctionsException catch (e) {
                            setSheet(() => submitting = false);
                            final msg = e.code == 'already-exists'
                                ? 'You already reviewed this assignment.'
                                : e.message ?? 'Review failed. Try again.';
                            if (ctx.mounted) {
                              ScaffoldMessenger.of(ctx).showSnackBar(
                                SnackBar(
                                  backgroundColor: AppColors.rose,
                                  content: Text(msg),
                                ),
                              );
                            }
                          } catch (_) {
                            setSheet(() => submitting = false);
                            if (ctx.mounted) {
                              ScaffoldMessenger.of(ctx).showSnackBar(
                                const SnackBar(
                                  backgroundColor: AppColors.rose,
                                  content: Text('Review failed. Try again.'),
                                ),
                              );
                            }
                          }
                        }
                      : null,
                ),
              ],
            ),
          ),
        );
      }),
    );
  }

  void _openAssignment(BuildContext context) {
    final dutyId = widget.assignment['dutyId'] as String?;
    if (dutyId == null || dutyId.isEmpty) return;
    context.push('/duty-details', extra: {
      'dutyId': dutyId,
      'facilityName': widget.assignment['facilityName'],
      'department': widget.assignment['department'],
      'specialtyName': widget.assignment['specialtyName'],
      'startAt': widget.assignment['startAt'],
      'endAt': widget.assignment['startAt'],
      'amount': widget.assignment['amount'],
      'basis': 'per_shift',
      'status': widget.assignment['status'],
      'city': '',
      'qualificationRequired': '',
      'headcount': 1,
      'remainingHeadcount': 0,
      'isVerifiedOrg': true,
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final status = widget.assignment['status'] as String;
    final isSelected = status == 'selected';
    final isConfirmed = status == 'confirmed' || status == 'in_progress';
    final isCompleted = status == 'completed';
    final expiry = _expiryLabel();

    return InkWell(
      onTap: () => _openAssignment(context),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: AppColors.primary.withValues(alpha: 0.12),
              child: const Icon(
                Icons.local_hospital_rounded,
                color: AppColors.primary,
                size: 22,
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          widget.assignment['facilityName'] as String,
                          style: AppTypography.labelBold(colors.textPrimary),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      StatusBadge(status: status),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${widget.assignment['specialtyName']} • ${widget.assignment['department']}',
                    style: AppTypography.bodyMedium(colors.textSecondary),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Icon(Icons.schedule_rounded, size: 12, color: colors.textMuted),
                      const SizedBox(width: 4),
                      Text(
                        widget.assignment['startAt'] as String,
                        style: AppTypography.bodySmall(colors.textMuted),
                      ),
                      const Spacer(),
                      Text(
                        '₹${widget.assignment['amount']}',
                        style: AppTypography.labelBold(AppColors.emerald),
                      ),
                    ],
                  ),

                  // Offer pending: expiry chip + Accept / Decline
                  if (isSelected) ...[
                    const SizedBox(height: 6),
                    if (expiry != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppColors.amber.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          expiry,
                          style: AppTypography.bodySmall(AppColors.amber),
                        ),
                      ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        Expanded(
                          child: AppButton(
                            label: 'Accept Offer',
                            isLoading: _isConfirming,
                            onPressed:
                                _isConfirming || _isDeclining ? null : _accept,
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          width: 72,
                          child: TextButton(
                            onPressed:
                                _isConfirming || _isDeclining ? null : _decline,
                            style: TextButton.styleFrom(
                              foregroundColor: AppColors.rose,
                            ),
                            child: _isDeclining
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Text('Decline'),
                          ),
                        ),
                      ],
                    ),
                  ],

                  // Confirmed / in-progress: contact button
                  if (isConfirmed) ...[
                    const SizedBox(height: AppSpacing.sm),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.contact_phone_rounded, size: 16),
                        label: const Text('View Hospital Contact'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.primaryLight,
                          side: BorderSide(color: colors.border),
                          padding: const EdgeInsets.symmetric(vertical: 6),
                        ),
                        onPressed: _showContact,
                      ),
                    ),
                  ],

                  // Completed: review button
                  if (isCompleted) ...[
                    const SizedBox(height: AppSpacing.sm),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.star_outline_rounded, size: 16),
                        label: const Text('Leave a Review'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.amber,
                          side: const BorderSide(color: AppColors.amber),
                          padding: const EdgeInsets.symmetric(vertical: 6),
                        ),
                        onPressed: () => _showReviewModal(context),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
