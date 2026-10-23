/** Dashboard and Attention Center. */

import { h, icon, fmtNum, fmtRelative, fmtDateTime, humanize, initials, badge, add, put } from '../core/dom.js';
import { card, empty, pageHead, tabs, table, cellMain } from '../core/ui.js';
import { session, roles, invoke } from '../core/session.js';
import { openCase, slaBadge, flagBadges } from './verification.js';

const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

/** Opens the record behind an attention item, or its section. */
export function openAttentionItem(item, ctx) {
  if (item.targetId && ['escalated_case', 'sla_overdue', 'sla_due_soon', 'stale_info_request'].includes(item.kind)) {
    openCase(item.targetId, { onChange: ctx.refreshCounts });
  } else {
    ctx.navigate(item.view);
  }
}

const attentionRow = (item, ctx) => h('button', { class: 'attn', type: 'button', onclick: () => openAttentionItem(item, ctx) },
  h('span', { class: `sev sev-${item.severity}`, title: SEVERITY_LABEL[item.severity] }),
  h('span', {}, h('div', { class: 'attn-title' }, item.title), h('div', { class: 'attn-detail' }, item.detail)),
  icon('chevron', 'icon-sm'));

const kpi = ({ label, value, foot, footTone, iconName, hot, onClick }) => h('div', {
  class: `card kpi${onClick ? ' clickable' : ''}`, role: onClick ? 'button' : null, tabindex: onClick ? 0 : null,
  onclick: onClick, onkeydown: onClick ? e => { if (e.key === 'Enter') onClick(); } : null,
},
h('div', { class: 'kpi-top' }, h('span', { class: 'kpi-label' }, label), h('span', { class: `kpi-icon${hot ? ' hot' : ''}` }, icon(iconName))),
h('div', { class: 'kpi-val' }, value),
h('div', { class: `kpi-foot${footTone ? ` ${footTone}` : ''}` }, foot));

function trendChart(trend) {
  const max = Math.max(1, ...trend.flatMap(d => [d.submitted, d.decided]));
  const bar = (n, cls) => {
    const node = h('span', { class: `chart-bar ${cls}`, title: String(n) });
    node.style.height = `${Math.round((n / max) * 100)}%`;
    return node;
  };
  return h('div', {},
    h('div', { class: 'chart', role: 'img', 'aria-label': 'Cases submitted and decided per day, last 7 days' },
      trend.map(d => h('div', { class: 'chart-col' },
        h('div', { class: 'chart-bars' }, bar(d.submitted, 'a'), bar(d.decided, 'b')),
        h('span', { class: 'chart-day' }, new Date(`${d.day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' }))))),
    h('div', { class: 'legend section-gap' }, h('span', {}, h('i', { class: 'a' }), 'Submitted'), h('span', {}, h('i', { class: 'b' }), 'Decided')));
}

function queuePreview(cases, ctx) {
  const state = { filter: 'all' };
  const holder = h('div');
  const mine = c => c.assigneeId === session.user.uid;
  const filters = {
    all: () => true, doctor: c => c.subjectType === 'doctor', organization: c => c.subjectType === 'organization',
    escalated: c => c.escalated, mine,
  };
  const draw = () => {
    const rows = cases.filter(filters[state.filter]).slice(0, 8);
    put(holder, 
      tabs([
        { value: 'all', label: 'All', count: cases.length },
        { value: 'doctor', label: 'Doctors', count: cases.filter(filters.doctor).length },
        { value: 'organization', label: 'Hospitals', count: cases.filter(filters.organization).length },
        { value: 'escalated', label: 'Escalated', count: cases.filter(filters.escalated).length },
        { value: 'mine', label: 'My cases', count: cases.filter(mine).length },
      ], state.filter, v => { state.filter = v; draw(); }),
      h('div', { class: 'section-gap' }),
      table([
        { label: 'Applicant', render: c => cellMain(c.subjectName || 'Unnamed', c.registrationNo || c.subjectId) },
        { label: 'Type', render: c => badge(null, c.subjectType === 'organization' ? 'Hospital' : 'Doctor') },
        { label: 'Flags', render: c => flagBadges(c) },
        { label: 'Assigned', render: c => c.assigneeName || (c.assigneeId ? 'Staff' : h('span', { class: 'faint' }, 'Unassigned')) },
        { label: 'Submitted', render: c => h('span', { class: 'nowrap' }, fmtRelative(c.submittedAt)) },
        { label: 'SLA', render: c => slaBadge(c) },
        { label: 'Status', render: c => badge(c.status) },
      ], rows, {
        onRow: c => openCase(c.caseId, { entry: c, onChange: () => ctx.rerender() }),
        emptyTitle: 'Queue is clear', emptyDetail: 'No cases match this filter.',
      }));
  };
  draw();
  return holder;
}

export async function renderDashboard(root, ctx) {
  const isVerifier = roles.verifier();
  const isAdmin = roles.admin();
  const [dash, attention, queue, activity] = await Promise.all([
    invoke('getAdminDashboard'),
    invoke('getAttentionItems'),
    isVerifier ? invoke('getVerificationQueue') : Promise.resolve(null),
    isAdmin ? invoke('getAuditLogs', { scope: 'staff', limit: 6 }) : Promise.resolve(null),
  ]);
  const { insights } = dash;
  const name = (session.user.displayName || session.user.email.split('@')[0]).split(' ')[0];
  const pendingTotal = dash.pending.doctorCases + dash.pending.organizationCases;

  const hero = h('section', { class: 'hero' },
    h('div', {},
      h('div', { class: 'hero-kicker' }, `Welcome back, ${name}`),
      h('h1', { class: 'hero-title' }, 'HealthForce Operations'),
      h('p', { class: 'hero-text' },
        attention.items.length
          ? [h('strong', {}, `${attention.items.length} item${attention.items.length === 1 ? '' : 's'}`), ' need attention across verification, reports and delivery.']
          : 'Nothing needs attention right now. Every queue is within its SLA.')),
    h('div', { class: 'hero-stats' },
      [['Verified doctors', dash.doctors.verified], ['Approved hospitals', dash.organizations.approved],
        ['Live duties', insights.cities.liveDuties], ['Active cities', insights.cities.active]]
        .map(([label, value]) => h('div', { class: 'hero-stat' }, h('div', { class: 'hero-stat-val' }, fmtNum(value)), h('div', { class: 'hero-stat-lbl' }, label)))));

  const sla = insights.sla;
  const kpis = h('div', { class: 'grid grid-4 section-gap' },
    kpi({ label: 'Pending verifications', value: fmtNum(pendingTotal), iconName: 'shield',
      foot: `${fmtNum(dash.pending.doctorCases)} doctors · ${fmtNum(dash.pending.organizationCases)} hospitals`,
      onClick: isVerifier ? () => ctx.navigate('doctors-verification') : null }),
    kpi({ label: 'Escalated cases', value: fmtNum(sla.escalated), iconName: 'flame', hot: sla.escalated > 0,
      foot: sla.escalated ? 'Waiting for a super admin decision' : 'None waiting', footTone: sla.escalated ? 'bad' : '',
      onClick: isVerifier ? () => ctx.navigate('escalated') : null }),
    kpi({ label: 'SLA breaches', value: fmtNum(sla.overdue), iconName: 'clock',
      foot: `${fmtNum(sla.dueSoon)} due within 4 h · SLA ${sla.slaHours} h`, footTone: sla.overdue ? 'bad' : '',
      onClick: isVerifier ? () => ctx.navigate('attention') : null }),
    kpi({ label: `SLA compliance (${sla.windowDays} days)`, iconName: 'check',
      value: sla.compliancePercent === null ? '—' : `${sla.compliancePercent}%`,
      foot: sla.decidedInWindow ? `${fmtNum(sla.decidedInWindow)} decisions` : 'No decisions yet',
      footTone: sla.compliancePercent !== null && sla.compliancePercent >= 90 ? 'good' : '' }));

  const attentionCard = card('Needs your attention', 'Highest priority first',
    attention.items.length
      ? h('div', { class: 'attn-list' }, attention.items.slice(0, 6).map(i => attentionRow(i, ctx)))
      : empty('All clear', 'No escalations, breaches, reports or failed deliveries.'),
    h('button', { class: 'link-btn', type: 'button', onclick: () => ctx.navigate('attention') }, 'View all', icon('chevron', 'icon-sm')));

  const network = card('Network snapshot', `Updated ${fmtDateTime(dash.generatedAt)}`,
    h('div', { class: 'stack' },
      h('div', { class: 'list-rows' },
        [['Doctors', `${fmtNum(dash.doctors.total)} · ${fmtNum(dash.doctors.verified)} verified`],
          ['Hospitals', `${fmtNum(dash.organizations.total)} · ${fmtNum(dash.organizations.approved)} approved`],
          ['Duties', `${fmtNum(dash.duties.published)} published · ${fmtNum(dash.duties.filled)} filled`],
          ['Applications', fmtNum(dash.applications.total)],
          ['Assignments in progress', fmtNum(dash.assignments.open)],
          ['Trusted registries', fmtNum(insights.registries.approvedDomains)]]
          .map(([k, v]) => h('div', {}, h('span', { class: 'muted' }, k), h('strong', {}, v)))),
      insights.cities.top.length
        ? h('div', {}, h('div', { class: 'label' }, 'Top cities by live duties'),
          h('div', { class: 'badges section-gap' }, insights.cities.top.map(c => h('span', { class: 'badge' }, icon('mapPin', 'icon-sm'), `${c.city} · ${c.duties}`))))
        : null));

  add(root, hero, kpis,
    h('div', { class: 'grid grid-main section-gap' }, attentionCard, network));

  if (queue) {
    add(root, h('div', { class: 'section-gap' }, card('Verification queue', 'Open doctor and hospital cases, escalations and SLA order first',
      queuePreview(queue.cases, ctx),
      h('button', { class: 'link-btn', type: 'button', onclick: () => ctx.navigate('doctors-verification') }, 'Open queue', icon('chevron', 'icon-sm')))));
  }

  const lower = h('div', { class: 'grid grid-3 section-gap' });
  add(lower, card('Verification trend', 'Last 7 days, India time', trendChart(insights.trend)));
  add(lower, card('Upcoming SLA breaches', `Due within 4 hours or overdue · SLA ${sla.slaHours} h`,
    sla.upcoming.length
      ? h('div', { class: 'list-rows' }, sla.upcoming.map(c => h('div', {},
        h('div', {}, h('div', { class: 'cell-main' }, c.subjectName || c.caseId), h('div', { class: 'cell-sub' }, c.registrationNo || humanize(c.subjectType))),
        slaBadge(c))))
      : empty('Nothing at risk', 'Every open case is on track.')));
  if (activity) {
    add(lower, card('Recent admin activity', 'Staff actions from the audit trail',
      activity.entries.length
        ? h('div', {}, activity.entries.map(e => h('div', { class: 'feed-item' },
          h('span', { class: 'avatar' }, initials(e.actorRole)),
          h('div', { class: 'feed-text' }, h('strong', {}, humanize(e.action).toLowerCase()), ` · ${humanize(e.targetType)} ${e.targetId || ''}`),
          h('span', { class: 'feed-time' }, fmtRelative(e.createdAt)))))
        : empty('No staff activity yet'),
      h('button', { class: 'link-btn', type: 'button', onclick: () => ctx.navigate('admin-activity') }, 'View all', icon('chevron', 'icon-sm'))));
  }
  add(root, lower);
}

export async function renderAttention(root, ctx) {
  const { items, generatedAt } = await invoke('getAttentionItems');
  const state = { filter: 'all' };
  const list = h('div');
  const draw = () => {
    const shown = items.filter(i => state.filter === 'all' || i.severity === state.filter);
    put(list, card(null, null,
      shown.length ? h('div', { class: 'attn-list' }, shown.map(i => attentionRow(i, ctx)))
        : empty('Nothing here', 'No items at this priority.')));
  };
  const count = sev => items.filter(i => i.severity === sev).length;
  const filterTabs = h('div');
  const drawTabs = () => put(filterTabs, tabs([
    { value: 'all', label: 'All', count: items.length },
    { value: 'critical', label: 'Critical', count: count('critical') },
    { value: 'high', label: 'High', count: count('high') },
    { value: 'medium', label: 'Medium', count: count('medium') },
    { value: 'low', label: 'Low', count: count('low') },
  ], state.filter, v => { state.filter = v; drawTabs(); draw(); }));
  drawTabs();
  draw();
  add(root, 
    pageHead('Attention Center', `Everything that needs a person, for your roles · updated ${fmtDateTime(generatedAt)}`,
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => ctx.rerender() }, icon('refresh'), 'Refresh')),
    filterTabs, h('div', { class: 'section-gap' }), list);
}
