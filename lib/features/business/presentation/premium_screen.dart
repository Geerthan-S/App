// Doctor: Premium plan, early-access duties, the private standby list for
// last-minute duties, open last-minute offers, and plan payments.

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/design_system/app_buttons.dart';
import '../../../core/design_system/app_cards.dart';
import '../../../core/design_system/app_colors.dart';
import '../../../core/design_system/app_spacing.dart';
import '../../../core/design_system/app_typography.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../duty_marketplace/data/duty_repository.dart';
import '../data/business_repository.dart';
import 'hospital_payments_screen.dart' show OrderCard;

class PremiumScreen extends StatefulWidget {
  const PremiumScreen({super.key});

  @override
  State<PremiumScreen> createState() => _PremiumScreenState();
}

class _PremiumScreenState extends State<PremiumScreen> {
  late Future<Map<String, dynamic>> _features = BusinessFeatures.load(refresh: true);

  void _snack(String message, {bool error = false}) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(backgroundColor: error ? AppColors.rose : null, content: Text(message)));

  Future<void> _buy(Map<dynamic, dynamic> plan) async {
    try {
      final result = await BusinessRepository.requestSubscription(plan['planId'] as String);
      if (!mounted) return;
      if (result['status'] == 'active') {
        _snack('${plan['name']} is active.');
        return;
      }
      final breakdown = result['breakdown'] as Map? ?? const {};
      await showModalBottomSheet<void>(
        context: context,
        useSafeArea: true,
        isScrollControlled: true,
        builder: (ctx) => Padding(
          padding: const EdgeInsets.all(AppSpacing.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SheetHeader(title: plan['name'] as String, subtitle: 'Your plan starts as soon as payment is confirmed.', onClose: () => Navigator.pop(ctx)),
              const SizedBox(height: AppSpacing.md),
              OrderCard(order: {
                'orderId': result['orderId'],
                'description': plan['name'],
                'status': 'awaiting_payment',
                'breakdown': breakdown,
                'totalPaise': breakdown['totalPaise'],
                'instructions': result['instructions'],
              }),
              const SizedBox(height: AppSpacing.md),
            ],
          ),
        ),
      );
    } on FirebaseFunctionsException catch (e) {
      if (mounted) _snack(e.message ?? 'Could not start the purchase.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(title: const Text('Premium & Standby')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _features,
        builder: (context, featureSnap) {
          final features = featureSnap.data ?? const <String, dynamic>{};
          final plans = List<Map<dynamic, dynamic>>.from(features['plans'] as List? ?? const []);
          final lastMinuteOn = BusinessFeatures.isOn(features, 'last_minute_enabled');
          return RefreshIndicator(
            onRefresh: () async => setState(() => _features = BusinessFeatures.load(refresh: true)),
            child: StreamBuilder<Map<String, dynamic>?>(
              stream: BusinessRepository.watchMySubscription(),
              builder: (context, subSnap) {
                final sub = subSnap.data ?? const {};
                final premium = BusinessRepository.isActive(sub['premiumUntil']);
                final ai = BusinessRepository.isActive(sub['aiUntil']);
                return ListView(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.gutter, AppSpacing.sm, AppSpacing.gutter, AppSpacing.xl),
                  children: [
                    _StatusCard(premium: premium, premiumUntil: sub['premiumUntil'], ai: ai, aiUntil: sub['aiUntil'],
                        earlyAccessMinutes: features['earlyAccessMinutes'] as int? ?? 0),
                    const SizedBox(height: AppSpacing.lg),
                    if (plans.isNotEmpty) ...[
                      const GroupLabel('Plans'),
                      for (final plan in plans) ...[
                        AppCard(
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(plan['name'] as String, style: AppTypography.labelBold(colors.textPrimary)),
                                    Text(
                                      plan['kind'] == 'premium'
                                          ? 'Early access to new duties, advanced filters, priority alerts'
                                          : 'Unlimited AI clinical questions',
                                      style: AppTypography.bodySmall(colors.textMuted),
                                    ),
                                    const SizedBox(height: 4),
                                    Text('₹${plan['priceInr']} + GST · ${plan['durationMonths']} month(s)',
                                        style: AppTypography.bodyMedium(colors.textPrimary)),
                                  ],
                                ),
                              ),
                              OutlinedButton(
                                onPressed: () => _buy(plan),
                                child: Text((plan['kind'] == 'premium' ? premium : ai) ? 'Renew' : 'Get'),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                      ],
                      const SizedBox(height: AppSpacing.md),
                    ],
                    if (premium) ...[
                      const GroupLabel('Early access duties'),
                      const _EarlyAccessList(),
                      const SizedBox(height: AppSpacing.lg),
                    ],
                    if (lastMinuteOn) ...[
                      const GroupLabel('Last-minute standby'),
                      const _StandbyCard(),
                      const SizedBox(height: AppSpacing.sm),
                      const _LastMinuteOffers(),
                      const SizedBox(height: AppSpacing.lg),
                    ],
                    const GroupLabel('Your plan payments'),
                    StreamBuilder<List<Map<String, dynamic>>>(
                      stream: BusinessRepository.watchMyOrders(),
                      builder: (context, snap) {
                        final orders = snap.data ?? const [];
                        if (orders.isEmpty) {
                          return Text('No plan payments yet.', style: AppTypography.bodySmall(colors.textMuted));
                        }
                        return Column(children: [
                          for (final o in orders) ...[OrderCard(order: o), const SizedBox(height: AppSpacing.sm)],
                        ]);
                      },
                    ),
                  ],
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  final bool premium;
  final bool ai;
  final Object? premiumUntil;
  final Object? aiUntil;
  final int earlyAccessMinutes;

  const _StatusCard({required this.premium, required this.ai, this.premiumUntil, this.aiUntil, required this.earlyAccessMinutes});

  String _date(Object? iso) {
    final d = parseIsoLocal(iso);
    return d == null ? '' : '${d.day}/${d.month}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(premium ? Icons.workspace_premium : Icons.workspace_premium_outlined, color: premium ? AppColors.amber : colors.textMuted),
            const SizedBox(width: AppSpacing.xs),
            Text(premium ? 'Premium until ${_date(premiumUntil)}' : 'Free plan', style: AppTypography.headingSmall(colors.textPrimary)),
          ]),
          const SizedBox(height: 6),
          Text(
            premium
                ? 'You see new duties ${earlyAccessMinutes > 0 ? '$earlyAccessMinutes minutes ' : ''}before other doctors and get alerted first.'
                : 'Premium members see new duties first${earlyAccessMinutes > 0 ? ' ($earlyAccessMinutes minutes early)' : ''} and get advanced filters.',
            style: AppTypography.bodySmall(colors.textSecondary),
          ),
          if (ai) ...[
            const SizedBox(height: 6),
            Text('AI assistant plan until ${_date(aiUntil)}', style: AppTypography.bodySmall(colors.textSecondary)),
          ],
        ],
      ),
    );
  }
}

class _EarlyAccessList extends StatelessWidget {
  const _EarlyAccessList();

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return StreamBuilder<List<Map<String, dynamic>>>(
      stream: BusinessRepository.watchEarlyAccessDuties(),
      builder: (context, snap) {
        final duties = snap.data ?? const [];
        if (duties.isEmpty) {
          return Text('No early-access duties right now. You will be notified when one opens.',
              style: AppTypography.bodySmall(colors.textMuted));
        }
        return RowGroup(children: [
          for (final d in duties)
            ListRow(
              icon: Icons.bolt_outlined,
              iconColor: AppColors.amber,
              title: '${d['specialtyName']} · ${d['facilityName']}',
              subtitle: '${d['city'] ?? ''} · ${formatInr((d['paymentTerms'] as Map?)?['amount'])} · opens to all ${_opens(d['earlyAccessEndsAt'])}',
              onTap: () => context.push('/duty-details', extra: DutyRepository.toUiMap(d['dutyId'] as String, d)),
            ),
        ]);
      },
    );
  }

  String _opens(Object? iso) {
    final d = parseIsoLocal(iso);
    if (d == null) return 'soon';
    final mins = d.difference(DateTime.now()).inMinutes;
    return mins <= 0 ? 'now' : 'in $mins min';
  }
}

class _StandbyCard extends StatefulWidget {
  const _StandbyCard();

  @override
  State<_StandbyCard> createState() => _StandbyCardState();
}

class _StandbyCardState extends State<_StandbyCard> {
  Set<String>? _selected;
  bool _saving = false;

  List<DateTime> get _days => List.generate(7, (i) => DateTime.now().add(Duration(days: i + 1)));

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final saved = await BusinessRepository.setStandbyDates(_selected!.toList()..sort());
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(saved.isEmpty ? 'You are off the standby list.' : 'Saved. You will be alerted first for last-minute duties on these dates.'),
        ));
      }
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(backgroundColor: AppColors.rose, content: Text(e.message ?? 'Could not save.')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return StreamBuilder<Map<String, dynamic>?>(
      stream: BusinessRepository.watchMyStandby(),
      builder: (context, snap) {
        _selected ??= snap.hasData ? Set<String>.from(snap.data?['dates'] as List? ?? const []) : null;
        final selected = _selected ?? <String>{};
        return AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('I\'m ready for any relieving duty on:', style: AppTypography.labelBold(colors.textPrimary)),
              const SizedBox(height: 4),
              Text('Only HealthForce staff see this list. When a hospital needs a doctor at short notice, you are alerted and the first to accept gets the duty.',
                  style: AppTypography.bodySmall(colors.textMuted)),
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: AppSpacing.xs,
                runSpacing: AppSpacing.xs,
                children: [
                  for (final day in _days)
                    FilterChip(
                      label: Text('${weekdays[day.weekday - 1]} ${day.day}'),
                      selected: selected.contains(indiaDate(day)),
                      onSelected: (on) => setState(() {
                        _selected ??= <String>{};
                        on ? _selected!.add(indiaDate(day)) : _selected!.remove(indiaDate(day));
                      }),
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              AppButton(label: 'Save standby dates', isLoading: _saving, onPressed: _selected == null || _saving ? null : _save),
            ],
          ),
        );
      },
    );
  }
}

class _LastMinuteOffers extends StatelessWidget {
  const _LastMinuteOffers();

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return StreamBuilder<Map<String, dynamic>?>(
      stream: BusinessRepository.watchMyStandby(),
      builder: (context, standbySnap) {
        final myDates = Set<String>.from(standbySnap.data?['dates'] as List? ?? const []);
        return StreamBuilder<List<Map<String, dynamic>>>(
          stream: BusinessRepository.watchLastMinuteOffers(),
          builder: (context, snap) {
            final offers = (snap.data ?? const [])
                .where((d) => myDates.contains((d['lastMinute'] as Map?)?['serviceDate']))
                .toList();
            if (offers.isEmpty) return const SizedBox.shrink();
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Open last-minute duties for you', style: AppTypography.labelBold(colors.textPrimary)),
                const SizedBox(height: AppSpacing.xs),
                for (final d in offers) ...[_OfferCard(duty: d), const SizedBox(height: AppSpacing.sm)],
              ],
            );
          },
        );
      },
    );
  }
}

class _OfferCard extends StatefulWidget {
  final Map<String, dynamic> duty;

  const _OfferCard({required this.duty});

  @override
  State<_OfferCard> createState() => _OfferCardState();
}

class _OfferCardState extends State<_OfferCard> {
  bool _busy = false;

  Future<void> _accept() async {
    setState(() => _busy = true);
    try {
      await BusinessRepository.acceptLastMinute(widget.duty['dutyId'] as String);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          backgroundColor: AppColors.emerald,
          content: Text('Confirmed! The duty is in My Duties and contacts are shared.'),
        ));
      }
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(backgroundColor: AppColors.rose, content: Text(e.message ?? 'Could not accept.')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final d = widget.duty;
    final start = parseIsoLocal((d['schedule'] as Map?)?['startAt']);
    return AppCard(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${d['specialtyName']} · ${d['facilityName']}', style: AppTypography.labelBold(colors.textPrimary)),
                Text('${start != null ? formatDayTime(start) : ''} · ${formatInr((d['paymentTerms'] as Map?)?['amount'])}',
                    style: AppTypography.bodySmall(colors.textMuted)),
              ],
            ),
          ),
          SizedBox(width: 110, child: AppButton(label: 'Accept', isLoading: _busy, onPressed: _busy ? null : _accept)),
        ],
      ),
    );
  }
}
