/** Audit & Compliance and Admin Activity: the immutable audit trail. */

import { h, icon, badge, fmtDateTime, humanize, downloadCsv, add, put } from '../core/dom.js';
import { card, cellMain, dl, errorMessage, loading, moreButton, openModal, pageHead, table, tabs } from '../core/ui.js';
import { session, invoke } from '../core/session.js';

function openEntry(e) {
  const modal = openModal({ title: humanize(e.action), subtitle: e.auditId, wide: true });
  const json = value => h('pre', { class: 'json' }, value ? JSON.stringify(value, null, 2) : '—');
  const meta = e.securityMetadata || {};
  add(modal.body, 
    dl([['Time', fmtDateTime(e.createdAt)], ['Result', badge(e.result)], ['Actor', `${humanize(e.actorRole)} · ${e.actorId}`],
      ['Target', `${humanize(e.targetType)} · ${e.targetId || '—'}`], ['Reason code', e.reasonCode], ['Correlation ID', e.correlationId],
      ['Callable', meta.callable], ['IP address', meta.ipAddress], ['Forwarded for', meta.forwardedFor]]),
    meta.userAgent ? h('p', { class: 'cell-sub section-gap' }, `User agent: ${meta.userAgent}`) : null,
    h('h4', {}, 'Before'), json(e.beforeSummary),
    h('h4', {}, 'After'), json(e.afterSummary));
}

/** `scope` is 'all' (Audit & Compliance) or 'staff' (Admin Activity). */
export async function renderAudit(root, ctx, scope) {
  const isStaffView = scope === 'staff';
  const state = { mode: isStaffView ? 'staff' : 'all', value: '', entries: [], cursor: null };
  const FILTERS = isStaffView
    ? [{ value: 'staff', label: 'All staff' }, { value: 'mine', label: 'Only mine' }]
    : [{ value: 'all', label: 'Everything' }, { value: 'denied', label: 'Denied attempts' }, { value: 'failed', label: 'Failed' },
      { value: 'action', label: 'By action' }, { value: 'target', label: 'By target ID' }, { value: 'actor', label: 'By actor ID' }];

  const query = () => {
    switch (state.mode) {
      case 'staff': return { scope: 'staff' };
      case 'mine': return { actorId: session.user.uid };
      case 'denied': return { result: 'DENIED' };
      case 'failed': return { result: 'FAILED' };
      case 'action': return state.value ? { action: state.value.toUpperCase() } : {};
      case 'target': return state.value ? { targetId: state.value } : {};
      case 'actor': return state.value ? { actorId: state.value } : {};
      default: return {};
    }
  };

  const tabBar = h('div');
  const valueInput = h('input', { class: 'input', placeholder: 'Value', spellcheck: false });
  const valueForm = h('form', { class: 'btn-row section-gap', hidden: true },
    h('div', {}, valueInput), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Filter'));
  valueForm.addEventListener('submit', e => { e.preventDefault(); state.value = valueInput.value.trim(); load(); });
  const body = h('div');

  const draw = () => {
    const parts = [table([
      { label: 'Time', render: e => h('span', { class: 'nowrap' }, fmtDateTime(e.createdAt)) },
      { label: 'Action', render: e => h('span', { class: 'mono' }, e.action) },
      { label: 'Actor', render: e => cellMain(humanize(e.actorRole), e.actorId) },
      { label: 'Target', render: e => cellMain(humanize(e.targetType), e.targetId) },
      { label: 'Reason', render: e => e.reasonCode || '—' },
      { label: 'Result', render: e => badge(e.result) },
    ], state.entries, { onRow: openEntry, emptyTitle: 'No audit entries', emptyDetail: 'Nothing matches this filter.' })];
    if (state.cursor) parts.push(moreButton(() => load(true)));
    put(body, card(null, `${state.entries.length}${state.cursor ? '+' : ''} entries loaded`, h('div', {}, parts)));
  };
  const load = async (more = false) => {
    if (!more) put(body, loading());
    try {
      const r = await invoke('getAuditLogs', { ...query(), limit: 50, ...(more && state.cursor ? { cursor: state.cursor } : {}) });
      state.entries = more ? [...state.entries, ...r.entries] : r.entries;
      state.cursor = r.nextCursor;
      draw();
    } catch (error) {
      put(body, card(null, null, h('div', { class: 'alert alert-error' }, errorMessage(error))));
    }
  };
  const drawTabs = () => {
    put(tabBar, tabs(FILTERS, state.mode, mode => {
      state.mode = mode;
      state.value = '';
      valueInput.value = '';
      drawTabs();
      const needsValue = ['action', 'target', 'actor'].includes(mode);
      valueForm.hidden = !needsValue;
      valueInput.placeholder = mode === 'action' ? 'e.g. VERIFICATION_DECISION_RECORDED' : mode === 'target' ? 'Document ID' : 'User ID';
      if (needsValue) valueInput.focus(); else load();
    }));
  };
  drawTabs();

  const exportBtn = h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => downloadCsv(
    `healthforce-${isStaffView ? 'admin-activity' : 'audit'}-${new Date().toISOString().slice(0, 10)}.csv`,
    [['time', 'action', 'actorRole', 'actorId', 'targetType', 'targetId', 'reasonCode', 'result', 'correlationId', 'ipAddress'],
      ...state.entries.map(e => [e.createdAt, e.action, e.actorRole, e.actorId, e.targetType, e.targetId, e.reasonCode, e.result,
        e.correlationId, e.securityMetadata?.ipAddress])]) }, icon('download'), 'Export loaded rows');

  add(root, 
    pageHead(isStaffView ? 'Admin Activity' : 'Audit & Compliance',
      isStaffView ? 'Every action taken by verifiers and administrators'
        : 'Append-only record of privileged actions, decisions and denied attempts. Entries cannot be edited or deleted.',
      exportBtn),
    tabBar, valueForm, h('div', { class: 'section-gap' }), body);
  await load();
}
