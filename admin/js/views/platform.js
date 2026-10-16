/** Admins & Roles, System Health, Notifications, Support Cases. */

import { h, icon, badge, fmtDateTime, fmtRelative, humanize, fmtNum, initials, add, put } from '../core/dom.js';
import {
  actionDialog, card, cellMain, dl, errorMessage, loading, openModal, pageHead, table, tabs, toast, toastError,
} from '../core/ui.js';
import { session, invoke } from '../core/session.js';

// ── Admins & Roles ────────────────────────────────────────

const ROLE_INFO = [
  ['isVerifier', 'Verifier', 'Reviews doctor and hospital cases and opens evidence.'],
  ['isSupportAdmin', 'Support admin', 'Moderation, accounts, notifications, support cases, audit.'],
  ['isSuperAdmin', 'Super admin', 'Everything, including roles, configuration and escalated decisions.'],
];

const roleBadges = r => h('div', { class: 'badges' },
  ROLE_INFO.filter(([key]) => r[key]).map(([key, label]) => badge(key === 'isSuperAdmin' ? 'ink' : null, label)),
  !ROLE_INFO.some(([key]) => r[key]) ? badge(null, 'No role') : null);

function roleChecks(current = {}) {
  const inputs = Object.fromEntries(ROLE_INFO.map(([key]) => [key, h('input', { type: 'checkbox', checked: Boolean(current[key]) })]));
  const node = h('div', {}, ROLE_INFO.map(([key, label, detail]) =>
    h('label', { class: 'check' }, inputs[key], h('span', {}, h('strong', {}, label), h('span', { class: 'faint' }, ` · ${detail}`)))));
  const value = () => Object.fromEntries(ROLE_INFO.map(([key]) => [key, inputs[key].checked]));
  return { node, value };
}

function editRoles(member, onDone) {
  const checks = roleChecks(member.roles);
  return actionDialog({
    title: `Roles for ${member.displayName || member.email}`,
    message: 'Removing a role signs the person out of every session at once.',
    extra: checks.node, confirmLabel: 'Save roles', reasonPlaceholder: 'e.g. ROLE_CHANGE_APPROVED', notes: false,
    onConfirm: v => invoke('setCustomClaims', { targetUid: member.uid, claims: checks.value(), reasonCode: v.reasonCode }),
  }).then(ok => { if (ok) { toast('Roles updated.'); onDone(); } });
}

function addStaff(onDone) {
  const modal = openModal({ title: 'Add staff member' });
  const err = h('div', { class: 'alert alert-error', hidden: true });
  const username = h('input', { class: 'input', placeholder: 'e.g. priya.s', autocapitalize: 'none', spellcheck: false, maxlength: 32 });
  const name = h('input', { class: 'input', placeholder: 'Full name', maxlength: 80 });
  const reason = h('input', { class: 'input', placeholder: 'e.g. NEW_VERIFIER_HIRED', maxlength: 64, spellcheck: false });
  reason.addEventListener('input', () => { reason.value = reason.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'); });
  const checks = roleChecks({ isVerifier: true });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create account');
  const form = h('form', { novalidate: true }, err,
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', {}, 'Username'), username, h('span', { class: 'hint' }, 'They sign in with this username.')),
      h('div', { class: 'field' }, h('label', {}, 'Display name'), name)),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Roles'), checks.node),
    h('div', { class: 'field' }, h('label', {}, 'Reason code'), reason),
    h('div', { class: 'btn-row end' }, h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => modal.close() }, 'Cancel'), submit));
  add(modal.body, form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    try {
      const r = await invoke('createStaffAccount', {
        username: username.value.trim().toLowerCase(), displayName: name.value.trim(), claims: checks.value(), reasonCode: reason.value.trim(),
      });
      const password = h('div', { class: 'secret' }, r.temporaryPassword);
      put(modal.body, 
        h('div', { class: 'alert alert-ok' }, `Account created for ${r.username}.`),
        h('div', { class: 'label' }, 'Temporary password (shown once)'), password,
        h('p', { class: 'muted' }, 'Share it privately. On first sign-in they must set up an authenticator app, and should change the password from My account.'),
        h('div', { class: 'btn-row end section-gap' },
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => {
            try { await navigator.clipboard.writeText(r.temporaryPassword); toast('Copied.'); } catch (_) { toast('Copy failed; select the text instead.', { error: true }); }
          } }, 'Copy'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { modal.close(); onDone(); } }, 'Done')));
    } catch (error) {
      const fields = error?.details?.fieldErrors;
      err.textContent = fields ? Object.entries(fields).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ') : errorMessage(error);
      err.hidden = false;
      submit.disabled = false;
    }
  });
}

export async function renderStaff(root, ctx) {
  const { staff, viewerCanEdit } = await invoke('listStaff');
  const me = session.user.uid;
  const withoutMfa = staff.filter(s => s.active && !s.mfaFactors.length).length;
  add(root, 
    pageHead('Admins & Roles', 'Who can use this portal and what they can do',
      viewerCanEdit ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => addStaff(() => ctx.rerender()) }, icon('plus'), 'Add staff') : null),
    !viewerCanEdit ? h('div', { class: 'alert alert-info' }, 'Only super admins can add staff or change roles.') : null,
    withoutMfa && !session.emulator ? h('div', { class: 'alert alert-warn' }, `${withoutMfa} active staff account(s) have no authenticator yet. They are asked to set one up at their next sign-in and cannot use staff tools until they do.`) : null,
    h('div', { class: 'grid grid-3 section-gap' }, ROLE_INFO.map(([key, label, detail]) => h('div', { class: 'card kpi' },
      h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-val' }, fmtNum(staff.filter(s => s.active && s.roles[key]).length)),
      h('div', { class: 'kpi-foot' }, detail)))),
    h('div', { class: 'section-gap' }, card(null, null, table([
      { label: 'Staff member', render: s => h('div', { class: 'btn-row' }, h('span', { class: 'avatar' }, initials(s.displayName || s.email)),
        cellMain(`${s.displayName || '—'}${s.uid === me ? ' (you)' : ''}`, s.email)) },
      { label: 'Roles', render: s => roleBadges(s.roles) },
      { label: 'Authenticator', render: s => (s.mfaFactors.length ? badge('ok', 'Enrolled') : badge('warning', 'Not set up')) },
      { label: 'Last sign-in', render: s => fmtRelative(s.lastSignInAt) },
      { label: 'Status', render: s => (s.missingAccount ? badge('expired', 'Account deleted') : s.disabled ? badge('suspended', 'Disabled') : badge(s.active ? 'active' : null, s.active ? 'Active' : 'No role')) },
      { label: '', render: s => (viewerCanEdit && s.uid !== me && !s.missingAccount
        ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => editRoles(s, () => ctx.rerender()) }, 'Edit roles') : null) },
    ], staff, { emptyTitle: 'No staff listed', emptyDetail: 'Accounts appear here once created or given a role.' }))));
}

// ── System health ─────────────────────────────────────────

export async function renderSystemHealth(root, ctx) {
  const health = await invoke('getSystemHealth');
  const tone = { ok: 'ok', warning: 'warning', blocked_external: 'blocked_external' };
  const label = { ok: 'Healthy', warning: 'Needs attention', blocked_external: 'Blocked (external setup)' };
  const o = health.outbox.counts;
  add(root, 
    pageHead('System Health', `Background workers and integrations · checked ${fmtDateTime(health.generatedAt)}`,
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => ctx.rerender() }, icon('refresh'), 'Refresh')),
    card('Checks', `Region ${health.region}`, h('div', {}, health.checks.map(c => h('div', { class: 'health' },
      badge(tone[c.status], label[c.status]),
      h('div', {}, h('div', { class: 'cell-main' }, c.name), h('div', { class: 'cell-sub' }, c.detail)))))),
    h('div', { class: 'grid grid-2 section-gap' },
      card('Notification outbox', `Last delivered ${fmtRelative(health.outbox.lastDeliveredAt)}`,
        h('div', {}, dl([['Pending', fmtNum(o.pending)], ['In delivery', fmtNum(o.leased)], ['Retrying', fmtNum(o.failed)],
          ['Dead-lettered', fmtNum(o.dead_letter)], ['Delivered', fmtNum(o.delivered)], ['Skipped', fmtNum(o.skipped)],
          ['Oldest pending', health.outbox.oldestPendingAt ? fmtRelative(health.outbox.oldestPendingAt) : 'None']]),
        h('div', { class: 'section-gap' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => ctx.navigate('notifications') }, 'Open notifications')))),
      card('Evidence scanning', 'Uploaded documents are untrusted until the malware scanner clears them',
        dl([['Waiting for scan', fmtNum(health.evidence.pending)], ['Clean', fmtNum(health.evidence.clean)],
          ['Infected', fmtNum(health.evidence.infected)], ['Rejected on upload', fmtNum(health.evidence.rejected)],
          ['Oldest waiting', health.evidence.oldestPendingAt ? fmtRelative(health.evidence.oldestPendingAt) : 'None']]))));
}

// ── Notifications ─────────────────────────────────────────

export async function renderNotifications(root, ctx) {
  const state = { status: 'dead_letter' };
  const tabBar = h('div');
  const body = h('div');
  const load = async () => {
    put(body, loading());
    try {
      const { events } = await invoke('listNotificationOutbox', { status: state.status, limit: 50 });
      put(body, card(null, null, table([
        { label: 'Notification', render: e => cellMain(e.title || e.eventType, e.eventType) },
        { label: 'Recipient', render: e => cellMain(humanize(e.target.type), e.target.id) },
        { label: 'Attempts', render: e => `${e.attemptCount}${e.maxAttempts ? ` / ${e.maxAttempts}` : ''}` },
        { label: 'Last error', render: e => (e.lastError ? h('span', { class: 'cell-sub' }, e.lastError) : '—') },
        { label: 'Created', render: e => fmtRelative(e.createdAt) },
        { label: '', render: e => (['dead_letter', 'failed'].includes(e.status) ? h('button', {
          class: 'btn btn-secondary btn-sm', type: 'button', onclick: async () => {
            const ok = await actionDialog({
              title: 'Send this notification again?', message: 'It goes back to the delivery worker with a fresh retry budget.',
              confirmLabel: 'Requeue', reasonPlaceholder: 'e.g. RECIPIENT_TOKEN_FIXED', notes: false,
              onConfirm: v => invoke('requeueNotification', { eventId: e.eventId, reasonCode: v.reasonCode }),
            });
            if (ok) { toast('Requeued.'); load(); ctx.refreshCounts(); }
          } }, icon('refresh', 'icon-sm'), 'Requeue') : null) },
      ], events, { emptyTitle: state.status === 'dead_letter' ? 'No failed deliveries' : 'Nothing here' })));
    } catch (error) {
      put(body, card(null, null, h('div', { class: 'alert alert-error' }, errorMessage(error))));
    }
  };
  const drawTabs = () => put(tabBar, tabs([
    { value: 'dead_letter', label: 'Dead-lettered' }, { value: 'failed', label: 'Retrying' },
    { value: 'pending', label: 'Pending' }, { value: 'delivered', label: 'Delivered' },
  ], state.status, v => { state.status = v; drawTabs(); load(); }));
  drawTabs();
  add(root, 
    pageHead('Notifications', 'Push and in-app notifications from the delivery outbox. Business changes never depend on delivery.'),
    h('div', { class: 'alert alert-info' }, 'Broadcast messages to all users are deliberately not available here: they need a product and abuse review first.'),
    tabBar, h('div', { class: 'section-gap' }), body);
  await load();
}

// ── Support cases ─────────────────────────────────────────

const CATEGORIES = ['account', 'verification', 'duty', 'payment', 'safety', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const select = (options, value) => h('select', { class: 'select' }, options.map(o => h('option', { value: o, selected: o === value }, humanize(o))));

function newSupportCase(onDone) {
  const modal = openModal({ title: 'New support case', wide: true });
  const err = h('div', { class: 'alert alert-error', hidden: true });
  const subject = h('input', { class: 'input', maxlength: 140, placeholder: 'Short summary' });
  const description = h('textarea', { class: 'textarea', maxlength: 4000, placeholder: 'What happened, what they need, what you have tried' });
  const category = select(CATEGORIES, 'account');
  const priority = select(PRIORITIES, 'normal');
  const requesterUid = h('input', { class: 'input', placeholder: 'User ID (optional)', spellcheck: false });
  const contact = h('input', { class: 'input', maxlength: 200, placeholder: 'How they reached us, e.g. phone call, email' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Open case');
  const form = h('form', { novalidate: true }, err,
    h('div', { class: 'field' }, h('label', {}, 'Subject'), subject),
    h('div', { class: 'field' }, h('label', {}, 'Description'), description),
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', {}, 'Category'), category),
      h('div', { class: 'field' }, h('label', {}, 'Priority'), priority),
      h('div', { class: 'field' }, h('label', {}, 'Requester'), requesterUid),
      h('div', { class: 'field' }, h('label', {}, 'Contact channel'), contact)),
    h('div', { class: 'btn-row end' }, h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => modal.close() }, 'Cancel'), submit));
  add(modal.body, form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    try {
      await invoke('createSupportCase', {
        subject: subject.value.trim(), description: description.value.trim(), category: category.value, priority: priority.value,
        ...(requesterUid.value.trim() ? { requesterUid: requesterUid.value.trim() } : {}),
        ...(contact.value.trim() ? { requesterContact: contact.value.trim() } : {}),
      });
      toast('Support case opened.');
      modal.close();
      onDone();
    } catch (error) {
      const fields = error?.details?.fieldErrors;
      err.textContent = fields ? Object.entries(fields).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ') : errorMessage(error);
      err.hidden = false;
      submit.disabled = false;
    }
  });
}

async function openSupportCase(caseId, onChange) {
  const modal = openModal({ title: 'Support case', subtitle: caseId, wide: true });
  add(modal.body, loading());
  let c;
  try {
    ({ case: c } = await invoke('getSupportCase', { caseId }));
  } catch (error) {
    put(modal.body, h('div', { class: 'alert alert-error' }, errorMessage(error)));
    return;
  }
  const refresh = () => { modal.close(); onChange(); openSupportCase(caseId, onChange); };
  const update = async (data, message) => {
    try { await invoke('updateSupportCase', { caseId, ...data }); toast(message); refresh(); } catch (error) { toastError(error); }
  };
  const status = select(['open', 'pending', 'resolved'], c.status);
  status.addEventListener('change', () => update({ status: status.value }, `Marked ${humanize(status.value)}.`));
  const priority = select(PRIORITIES, c.priority);
  priority.addEventListener('change', () => update({ priority: priority.value }, 'Priority updated.'));
  const note = h('textarea', { class: 'textarea', maxlength: 2000, placeholder: 'Add a note (who you spoke to, what you did)' });
  const noteForm = h('form', {}, h('div', { class: 'field' }, note),
    h('div', { class: 'btn-row end' }, h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Add note')));
  noteForm.addEventListener('submit', e => { e.preventDefault(); if (note.value.trim()) update({ note: note.value.trim() }, 'Note added.'); });

  put(modal.body, 
    h('div', { class: 'page-head' },
      h('div', {}, h('h2', { class: 'page-title' }, c.subject), h('div', { class: 'badges section-gap' }, badge(c.status), badge(c.priority), badge(null, humanize(c.category)))),
      c.assigneeId === session.user.uid
        ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => update({ unassign: true }, 'Unassigned.') }, 'Unassign me')
        : h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => update({ assignToMe: true }, 'Assigned to you.') }, 'Assign to me')),
    h('p', { class: 'section-gap' }, c.description),
    h('h4', {}, 'Details'),
    dl([['Requester', c.requesterUid], ['Contact channel', c.requesterContact], ['Assigned to', c.assigneeName],
      ['Opened', fmtDateTime(c.createdAt)], ['Updated', fmtRelative(c.updatedAt)], ['Resolved', c.resolvedAt ? fmtDateTime(c.resolvedAt) : null]]),
    h('div', { class: 'form-grid section-gap' },
      h('div', { class: 'field' }, h('label', {}, 'Status'), status),
      h('div', { class: 'field' }, h('label', {}, 'Priority'), priority)),
    h('h4', {}, `Notes (${c.notes.length})`),
    c.notes.length ? h('div', {}, c.notes.map(n => h('div', { class: 'feed-item' },
      h('span', { class: 'avatar' }, initials(n.authorName)),
      h('div', {}, h('div', { class: 'cell-main' }, n.authorName), h('div', { class: 'feed-text' }, n.text)),
      h('span', { class: 'feed-time' }, fmtRelative(n.at))))) : h('p', { class: 'faint' }, 'No notes yet.'),
    noteForm);
}

export async function renderSupport(root, ctx) {
  const state = { status: 'open', mine: false };
  const tabBar = h('div');
  const body = h('div');
  const load = async () => {
    put(body, loading());
    try {
      const { cases, counts } = await invoke('listSupportCases', { status: state.status, mine: state.mine });
      drawTabs(counts);
      put(body, card(null, null, table([
        { label: 'Case', render: c => cellMain(c.subject, humanize(c.category)) },
        { label: 'Priority', render: c => badge(c.priority) },
        { label: 'Status', render: c => badge(c.status) },
        { label: 'Assigned to', render: c => c.assigneeName || h('span', { class: 'faint' }, 'Unassigned') },
        { label: 'Notes', render: c => fmtNum(c.noteCount) },
        { label: 'Updated', render: c => fmtRelative(c.updatedAt) },
      ], cases, { onRow: c => openSupportCase(c.caseId, load), emptyTitle: 'No support cases', emptyDetail: 'Open one when someone contacts support.' })));
    } catch (error) {
      put(body, card(null, null, h('div', { class: 'alert alert-error' }, errorMessage(error))));
    }
  };
  const drawTabs = (counts = {}) => put(tabBar, h('div', { class: 'btn-row' },
    tabs([{ value: 'open', label: 'Open', count: counts.open }, { value: 'pending', label: 'Pending', count: counts.pending },
      { value: 'resolved', label: 'Resolved', count: counts.resolved }, { value: 'all', label: 'All' }],
    state.status, v => { state.status = v; load(); }),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.mine, onchange: e => { state.mine = e.target.checked; load(); } }), 'Only mine')));
  drawTabs();
  add(root, 
    pageHead('Support Cases', 'Issues people raise by phone or email, tracked to resolution',
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newSupportCase(load) }, icon('plus'), 'New case')),
    h('div', { class: 'alert alert-info' }, 'There is no in-app "Contact support" yet; staff open cases on the person’s behalf.'),
    tabBar, h('div', { class: 'section-gap' }), body);
  await load();
}
