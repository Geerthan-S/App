/** Community reports: review and resolve with an audited action. */

import { h, icon, badge, fmtRelative, fmtDateTime, humanize, add } from '../core/dom.js';
import { actionDialog, card, cellMain, dl, pageHead, table, toast } from '../core/ui.js';
import { invoke } from '../core/session.js';
import { openDoctor, openDuty } from './directory.js';

const ACTIONS = {
  duty: [
    ['hide_duty', 'Hide duty', 'Pauses the listing so doctors can no longer see or apply to it. It can be restored from Duty Moderation.'],
    ['dismiss', 'Dismiss report', 'Closes the report with no change to the duty.'],
  ],
  user: [
    ['warn_user', 'Record warning', 'Records a warning on the audit trail. The person is not notified automatically.'],
    ['suspend_user', 'Suspend account', 'Blocks every platform action and signs the person out of all devices. Reinstate from Doctors.'],
    ['dismiss', 'Dismiss report', 'Closes the report with no change to the account.'],
  ],
};

function resolveReport(report, onDone) {
  const options = ACTIONS[report.targetType] || [];
  const select = h('select', { class: 'select' }, options.map(([value, label]) => h('option', { value }, label)));
  const hint = h('p', { class: 'hint' });
  const updateHint = () => { hint.textContent = options.find(([v]) => v === select.value)?.[2] || ''; };
  select.addEventListener('change', updateHint);
  updateHint();

  const extra = h('div', {},
    dl([['Target', `${humanize(report.targetType)} · ${report.targetId}`], ['Reason', report.reason],
      ['Reported by', report.reporterId], ['Reported', fmtDateTime(report.createdAt)]]),
    report.details ? h('p', { class: 'muted section-gap' }, report.details) : null,
    h('div', { class: 'section-gap' },
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: () => (report.targetType === 'duty' ? openDuty(report.targetId) : openDoctor(report.targetId)) },
      icon('external', 'icon-sm'), `Open ${report.targetType}`)),
    h('div', { class: 'field section-gap' }, h('label', {}, 'Action'), select, hint));

  return actionDialog({
    title: report.targetType === 'duty' ? 'Reported duty' : 'Reported user',
    extra, confirmLabel: 'Apply action', reasonPlaceholder: 'e.g. SPAM_LISTING',
    onConfirm: v => invoke('submitModerationAction', { reportId: report.reportId, action: select.value, ...v }),
  }).then(result => { if (result) { toast('Action applied and recorded.'); onDone(); } });
}

export async function renderReports(root, ctx) {
  const { moderationQueue } = await invoke('getAdminQueues');
  const done = () => { ctx.refreshCounts(); ctx.rerender(); };
  add(root, 
    pageHead('Reports', 'Duties and people reported by the community. Each person can hold one open report per target.',
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => ctx.rerender() }, icon('refresh'), 'Refresh')),
    card(null, null, table([
      { label: 'Target', render: r => cellMain(r.targetId, humanize(r.targetType)) },
      { label: 'Reason', render: r => cellMain(r.reason || '—', r.details ? `${r.details.slice(0, 80)}${r.details.length > 80 ? '…' : ''}` : null) },
      { label: 'Reported by', render: r => h('span', { class: 'mono' }, r.reporterId || '—') },
      { label: 'Filed', render: r => fmtRelative(r.createdAt) },
      { label: 'Status', render: r => badge(r.status || 'open') },
      { label: '', render: r => h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !ACTIONS[r.targetType],
        onclick: () => resolveReport(r, done) }, 'Resolve') },
    ], moderationQueue, {
      onRow: r => ACTIONS[r.targetType] && resolveReport(r, done),
      emptyTitle: 'No open reports', emptyDetail: 'The community has not reported anything that needs action.',
    })));
}
