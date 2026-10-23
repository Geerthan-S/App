import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../doctor_profile/data/doctor_repository.dart';
import '../../../core/errors/error_envelope.dart';
import '../../chat/presentation/chats_screen.dart' show ChatButton;

class MessagesScreen extends StatelessWidget {
  const MessagesScreen({super.key});

  static const _offerStatuses = {'selected'};
  static const _upcomingStatuses = {'confirmed', 'in_progress'};

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return Scaffold(
      backgroundColor: colors.bg,
      body: SafeArea(
        bottom: false,
        child: StreamBuilder<List<Map<String, dynamic>>>(
          stream: DoctorRepository.watchAssignments(),
          builder: (context, snap) {
            final header = Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.gutter,
                20,
                AppSpacing.gutter,
                4,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'My Duties',
                          style: AppTypography.display(colors.textPrimary),
                        ),
                      ),
                      const ChatButton(),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Offers, confirmed shifts and completed duties',
                    style: AppTypography.bodyMedium(
                      colors.textSecondary,
                    ).copyWith(fontSize: 14),
                  ),
                ],
              ),
            );
            if (snap.connectionState == ConnectionState.waiting) {
              return Column(
                children: [
                  header,
                  const Expanded(child: LoadingView()),
                ],
              );
            }
            final assignments = snap.data ?? [];
            if (assignments.isEmpty) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  header,
                  const Expanded(
                    child: EmptyStateView(
                      icon: Icons.event_note_outlined,
                      title: 'No active assignments',
                      description:
                          'When a hospital selects you for a duty, it will appear here.',
                    ),
                  ),
                ],
              );
            }

            final sections = <String, List<Map<String, dynamic>>>{
              'Offers': assignments
                  .where((a) => _offerStatuses.contains(a['status']))
                  .toList(),
              'Upcoming': assignments
                  .where((a) => _upcomingStatuses.contains(a['status']))
                  .toList(),
              'Past': assignments
                  .where(
                    (a) =>
                        !_offerStatuses.contains(a['status']) &&
                        !_upcomingStatuses.contains(a['status']),
                  )
                  .toList(),
            };

            return ListView(
              padding: const EdgeInsets.only(
                bottom: AppSpacing.navBarClearance,
              ),
              children: [
                header,
                for (final entry in sections.entries)
                  if (entry.value.isNotEmpty) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.gutter,
                        AppSpacing.section,
                        AppSpacing.gutter,
                        4,
                      ),
                      child: SectionHeader(title: entry.key),
                    ),
                    for (var i = 0; i < entry.value.length; i++)
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.gutter,
                        ),
                        child: Column(
                          children: [
                            if (i > 0) Divider(height: 1, color: colors.border),
                            _AssignmentTile(
                              key: ValueKey(entry.value[i]['assignmentId']),
                              assignment: entry.value[i],
                            ),
                          ],
                        ),
                      ),
                  ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _AssignmentTile extends StatefulWidget {
  final Map<String, dynamic> assignment;
  const _AssignmentTile({super.key, required this.assignment});

  @override
  State<_AssignmentTile> createState() => _AssignmentTileState();
}

class _AssignmentTileState extends State<_AssignmentTile> {
  // One key per confirmation intent, reused if the user retries after a failure.
  final String _confirmIdempotencyKey = const Uuid().v4();
  bool _isConfirming = false;
  bool _isDeclining = false;

  String? _expiryLabel() {
    final exp = widget.assignment['expiresAt'] as String?;
    if (exp == null || exp.isEmpty) return null;
    try {
      final diff = DateTime.parse(exp).toLocal().difference(DateTime.now());
      if (diff.isNegative) return 'Offer expired';
      if (diff.inHours > 0) {
        return 'Expires in ${diff.inHours}h ${diff.inMinutes % 60}m';
      }
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
        idempotencyKey: _confirmIdempotencyKey,
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
        final msg = e.domainCode == 'OFFER_EXPIRED'
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
          title: Text(
            'Decline Offer?',
            style: AppTypography.headingSmall(colors.textPrimary),
          ),
          content: Text(
            'Are you sure you want to decline this duty offer? This cannot be undone.',
            style: AppTypography.bodyMedium(colors.textSecondary),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text(
                'Keep Offer',
                style: TextStyle(color: colors.textMuted),
              ),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.rose,
                foregroundColor: Colors.white,
              ),
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
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Offer declined.')));
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
          title: const Text('Hospital contact'),
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
                    Icon(
                      Icons.phone_outlined,
                      size: 14,
                      color: colors.textMuted,
                    ),
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
                    Icon(
                      Icons.location_on_outlined,
                      size: 14,
                      color: colors.textMuted,
                    ),
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
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => StatefulBuilder(
        builder: (bCtx, setSheet) {
          return Padding(
            padding: EdgeInsets.only(
              left: AppSpacing.gutter,
              right: AppSpacing.gutter,
              top: 0,
              bottom: MediaQuery.of(bCtx).viewInsets.bottom + 20,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SheetHeader(
                    title: 'Review hospital',
                    subtitle:
                        'How was your experience at ${widget.assignment['facilityName']}?',
                    onClose: () => Navigator.pop(ctx),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(
                      5,
                      (i) => IconButton(
                        tooltip: i == 0 ? '1 star' : '${i + 1} stars',
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
                    decoration: const InputDecoration(
                      hintText: 'Share your experience at this hospital...',
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
                                targetId:
                                    widget.assignment['organizationId']
                                        as String,
                                targetType: 'organization',
                                assignmentId:
                                    widget.assignment['assignmentId'] as String,
                                rating: selectedRating,
                                comment: commentCtrl.text.trim(),
                              );
                              if (ctx.mounted) Navigator.pop(ctx);
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    backgroundColor: AppColors.emerald,
                                    content: Text(
                                      'Review submitted successfully.',
                                    ),
                                  ),
                                );
                              }
                            } on FirebaseFunctionsException catch (e) {
                              setSheet(() => submitting = false);
                              final msg =
                                  e.domainCode == 'APPLICATION_ALREADY_EXISTS'
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
        },
      ),
    );
  }

  void _openAssignment(BuildContext context) {
    final dutyId = widget.assignment['dutyId'] as String?;
    if (dutyId == null || dutyId.isEmpty) return;
    context.push(
      '/duty-details',
      extra: {
        'dutyId': dutyId,
        'facilityName': widget.assignment['facilityName'],
        'department': widget.assignment['department'],
        'specialtyName': widget.assignment['specialtyName'],
        'startAt': widget.assignment['startAt'],
        'endAt': widget.assignment['endAt'],
        'startAtIso': widget.assignment['startAtIso'],
        'endAtIso': widget.assignment['endAtIso'],
        'amount': widget.assignment['amount'],
        'basis': widget.assignment['basis'],
        'paymentTiming': widget.assignment['paymentTiming'],
        'status': widget.assignment['status'],
        'city': '',
        'qualificationRequired': '',
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final status = widget.assignment['status'] as String;
    final isSelected = status == 'selected';
    final isConfirmed = status == 'confirmed' || status == 'in_progress';
    final isCompleted = status == 'completed';
    final expiry = _expiryLabel();
    final start = parseIsoLocal(widget.assignment['startAtIso']);
    final subtitle = [
      widget.assignment['specialtyName'] as String? ?? '',
      widget.assignment['department'] as String? ?? '',
    ].where((s) => s.isNotEmpty).join(' · ');
    final busy = _isConfirming || _isDeclining;

    return InkWell(
      onTap: () => _openAssignment(context),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DateBlock(date: start),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.assignment['facilityName'] as String? ?? '—',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.headingSmall(colors.textPrimary),
                      ),
                      if (subtitle.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTypography.bodySmall(
                            colors.textSecondary,
                          ).copyWith(fontSize: 12.5),
                        ),
                      ],
                      const SizedBox(height: 2),
                      Text(
                        start != null
                            ? formatDayTime(start)
                            : '${widget.assignment['startAt'] ?? ''}',
                        style: AppTypography.bodySmall(
                          colors.textSecondary,
                        ).copyWith(fontSize: 12.5),
                      ),
                      const SizedBox(height: 8),
                      if (isSelected && expiry != null)
                        HighlightTag(expiry)
                      else
                        StatusBadge(status: status),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  formatInr(widget.assignment['amount']),
                  style: AppTypography.amount(colors.textPrimary),
                ),
              ],
            ),

            // Offer pending: Accept / Decline
            if (isSelected) ...[
              const SizedBox(height: AppSpacing.md),
              _ActionIndent(
                child: Row(
                  children: [
                    Expanded(
                      child: AppButton(
                        label: 'Accept offer',
                        isLoading: _isConfirming,
                        onPressed: busy ? null : _accept,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.xs),
                    Expanded(
                      child: AppSecondaryButton(
                        label: 'Decline',
                        foregroundColor: AppColors.rose,
                        isLoading: _isDeclining,
                        onPressed: busy ? null : _decline,
                      ),
                    ),
                  ],
                ),
              ),
            ],

            // Confirmed / in-progress: contact
            if (isConfirmed) ...[
              const SizedBox(height: AppSpacing.sm),
              _ActionIndent(
                child: AppSecondaryButton(
                  label: 'View hospital contact',
                  icon: Icons.call_outlined,
                  onPressed: _showContact,
                ),
              ),
            ],

            // Completed: review
            if (isCompleted) ...[
              const SizedBox(height: AppSpacing.sm),
              _ActionIndent(
                child: AppSecondaryButton(
                  label: 'Leave a review',
                  icon: Icons.star_outline_rounded,
                  onPressed: () => _showReviewModal(context),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Indents a row's actions to the text column (date block width + gap).
class _ActionIndent extends StatelessWidget {
  final Widget child;

  const _ActionIndent({required this.child});

  @override
  Widget build(BuildContext context) {
    return Padding(padding: const EdgeInsets.only(left: 58), child: child);
  }
}
