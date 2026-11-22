/**
 * Business modules: payments, premium plans, the last-minute confirmation
 * service, channel reports and their settings. Every action calls an audited,
 * server-authorized callable; nothing here changes data directly.
 */

import { h, icon, badge, fmtDate, fmtDateTime, fmtRelative, humanize, add, put } from '../core/dom.js';
import { actionDialog, card, cellMain, dl, errorBox, loading, openModal, pageHead, table, tabs, toast, errorMessage } from '../core/ui.js';
import { invoke, roles } from '../core/session.js';

const inr = paise => `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Payments ──────────────────────────────────────────────
const PAYMENT_TABS = [
  ['awaiting_payment', 'Awaiting payment'], ['paid', 'Paid'], ['payout_due', 'Payout due'], ['refund_due', 'Refund due'],
  ['paid_out', 'Paid out'], ['refunded', 'Refunded'], ['all', 'All'],
];

const NEXT_ACTIONS = {
  awaiting_payment: [['payment_received', 'Record payment received'], ['cancel', 'Cancel order']],
  payout_due: [['payout_sent', 'Record payout to doctor']],
  refund_due: [['refund_sent', 'Record refund sent']],
  paid: [['refund_sent', 'Refund this order']],
};

/** Reference + method form for money that moved outside the app. */
function recordMoney(order, action, label, onDone) {
  const modal = openModal({ title: label, subtitle: `${order.description} · ${inr(order.totalPaise)}` });
  const reference = h('input', { class: 'input', maxlength: 120, placeholder: 'UPI / bank reference number', autocomplete: 'off' });
  const method = h('select', { class: 'select' }, ['upi', 'bank_transfer', 'cash', 'card', 'other'].map(m => h('option', { value: m }, humanize(m))));
  const err = h('div', { class: 'alert alert-error', hidden: true });
  const submit = h('button', { class: `btn ${action === 'cancel' ? 'btn-danger' : 'btn-primary'}`, type: 'submit' }, 'Save');
  const amount = action === 'payout_sent' ? order.breakdown?.passThroughPaise : order.totalPaise;
  const form = h('form', { novalidate: true },
    dl([['Order', order.orderId], ['Type', humanize(order.type)], [action === 'payout_sent' ? 'Pay the doctor' : 'Amount', inr(amount)]]),
    h('div', { class: 'field section-gap' }, h('label', {}, action === 'cancel' ? 'Reason' : 'Reference'), reference),
    action === 'cancel' ? null : h('div', { class: 'field' }, h('label', {}, 'Method'), method),
    err,
    h('div', { class: 'btn-row end' }, h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => modal.close() }, 'Close'), submit));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (reference.value.trim().length < 2) { err.textContent = 'Enter the reference.'; err.hidden = false; return; }
    submit.disabled = true;
    try {
      const result = await invoke('recordPaymentAction', { orderId: order.orderId, action, reference: reference.value.trim(), method: method.value });
      modal.close();
      toast(result.note ? `Saved. ${result.note}.` : 'Saved and recorded in the ledger.');
      onDone();
    } catch (error) {
      err.textContent = errorMessage(error); err.hidden = false; submit.disabled = false;
    }
  });
  modal.body.append(form);
}

function openOrder(order, onDone) {
  const modal = openModal({ title: order.description || 'Payment order', subtitle: order.orderId, wide: true });
  const actions = NEXT_ACTIONS[order.status] || [];
  modal.body.append(
    dl([
      ['Status', badge(order.status)], ['Type', humanize(order.type)], ['Provider', humanize(order.provider)],
      ['Created', fmtDateTime(order.createdAt)], ['Payer', order.payerUid || order.organizationId || '—'], ['Doctor', order.doctorId || '—'],
    ]),
    h('div', { class: 'section-gap' }),
    table([
      { label: 'Line', render: l => l.label },
      { label: 'Amount', render: l => h('span', { class: 'mono' }, inr(l.amountPaise)) },
    ], order.breakdown?.lines ?? []),
    h('div', { class: 'dl section-gap' }, h('div', { class: 'dl-item' }, h('div', { class: 'dl-label' }, 'Total'), h('div', { class: 'dl-value' }, inr(order.totalPaise)))),
    order.payment ? h('p', { class: 'muted section-gap' }, `Payment: ${order.payment.reference} (${humanize(order.payment.method)}) on ${fmtDateTime(order.payment.atIso)}`) : null,
    order.payout ? h('p', { class: 'muted' }, `Payout: ${order.payout.reference} · ${inr(order.payout.amountPaise)}`) : null,
    order.refund ? h('p', { class: 'muted' }, `Refund: ${order.refund.reference} · ${inr(order.refund.amountPaise)}`) : null,
  );
  if (actions.length && order.provider === 'manual') {
    modal.showFoot(...actions.map(([action, label]) => h('button', {
      class: `btn ${action === 'cancel' || action === 'refund_sent' ? 'btn-secondary' : 'btn-primary'}`, type: 'button',
      onclick: () => { modal.close(); recordMoney(order, action, label, onDone); },
    }, label)));
  }
}

export async function renderPayments(root, ctx) {
  const status = ctx.state?.paymentTab || 'awaiting_payment';
  const data = await invoke('listPaymentOrders', { status });
  const config = await invoke('getPlatformConfig');
  const provider = config.business.payment_policy.value.provider;
  const paymentsOn = config.featureFlags.find(f => f.key === 'payments_enabled')?.enabled;
  add(root,
    pageHead('Payments', 'Duty bookings, plan purchases and last-minute charges. Every movement of money is written to the ledger.',
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => ctx.rerender() }, icon('refresh'), 'Refresh')),
    provider === 'manual' ? h('div', { class: 'alert alert-info' },
      'Manual mode: payers pay by UPI or bank transfer using your instructions, and staff record each payment, payout and refund here. A licensed payment gateway can replace this later.') : null,
    paymentsOn ? null : h('div', { class: 'alert alert-warn' }, 'Duty-booking payments are off (Feature Flags → payments_enabled). Plan and last-minute orders still appear here.'),
    h('div', { class: 'grid grid-3' },
      card('Collected', 'Paid orders in this list', h('div', { class: 'stat' }, inr(data.totals.paidPaise))),
      card('Platform revenue', 'Before GST', h('div', { class: 'stat' }, inr(data.totals.platformRevenuePaise))),
      card('GST collected', 'On platform charges', h('div', { class: 'stat' }, inr(data.totals.gstPaise)))),
    h('div', { class: 'section-gap' }, tabs(PAYMENT_TABS.map(([value, label]) => ({ value, label })), status, value => { ctx.state.paymentTab = value; ctx.rerender(); })),
    card(null, null, table([
      { label: 'Order', render: o => cellMain(o.description, humanize(o.type)) },
      { label: 'Total', render: o => h('span', { class: 'mono' }, inr(o.totalPaise)) },
      { label: 'Status', render: o => badge(o.status) },
      { label: 'Created', render: o => fmtRelative(o.createdAt) },
      { label: '', render: o => (NEXT_ACTIONS[o.status] ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openOrder(o, () => ctx.rerender()) }, 'Open') : null) },
    ], data.orders, { onRow: o => openOrder(o, () => ctx.rerender()), emptyTitle: 'No orders here' })));
}

// ── Premium plans ─────────────────────────────────────────
export async function renderPlans(root, ctx) {
  const [{ subscribers }, config] = await Promise.all([invoke('listSubscribers'), invoke('getPlatformConfig')]);
  const plans = config.business.subscription_policy.value.plans;
  const grant = () => {
    const uid = h('input', { class: 'input', placeholder: 'Doctor user ID', spellcheck: false });
    const kind = h('select', { class: 'select' }, h('option', { value: 'premium' }, 'Premium'), h('option', { value: 'ai' }, 'AI assistant'));
    const months = h('input', { class: 'input', type: 'number', min: 1, max: 36, value: '6' });
    const reason = h('input', { class: 'input', maxlength: 300, placeholder: 'e.g. Pilot partner hospital doctor' });
    actionDialog({
      title: 'Grant a plan without payment', reason: false, notes: false, confirmLabel: 'Grant',
      message: 'Adds months to the doctor’s plan. Recorded in the audit trail with your reason.',
      extra: h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', {}, 'Doctor'), uid), h('div', { class: 'field' }, h('label', {}, 'Plan'), kind),
        h('div', { class: 'field' }, h('label', {}, 'Months'), months), h('div', { class: 'field' }, h('label', {}, 'Reason'), reason)),
      onConfirm: () => invoke('grantSubscription', { uid: uid.value.trim(), kind: kind.value, months: Number(months.value), reason: reason.value.trim() }),
    }).then(ok => { if (ok) { toast('Plan granted.'); ctx.rerender(); } });
  };
  add(root,
    pageHead('Premium & AI Plans', 'Active subscribers. Prices and durations are set in Business Settings.',
      roles.admin() ? h('button', { class: 'btn btn-primary', type: 'button', onclick: grant }, icon('plus'), 'Grant plan') : null),
    h('div', { class: 'grid grid-2' }, plans.map(p => card(p.name, p.active ? 'On sale' : 'Hidden', dl([
      ['Price', `₹${p.priceInr} + GST`], ['Duration', `${p.durationMonths} month(s)`], ['Kind', humanize(p.kind)],
    ])))),
    h('div', { class: 'section-gap' }, card('Subscribers', `${subscribers.length} active`, table([
      { label: 'Doctor', render: s => cellMain(s.name || 'Doctor', s.uid) },
      { label: 'Premium until', render: s => (s.premiumUntil ? fmtDate(s.premiumUntil) : '—') },
      { label: 'AI plan until', render: s => (s.aiUntil ? fmtDate(s.aiUntil) : '—') },
    ], subscribers, { emptyTitle: 'No active subscribers yet' }))));
}

// ── Last-minute service ───────────────────────────────────
export async function renderLastMinute(root, ctx) {
  const date = ctx.state?.standbyDate || new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [{ requests }, pool] = await Promise.all([invoke('listLastMinuteRequests'), invoke('listStandbyPool', { date })]);
  const dateInput = h('input', { class: 'input', type: 'date', value: date });
  dateInput.addEventListener('change', () => { ctx.state.standbyDate = dateInput.value; ctx.rerender(); });
  add(root,
    pageHead('Last-Minute Service', 'Paid confirmation requests and the private standby list. The standby list is visible only here.'),
    card('Confirmation requests', 'Open, matched and awaiting refund', table([
      { label: 'Duty', render: r => cellMain(`${r.specialtyName ?? 'Duty'} · ${r.facilityName ?? ''}`, r.startAt ? fmtDateTime(r.startAt) : null) },
      { label: 'Status', render: r => badge(r.status) },
      { label: 'Search closes', render: r => (r.deadlineAt ? fmtDateTime(r.deadlineAt) : '—') },
      { label: 'Matched', render: r => String((r.matchedDoctorIds ?? []).length) },
      { label: 'Charge', render: r => inr(r.totalPaise) },
    ], requests, { emptyTitle: 'No confirmation requests', emptyDetail: 'Hospitals request the service from a duty that starts soon.' })),
    h('div', { class: 'section-gap' }, card('Standby doctors', `${pool.doctors.length} ready on ${fmtDate(date)}`, h('div', {},
      h('div', { class: 'field' }, h('label', {}, 'Date'), dateInput),
      table([
        { label: 'Doctor', render: d => cellMain(d.name || 'Doctor', d.primarySpecialty) },
        { label: 'Cities', render: d => (d.preferredCities ?? []).join(', ') || '—' },
        { label: 'Other dates', render: d => (d.dates ?? []).filter(x => x !== date).slice(0, 4).join(', ') || '—' },
        { label: 'Note', render: d => d.note || '—' },
      ], pool.doctors, { emptyTitle: 'Nobody on standby for this date' })))));
}

// ── Channel reports ───────────────────────────────────────
const CHANNEL_ACTIONS = [
  ['remove_message', 'Remove message'], ['remove_and_ban_sender', 'Remove message and ban sender'],
  ['close_channel', 'Close the whole channel'], ['dismiss', 'Dismiss report'],
];

export async function renderChannelReports(root, ctx) {
  const { reports } = await invoke('listChannelReports');
  const resolve = report => {
    const select = h('select', { class: 'select' }, CHANNEL_ACTIONS.map(([v, l]) => h('option', { value: v }, l)));
    actionDialog({
      title: `Report in ${report.channelName}`, reason: false, notes: false, confirmLabel: 'Apply',
      extra: h('div', {}, dl([['Reason', humanize(report.reason)], ['Message', report.messageText || `(${report.messageType})`],
        ['Sender', report.senderId], ['Reported by', report.reporterId], ['Filed', fmtDateTime(report.createdAt)]]),
      report.details ? h('p', { class: 'muted section-gap' }, report.details) : null,
      h('div', { class: 'field section-gap' }, h('label', {}, 'Action'), select)),
      danger: true,
      onConfirm: () => invoke('moderateChannelReport', { reportId: report.reportId, action: select.value }),
    }).then(ok => { if (ok) { toast('Done and recorded.'); ctx.rerender(); } });
  };
  add(root,
    pageHead('Channel Reports', 'Messages members reported in community channels.'),
    card(null, null, table([
      { label: 'Channel', render: r => cellMain(r.channelName, humanize(r.reason)) },
      { label: 'Message', render: r => (r.messageText ? `${r.messageText.slice(0, 90)}${r.messageText.length > 90 ? '…' : ''}` : `(${r.messageType})`) },
      { label: 'Filed', render: r => fmtRelative(r.createdAt) },
      { label: '', render: r => h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => resolve(r) }, 'Review') },
    ], reports, { onRow: resolve, emptyTitle: 'No open channel reports' })));
}

// ── Business settings ─────────────────────────────────────
const FIELDS = {
  attendance_policy: ['QR attendance', 'Check-in and check-out rules', [
    ['radiusMeters', 'On-site radius', 'metres', 'How far from the hospital branch a scan still counts as on site.'],
    ['lateToleranceMinutes', 'Late check-in tolerance', 'minutes', 'After this, the hospital is asked to acknowledge.'],
    ['earlyLeaveToleranceMinutes', 'Early check-out tolerance', 'minutes', 'Leaving earlier than this is flagged.'],
    ['codeTtlSeconds', 'QR code lifetime', 'seconds', 'A shown code stops working after this.'],
    ['checkInOpensMinutesBefore', 'Check-in opens', 'minutes before start', 'Earliest time a check-in code can be shown.'],
  ]],
  payment_policy: ['Payments', 'Fees, GST and payment instructions', [
    ['platformFeeInr', 'Platform fee per booking', '₹', 'Added to each duty booking.'],
    ['gstRatePercent', 'GST rate', '%', 'Applied to platform charges only, never to the doctor’s pay.'],
    ['manualInstructions', 'Payment instructions', 'text', 'Shown to payers in manual mode, e.g. your UPI ID.'],
  ]],
  last_minute_policy: ['Last-minute service', 'Confirmation charge and search window', [
    ['windowHours', 'Qualifies when starting within', 'hours', 'Only duties starting this soon can request the service.'],
    ['confirmationChargeInr', 'Confirmation charge', '₹ + GST', 'Refunded in full when nobody accepts.'],
    ['searchCloseMinutesBeforeStart', 'Search closes', 'minutes before start', 'Unmatched requests move to refund then.'],
  ]],
  channel_policy: ['Community channels', 'Limits', [
    ['maxMessageLength', 'Max message length', 'characters', ''],
    ['maxVoiceSeconds', 'Max voice note', 'seconds', ''],
    ['maxOwnedChannels', 'Channels per doctor', 'channels', ''],
  ]],
  ai_policy: ['AI assistant', 'OpenAI model and free quota', [
    ['model', 'Model', 'text', 'OpenAI model name.'],
    ['freeQuestions', 'Free questions per account', 'questions', 'After these, the AI plan is needed.'],
    ['maxOutputTokens', 'Max answer length', 'tokens', ''],
  ]],
};

function policyCard(key, entry, canEdit, ctx) {
  const [title, subtitle, fields] = FIELDS[key];
  const inputs = {};
  const err = h('div', { class: 'alert alert-error', hidden: true });
  const form = h('form', { novalidate: true },
    h('div', { class: 'form-grid' }, fields.map(([field, label, unit, hint]) => {
      const value = entry.value[field];
      const input = unit === 'text'
        ? h('input', { class: 'input', value: value ?? '', disabled: !canEdit, maxlength: 500 })
        : h('input', { class: 'input', type: 'number', step: 'any', value: String(value ?? ''), disabled: !canEdit });
      inputs[field] = [input, unit];
      return h('div', { class: 'field' }, h('label', {}, `${label}${unit && unit !== 'text' ? ` (${unit})` : ''}`), input,
        hint ? h('span', { class: 'hint' }, hint) : null);
    })),
    err,
    h('div', { class: 'btn-row end' }, h('button', { class: 'btn btn-primary', type: 'submit', disabled: !canEdit }, 'Save')));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.hidden = true;
    const value = { ...entry.value };
    for (const [field, [input, unit]] of Object.entries(inputs)) {
      value[field] = unit === 'text' ? input.value.trim() : Number(input.value);
      if (unit !== 'text' && !Number.isFinite(value[field])) { err.textContent = 'Enter numbers only.'; err.hidden = false; return; }
    }
    const ok = await actionDialog({
      title: `Save ${title.toLowerCase()} settings?`, message: 'Applies immediately and is recorded in the audit trail.',
      reason: false, notes: false, confirmLabel: 'Save',
      onConfirm: () => invoke('updatePlatformConfig', { configKey: key, configValue: value }),
    });
    if (ok) { toast('Saved.'); ctx.rerender(); }
  });
  return card(title, subtitle, form);
}

function plansCard(entry, canEdit, ctx) {
  const policy = structuredClone(entry.value);
  const rows = policy.plans.map(plan => {
    const name = h('input', { class: 'input', value: plan.name, disabled: !canEdit, maxlength: 60 });
    const price = h('input', { class: 'input', type: 'number', min: 0, value: String(plan.priceInr), disabled: !canEdit });
    const months = h('input', { class: 'input', type: 'number', min: 1, max: 36, value: String(plan.durationMonths), disabled: !canEdit });
    const active = h('input', { type: 'checkbox', checked: plan.active, disabled: !canEdit });
    return { plan, name, price, months, active, node: h('div', { class: 'form-grid section-gap' },
      h('div', { class: 'field' }, h('label', {}, `${humanize(plan.kind)} plan name`), name),
      h('div', { class: 'field' }, h('label', {}, 'Price (₹, before GST)'), price),
      h('div', { class: 'field' }, h('label', {}, 'Duration (months)'), months),
      h('label', { class: 'check' }, active, 'On sale')) };
  });
  const early = h('input', { class: 'input', type: 'number', min: 0, max: 1440, value: String(policy.earlyAccessMinutes), disabled: !canEdit });
  const err = h('div', { class: 'alert alert-error', hidden: true });
  const form = h('form', { novalidate: true },
    h('div', { class: 'field' }, h('label', {}, 'Premium early access (minutes)'), early,
      h('span', { class: 'hint' }, 'New duties are shown only to premium doctors for this long. 0 turns early access off.')),
    ...rows.map(r => r.node), err,
    h('div', { class: 'btn-row end' }, h('button', { class: 'btn btn-primary', type: 'submit', disabled: !canEdit }, 'Save')));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const value = {
      earlyAccessMinutes: Number(early.value),
      plans: rows.map(r => ({ ...r.plan, name: r.name.value.trim(), priceInr: Number(r.price.value), durationMonths: Number(r.months.value), active: r.active.checked })),
    };
    const ok = await actionDialog({
      title: 'Save plans and early access?', message: 'New prices apply to new purchases; existing subscribers keep their end dates.',
      reason: false, notes: false, confirmLabel: 'Save',
      onConfirm: () => invoke('updatePlatformConfig', { configKey: 'subscription_policy', configValue: value }),
    });
    if (ok) { toast('Saved.'); ctx.rerender(); }
  });
  return card('Plans & early access', 'Prices are changeable any time', form);
}

export async function renderBusinessSettings(root, ctx) {
  const body = h('div', {}, loading());
  add(root, pageHead('Business Settings', 'Attendance, payments, plans, last-minute service, channels and AI. Validated on the server and audited.'), body);
  let config;
  try { config = await invoke('getPlatformConfig'); } catch (error) { put(body, errorBox(error, () => ctx.rerender())); return; }
  const { business, canEdit } = config;
  put(body,
    canEdit ? null : h('div', { class: 'alert alert-info' }, 'Read only. Only super admins can change these settings.'),
    h('div', { class: 'grid grid-2' },
      policyCard('attendance_policy', business.attendance_policy, canEdit, ctx),
      policyCard('payment_policy', business.payment_policy, canEdit, ctx),
      plansCard(business.subscription_policy, canEdit, ctx),
      policyCard('last_minute_policy', business.last_minute_policy, canEdit, ctx),
      policyCard('channel_policy', business.channel_policy, canEdit, ctx),
      policyCard('ai_policy', business.ai_policy, canEdit, ctx)),
    h('div', { class: 'section-gap' }, card('Turning modules on', null, h('p', { class: 'muted' },
      'Each module is switched on separately in Feature Flags. Attendance is always on.'))));
}
