/** Doctor / hospital / escalated verification queues, case review, credential renewals. */

import { h, icon, badge, fmtRelative, fmtDate, fmtDateTime, humanize, add, put } from '../core/dom.js';
import {
  actionDialog, card, cellMain, dl, empty, errorMessage, openModal, pageHead, table, tabs, toast, toastError, loading,
} from '../core/ui.js';
import { session, roles, invoke } from '../core/session.js';

const tsToIso = v => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  const seconds = v._seconds ?? v.seconds;
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
};

export function slaBadge(c) {
  if (c.slaState === 'waiting_on_applicant') return badge('waiting_on_applicant', 'Waiting on applicant');
  if (!c.slaDueAt) return badge(null, 'No SLA');
  const label = c.slaState === 'overdue' ? `Overdue ${fmtRelative(c.slaDueAt).replace(' ago', '')}` : `Due ${fmtRelative(c.slaDueAt)}`;
  return badge(c.slaState, label);
}

export function flagBadges(c) {
  const flags = [];
  if (c.escalated) flags.push(badge('overdue', 'Escalated'));
  if (c.flags?.stale) flags.push(badge('warning', 'Profile changed'));
  if (c.flags?.noEvidence) flags.push(badge('warning', 'No documents'));
  else if (c.flags?.evidencePending) flags.push(badge('pending', 'Scan pending'));
  if (c.flags?.repeat) flags.push(badge(null, 'Resubmission'));
  return flags.length ? h('div', { class: 'badges' }, flags) : h('span', { class: 'faint' }, '—');
}

const QUEUE_TITLES = {
  doctor: ['Doctor Verification', 'Medical registrations to check against the official council registers'],
  organization: ['Hospital Verification', 'Hospital establishment licences and registrations'],
  escalated: ['Escalated Cases', 'Cases a verifier sent up for senior review. Only a super admin can decide them.'],
};

export async function renderQueue(root, ctx, kind) {
  const { cases } = await invoke('getVerificationQueue');
  const scoped = cases.filter(c => (kind === 'escalated' ? c.escalated : c.subjectType === kind));
  const uid = session.user.uid;
  const FILTERS = {
    all: () => true,
    unassigned: c => !c.assigneeId,
    mine: c => c.assigneeId === uid,
    overdue: c => c.slaState === 'overdue',
    waiting: c => c.slaState === 'waiting_on_applicant',
  };
  const state = { filter: 'all' };
  const filterBar = h('div');
  const body = h('div');

  const draw = () => {
    put(filterBar, tabs([
      { value: 'all', label: 'All', count: scoped.length },
      { value: 'unassigned', label: 'Unassigned', count: scoped.filter(FILTERS.unassigned).length },
      { value: 'mine', label: 'My cases', count: scoped.filter(FILTERS.mine).length },
      { value: 'overdue', label: 'Overdue', count: scoped.filter(FILTERS.overdue).length },
      { value: 'waiting', label: 'Waiting on applicant', count: scoped.filter(FILTERS.waiting).length },
    ], state.filter, v => { state.filter = v; draw(); }));
    const rows = scoped.filter(FILTERS[state.filter]);
    put(body, card(null, null, table([
      { label: kind === 'organization' ? 'Hospital' : 'Applicant', render: c => cellMain(c.subjectName || 'Unnamed', c.subjectId) },
      { label: 'Registration', render: c => cellMain(c.registrationNo || '—', c.council || (c.subjectType === 'organization' ? 'Establishment' : '')) },
      { label: 'Flags', render: c => flagBadges(c) },
      { label: 'Assigned to', render: c => (c.assigneeId === uid ? badge('ink', 'You') : c.assigneeName || (c.assigneeId ? 'Staff' : h('span', { class: 'faint' }, 'Unassigned'))) },
      { label: 'Submitted', render: c => cellMain(fmtRelative(c.submittedAt), fmtDate(c.submittedAt)) },
      { label: 'SLA', render: c => slaBadge(c) },
      { label: 'Status', render: c => badge(c.status) },
      { label: '', render: c => h('button', { class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: () => openCase(c.caseId, { entry: c, onChange: () => { ctx.refreshCounts(); ctx.rerender(); } }) }, 'Review') },
    ], rows, {
      onRow: c => openCase(c.caseId, { entry: c, onChange: () => { ctx.refreshCounts(); ctx.rerender(); } }),
      emptyTitle: kind === 'escalated' ? 'No escalated cases' : 'Queue is clear',
      emptyDetail: 'Nothing matches this filter.',
    })));
  };
  draw();

  const [title, subtitle] = QUEUE_TITLES[kind];
  add(root, pageHead(title, subtitle,
    h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => ctx.rerender() }, icon('refresh'), 'Refresh')),
  filterBar, h('div', { class: 'section-gap' }), body);
  if (ctx.param) openCase(ctx.param, { onChange: () => ctx.rerender() });
}

// ── Case review ───────────────────────────────────────────

function decisionForm(caseData, details, { onDone }) {
  const escalatedBlock = caseData.escalated === true && !roles.superAdmin();
  const err = h('div', { class: 'alert alert-error', hidden: true });
  const decision = h('select', { class: 'select', required: true },
    h('option', { value: 'needs_information' }, 'Request more information'),
    h('option', { value: 'rejected' }, 'Reject'),
    h('option', { value: 'approved', disabled: details.isStale }, 'Approve: official source verified'));
  const reason = h('input', { class: 'input', placeholder: 'e.g. DOCS_VERIFIED', maxlength: 64, spellcheck: false });
  reason.addEventListener('input', () => { reason.value = reason.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'); });
  const notes = h('textarea', { class: 'textarea', maxlength: 1000, placeholder: 'What you checked and what you found. Saved to the audit trail.' });
  const sourceUrl = h('input', { class: 'input', type: 'url', placeholder: caseData.subjectType === 'organization' ? 'https://clinicalestablishments.gov.in/…' : 'https://www.nmc.org.in/…' });
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const checkedAt = h('input', { class: 'input', type: 'datetime-local', value: now, max: now });
  const status = h('select', { class: 'select' },
    h('option', { value: '' }, 'Select'), h('option', { value: 'ACTIVE' }, 'Active'),
    h('option', { value: 'SUSPENDED' }, 'Suspended'), h('option', { value: 'EXPIRED' }, 'Expired'));
  const isOrg = caseData.subjectType === 'organization';
  const checks = (isOrg
    ? ['Registration number matches', 'Legal name matches', 'Registering authority matches', 'Establishment type matches']
    : ['Registration number matches', 'Name matches', 'Council matches', 'Qualification matches'])
    .map(label => ({ label, input: h('input', { type: 'checkbox' }) }));
  const source = h('fieldset', { class: 'box', hidden: true },
    h('legend', {}, 'Official registry check'),
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', {}, 'Registry page (HTTPS)'), sourceUrl),
      h('div', { class: 'field' }, h('label', {}, 'Checked at'), checkedAt)),
    h('div', { class: 'field' }, h('label', {}, 'Status on the register'), status),
    checks.map(c => h('label', { class: 'check' }, c.input, c.label)),
    h('p', { class: 'hint' }, session.testingModeNotice
      ? `Approval needs every match confirmed, an Active status, a check within 24 hours and a source on a trusted registry (Medical Councils). ${session.testingModeNotice}`
      : 'Approval needs every match confirmed, an Active status, a check within 24 hours, clean documents and a source on a trusted registry (Medical Councils).'),
    isOrg ? h('p', { class: 'hint' }, 'For hospitals, check the National Register of Clinical Establishments (clinicalestablishments.gov.in) or the state register.') : null);
  decision.addEventListener('change', () => { source.hidden = decision.value !== 'approved'; });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit', disabled: escalatedBlock }, 'Record decision');

  const form = h('form', { novalidate: true },
    escalatedBlock ? h('div', { class: 'alert alert-warn' }, 'This case is escalated. Only a super admin can record the decision.') : null,
    err,
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', {}, 'Decision'), decision),
      h('div', { class: 'field' }, h('label', {}, 'Reason code'), reason)),
    h('div', { class: 'field' }, h('label', {}, 'Reviewer notes'), notes),
    source,
    h('div', { class: 'btn-row end' }, submit));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.hidden = true;
    const payload = { caseId: caseData.caseId, decision: decision.value, reasonCode: reason.value.trim(), notes: notes.value.trim() || undefined };
    const fail = message => { err.textContent = message; err.hidden = false; };
    if (!/^[A-Z0-9_]{2,64}$/.test(payload.reasonCode)) return fail('Enter a reason code.');
    if (payload.decision === 'approved') {
      const at = Date.parse(checkedAt.value);
      if (!sourceUrl.value.startsWith('https://')) return fail('Enter the HTTPS page you checked on the official registry.');
      if (!Number.isFinite(at)) return fail('Enter when you checked the registry.');
      if (status.value !== 'ACTIVE') return fail('Only an Active registration can be approved.');
      if (checks.some(c => !c.input.checked)) return fail('Confirm every field matches the register before approving.');
      payload.review = {
        sourceUrl: sourceUrl.value.trim(), checkedAt: new Date(at).toISOString(),
        registrationNumberMatched: true, nameMatched: true, councilMatched: true, qualificationMatched: true, officialStatus: 'ACTIVE',
      };
    }
    submit.disabled = true;
    try {
      await invoke('recordVerificationDecision', payload);
      toast(`Decision recorded: ${humanize(payload.decision)}.`);
      onDone();
    } catch (error) {
      fail(errorMessage(error));
      submit.disabled = false;
    }
  });
  return form;
}

/**
 * Opens a case for review. Loading it is audited and needs a recent sign-in.
 * `entry` is the queue row (SLA, flags, assignee) when opened from a queue.
 */
export async function openCase(caseId, { entry = null, onChange = () => {} } = {}) {
  const modal = openModal({ title: 'Verification case', subtitle: caseId, wide: true });
  add(modal.body, loading('Opening case…'));
  let details;
  try {
    details = await invoke('getVerificationCaseDetails', { caseId });
  } catch (error) {
    put(modal.body, h('div', { class: 'alert alert-error' }, errorMessage(error)));
    return;
  }
  const c = details.case;
  const s = details.subject || {};
  const uid = session.user.uid;
  const isOrg = c.subjectType === 'organization';
  const done = () => { modal.close(); onChange(); };
  const closed = !['submitted', 'under_review', 'needs_information'].includes(c.status);

  const act = async (fn, message) => {
    try { await fn(); toast(message); done(); } catch (error) { toastError(error); }
  };
  const headerActions = h('div', { class: 'btn-row' });
  if (!closed && roles.verifier()) {
    if (c.assigneeId === uid) {
      add(headerActions, h('button', { class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: () => act(() => invoke('releaseVerificationCase', { caseId }), 'Case released.') }, 'Release'));
    } else if (!c.assigneeId || roles.superAdmin()) {
      add(headerActions, h('button', { class: 'btn btn-primary btn-sm', type: 'button',
        onclick: () => act(() => invoke('claimVerificationCase', { caseId }), 'Case assigned to you.') }, c.assigneeId ? 'Reassign to me' : 'Claim'));
    }
    if (!c.escalated) {
      add(headerActions, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: async () => {
        const result = await actionDialog({
          title: 'Escalate for senior review',
          message: 'A super admin will need to decide this case. Say what made it doubtful.',
          confirmLabel: 'Escalate', reasonPlaceholder: 'e.g. NAME_MISMATCH',
          onConfirm: v => invoke('escalateVerificationCase', { caseId, ...v }),
        });
        if (result) { toast('Case escalated.'); done(); }
      } }, icon('flame', 'icon-sm'), 'Escalate'));
    }
  }

  const status = h('div', { class: 'badges' },
    badge(c.status),
    c.escalated ? badge('overdue', `Escalated · ${c.escalationReason || ''}`) : null,
    entry ? slaBadge(entry) : null,
    c.assigneeId ? badge('ink', c.assigneeId === uid ? 'Assigned to you' : `Assigned · ${entry?.assigneeName || 'staff'}`) : badge(null, 'Unassigned'));

  const evidence = details.documents?.length
    ? h('div', {}, details.documents.map(doc => h('div', { class: 'evidence' },
      h('div', { class: 'btn-row' }, icon('file'), h('div', {},
        h('div', { class: 'cell-main mono' }, doc.documentId.slice(0, 16)),
        h('div', { class: 'cell-sub' }, `${doc.contentType || 'document'} · ${Math.round((doc.sizeBytes || 0) / 1024)} KB`))),
      h('div', { class: 'btn-row' }, badge(doc.scanStatus),
        doc.scanStatus === 'clean' ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: async () => {
          try {
            const r = await invoke('getEvidenceReadUrl', { documentId: doc.documentId });
            window.open(r.signedUrl, '_blank', 'noopener,noreferrer');
          } catch (error) { toastError(error); }
        } }, 'Open', icon('external', 'icon-sm')) : null))))
    : empty('No documents uploaded', session.testingModeNotice
      ? 'Documents are optional while testing mode is on; approve on the registry check.'
      : 'The applicant has not uploaded evidence for this case.', 'file');

  put(modal.body, 
    h('div', { class: 'page-head' }, status, headerActions),
    details.isStale ? h('div', { class: 'alert alert-warn' }, 'The profile changed after this case was opened, so it cannot be approved. Ask the applicant to submit the current profile.') : null,
    c.escalated && c.escalationNotes ? h('div', { class: 'alert alert-info' }, `Escalation note: ${c.escalationNotes}`) : null,
    h('h4', {}, isOrg ? 'Hospital' : 'Doctor'),
    dl(isOrg ? [
      ['Legal name', s.legalName], ['Registration no.', s.registrationNumber], ['Type', humanize(s.organizationType)],
      ['Profile revision', `r${s.profileRevision ?? 1}`],
    ] : [
      ['Name', s.fullName], ['Council', s.council], ['Registration no.', s.registrationNo], ['Qualification', s.qualification],
      ['Primary specialty', s.primarySpecialty], ['Experience', s.yearsOfExperience != null ? `${s.yearsOfExperience} years` : null],
      ['Profile revision', `r${s.profileRevision ?? 1}`],
    ]),
    h('h4', {}, 'Case'),
    dl([['Submitted', fmtDateTime(tsToIso(c.submittedAt))], ['Opened', fmtDateTime(tsToIso(c.createdAt))],
      ['Previous case', c.previousCaseId], ['Policy', c.policyVersion]]),
    c.appeal ? h('div', { class: 'alert alert-info section-gap' },
      `Appeal ${humanize(c.appeal.status)}: ${c.appeal.statement || ''}`) : null,
    c.appealOf ? h('div', { class: 'alert alert-info section-gap' }, `Reopened after an appeal of case ${c.appealOf}.`) : null,
    h('h4', {}, 'Evidence'), evidence,
    closed ? h('div', { class: 'alert alert-info section-gap' }, `This case is ${humanize(c.status)}. Decisions are final; a new review starts a new case.`)
      : roles.verifier() ? [h('h4', {}, 'Decision'), decisionForm(c, details, { onDone: done })] : null);
}

// ── Appeals ───────────────────────────────────────────────

/**
 * Pending appeals of rejected cases. A different verifier from the one who
 * rejected decides; an overturned appeal reopens review in a new case.
 */
export async function renderAppeals(root, ctx) {
  const { appeals } = await invoke('listVerificationAppeals');
  const decide = async (a, outcome) => {
    const overturn = outcome === 'overturned';
    const result = await actionDialog({
      title: overturn ? `Overturn the rejection of ${a.subjectName || 'this applicant'}?` : 'Uphold the original rejection?',
      message: overturn
        ? 'A new case opens with the documents already submitted and goes back through normal review.'
        : 'The rejection stands. The applicant can still submit a new verification.',
      confirmLabel: overturn ? 'Overturn' : 'Uphold', danger: !overturn,
      reasonPlaceholder: overturn ? 'e.g. EVIDENCE_MISREAD' : 'e.g. DECISION_CORRECT',
      onConfirm: v => invoke('decideVerificationAppeal', { caseId: a.caseId, outcome, ...v }),
    });
    if (result) { toast(overturn ? 'Appeal accepted; case reopened.' : 'Rejection upheld.'); ctx.refreshCounts(); ctx.rerender(); }
  };
  add(root,
    pageHead('Appeals', 'Applicants contesting a rejection. You cannot decide an appeal of your own decision.',
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => ctx.rerender() }, icon('refresh'), 'Refresh')),
    card(null, null, table([
      { label: 'Applicant', render: a => cellMain(a.subjectName || 'Unnamed', humanize(a.subjectType)) },
      { label: 'Rejected', render: a => cellMain(fmtRelative(a.rejectedAt), a.decisionReason || '') },
      { label: 'Appeal', render: a => h('div', { class: 'cell-sub', style: 'max-width:420px;white-space:normal' }, a.statement) },
      { label: 'Submitted', render: a => cellMain(fmtRelative(a.submittedAt), fmtDate(a.submittedAt)) },
      { label: '', render: a => (a.canDecide
        ? h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: e => { e.stopPropagation(); openCase(a.caseId); } }, 'Case'),
          h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: e => { e.stopPropagation(); decide(a, 'upheld'); } }, 'Uphold'),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: e => { e.stopPropagation(); decide(a, 'overturned'); } }, 'Overturn'))
        : badge(null, 'You rejected this')) },
    ], appeals, { emptyTitle: 'No pending appeals', emptyDetail: 'Appeals of rejected cases appear here.' })));
}

// ── Credential renewals ───────────────────────────────────

export async function renderRenewals(root, ctx) {
  const { policy, doctors } = await invoke('listRenewalsDue');
  add(root, 
    pageHead('Credential Renewals', `Doctors verified more than ${policy.reverifyAfterMonths} months ago. Change the interval in Master Config.`),
    h('div', { class: 'alert alert-info' },
      'Registration expiry dates are not captured yet, so renewals follow the re-verification interval. A reminder asks the doctor, in the app and by push, to confirm their registration is current. Doctors can be reminded once every 7 days.'),
    card(null, null, table([
      { label: 'Doctor', render: d => cellMain(d.fullName || d.doctorId, d.doctorId) },
      { label: 'Registration', render: d => cellMain(d.registrationNo || '—', d.council) },
      { label: 'Verified', render: d => cellMain(fmtDate(d.verifiedAt), fmtRelative(d.verifiedAt)) },
      { label: 'Last reminder', render: d => (d.renewalReminderAt ? fmtRelative(d.renewalReminderAt) : h('span', { class: 'faint' }, 'Never')) },
      { label: '', render: d => (roles.verifier() ? h('button', {
        class: 'btn btn-secondary btn-sm', type: 'button', disabled: !d.canRemind, title: d.canRemind ? '' : 'Reminded in the last 7 days',
        onclick: async () => {
          const ok = await actionDialog({
            title: `Send renewal reminder to ${d.fullName || 'this doctor'}?`, reason: false,
            message: 'They will get an in-app notification and a push asking them to confirm their registration.',
            confirmLabel: 'Send reminder',
            onConfirm: v => invoke('sendRenewalReminder', { doctorId: d.doctorId, notes: v.notes }),
          });
          if (ok) { toast('Reminder queued.'); ctx.rerender(); }
        },
      }, icon('send', 'icon-sm'), 'Remind') : null) },
    ], doctors, { emptyTitle: 'No renewals due', emptyDetail: 'Every verified doctor is within the re-verification interval.' })));
}
