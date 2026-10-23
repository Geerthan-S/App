/** Doctors, Hospitals, Duties directories and Duty Moderation. */

import { h, icon, badge, fmtDate, fmtDateTime, fmtRelative, humanize, fmtNum, add, put } from '../core/dom.js';
import {
  actionDialog, card, cellMain, dl, errorMessage, loading, moreButton, openModal, pageHead, table, tabs, toast,
} from '../core/ui.js';
import { roles, invoke } from '../core/session.js';
import { openCase } from './verification.js';

/**
 * A paged list: tabs on top, table below, "Load more" while the server has more.
 * fetchPage(filter, cursor) → { rows, nextCursor }
 */
function pagedList(root, { title, subtitle, filters, initial = 'all', fetchPage, columns, onRow, emptyTitle, note }) {
  const state = { filter: initial, rows: [], cursor: null, loading: false };
  const tabBar = h('div');
  const body = h('div');

  const drawTable = () => {
    const parts = [table(columns, state.rows, { onRow, emptyTitle, emptyDetail: 'Nothing matches this filter.' })];
    if (state.cursor) parts.push(moreButton(() => load(true)));
    put(body, card(null, null, h('div', {}, parts)));
  };
  const load = async (more = false) => {
    if (state.loading) return;
    state.loading = true;
    if (!more) put(body, loading());
    try {
      const page = await fetchPage(state.filter, more ? state.cursor : null);
      state.rows = more ? [...state.rows, ...page.rows] : page.rows;
      state.cursor = page.nextCursor;
      drawTable();
    } catch (error) {
      put(body, card(null, null, h('div', { class: 'alert alert-error' }, errorMessage(error))));
    } finally {
      state.loading = false;
    }
  };
  const drawTabs = () => put(tabBar, tabs(filters, state.filter, value => {
    state.filter = value;
    drawTabs();
    load();
  }));
  drawTabs();
  add(root, pageHead(title, subtitle), note || null, tabBar, h('div', { class: 'section-gap' }), body);
  return load();
}

// ── Doctors ───────────────────────────────────────────────

export function renderDoctors(root, ctx) {
  const promise = pagedList(root, {
    title: 'Doctors', subtitle: 'Every doctor profile, its verification and account status',
    filters: [
      { value: 'all', label: 'All' }, { value: 'verified', label: 'Verified' },
      { value: 'unverified', label: 'Not verified' }, { value: 'suspended', label: 'Suspended' },
    ],
    fetchPage: async (filter, cursor) => {
      const r = await invoke('listDoctors', { filter, ...(cursor ? { cursor } : {}) });
      return { rows: r.doctors, nextCursor: r.nextCursor };
    },
    columns: [
      { label: 'Doctor', render: d => cellMain(d.fullName || 'No name yet', d.primarySpecialty || d.doctorId) },
      { label: 'Registration', render: d => cellMain(d.registrationNo || '—', d.council) },
      { label: 'Experience', render: d => (d.yearsOfExperience != null ? `${d.yearsOfExperience} yrs` : '—') },
      { label: 'Verification', render: d => badge(d.isVerified ? 'verified' : d.verificationStatus === 'unverified' ? null : d.verificationStatus,
        d.isVerified ? 'Verified' : humanize(d.verificationStatus)) },
      { label: 'Account', render: d => badge(d.accountStatus) },
      { label: 'Joined', render: d => fmtDate(d.createdAt) },
    ],
    onRow: d => openDoctor(d.doctorId, { onChange: () => ctx.rerender() }),
    emptyTitle: 'No doctors',
  });
  if (ctx.param) openDoctor(ctx.param, { onChange: () => ctx.rerender() });
  return promise;
}

function casesTable(cases) {
  return table([
    { label: 'Case', render: c => cellMain(c.caseId.slice(0, 12), `revision ${c.subjectRevision}`) },
    { label: 'Status', render: c => h('div', { class: 'badges' }, badge(c.status), c.escalated ? badge('overdue', 'Escalated') : null) },
    { label: 'Submitted', render: c => fmtDate(c.submittedAt) },
    { label: 'Decided', render: c => fmtDate(c.decidedAt) },
    { label: 'Reason', render: c => c.decisionReason || '—' },
  ], cases, {
    onRow: roles.verifier() ? c => openCase(c.caseId) : null,
    emptyTitle: 'No verification cases yet',
  });
}

function accountActions(uid, status, onDone) {
  if (!roles.admin()) return null;
  const suspended = status === 'suspended';
  return h('button', {
    class: `btn ${suspended ? 'btn-secondary' : 'btn-danger'} btn-sm`, type: 'button',
    onclick: async () => {
      const ok = await actionDialog({
        title: suspended ? 'Reinstate this account?' : 'Suspend this account?',
        message: suspended
          ? 'The person can use the platform again immediately.'
          : 'Every platform action is blocked at once and the person is signed out of all devices.',
        confirmLabel: suspended ? 'Reinstate' : 'Suspend', danger: !suspended,
        reasonPlaceholder: suspended ? 'e.g. APPEAL_UPHELD' : 'e.g. FRAUDULENT_DOCUMENTS',
        onConfirm: v => invoke('setAccountStatus', { uid, status: suspended ? 'active' : 'suspended', ...v }),
      });
      if (ok) { toast(suspended ? 'Account reinstated.' : 'Account suspended.'); onDone(); }
    },
  }, suspended ? 'Reinstate account' : 'Suspend account');
}

/** Doctor profile panel. Opening it is recorded in the audit trail. */
export async function openDoctor(doctorId, { onChange = () => {} } = {}) {
  const modal = openModal({ title: 'Doctor', subtitle: doctorId, wide: true });
  add(modal.body, loading());
  let p;
  try {
    p = await invoke('getDoctorProfile', { doctorId });
  } catch (error) {
    put(modal.body, h('div', { class: 'alert alert-error' }, errorMessage(error)));
    return;
  }
  const d = p.doctor;
  const a = p.account;
  const reopen = () => { modal.close(); onChange(); openDoctor(doctorId, { onChange }); };
  put(modal.body, 
    h('div', { class: 'page-head' },
      h('div', {}, h('h2', { class: 'page-title' }, d.fullName || 'No name yet'),
        h('div', { class: 'badges section-gap' }, badge(d.isVerified ? 'verified' : null, d.isVerified ? 'Verified' : humanize(d.verificationStatus)),
          badge(a.status), d.primarySpecialty ? badge(null, d.primarySpecialty) : null)),
      accountActions(doctorId, a.status, reopen)),
    a.status === 'suspended' ? h('div', { class: 'alert alert-error' },
      `Suspended ${fmtRelative(a.suspendedAt)} · ${humanize(a.suspensionReason)}`) : null,
    h('h4', {}, 'Profile'),
    dl([['Council', d.council], ['Registration no.', d.registrationNo], ['Qualification', d.qualification],
      ['Experience', d.yearsOfExperience != null ? `${d.yearsOfExperience} years` : null],
      ['Specialties', (d.specialties || []).join(', ')], ['Preferred cities', (d.preferredCities || []).join(', ')],
      ['Verified', d.verifiedAt ? fmtDate(d.verifiedAt) : null], ['Profile revision', `r${d.profileRevision}`],
      ['Last renewal reminder', d.renewalReminderAt ? fmtDateTime(d.renewalReminderAt) : null]]),
    d.bio ? h('p', { class: 'muted section-gap' }, d.bio) : null,
    h('h4', {}, 'Account'),
    dl([['Sign-in methods', (a.auth?.providers || []).join(', ') || null], ['Created', fmtDate(a.auth?.createdAt)],
      ['Last sign-in', fmtRelative(a.auth?.lastSignInAt)], ['Consent', a.consentVersion],
      roles.admin() ? ['Email', a.auth?.email] : null, roles.admin() ? ['Phone', a.auth?.phoneNumber] : null]),
    h('h4', {}, 'Activity'),
    dl([['Assignments', fmtNum(p.stats.totalAssignments)], ['Completed', fmtNum(p.stats.completedAssignments)],
      ['Cancelled', fmtNum(p.stats.cancelledAssignments)], ['Reports about them', fmtNum(p.stats.reportsAgainst)]]),
    h('h4', {}, 'Verification history'), casesTable(p.cases));
}

// ── Hospitals ─────────────────────────────────────────────

export function renderHospitals(root, ctx) {
  const promise = pagedList(root, {
    title: 'Hospitals', subtitle: 'Registered hospitals, clinics and nursing homes',
    filters: [
      { value: 'all', label: 'All' }, { value: 'approved', label: 'Approved' }, { value: 'submitted', label: 'Submitted' },
      { value: 'needs_information', label: 'Needs information' }, { value: 'draft', label: 'Draft' }, { value: 'rejected', label: 'Rejected' },
    ],
    fetchPage: async (filter, cursor) => {
      const r = await invoke('listOrganizations', { filter, ...(cursor ? { cursor } : {}) });
      return { rows: r.organizations, nextCursor: r.nextCursor };
    },
    columns: [
      { label: 'Hospital', render: o => cellMain(o.name || o.organizationId, o.legalName !== o.name ? o.legalName : null) },
      { label: 'Type', render: o => humanize(o.organizationType) },
      { label: 'Registration', render: o => o.registrationNumber || '—' },
      { label: 'City', render: o => o.city || '—' },
      { label: 'Verification', render: o => badge(o.verificationState) },
      { label: 'Registered', render: o => fmtDate(o.createdAt) },
    ],
    onRow: o => openOrganization(o.organizationId),
    emptyTitle: 'No hospitals',
  });
  if (ctx.param) openOrganization(ctx.param);
  return promise;
}

export async function openOrganization(organizationId) {
  const modal = openModal({ title: 'Hospital', subtitle: organizationId, wide: true });
  add(modal.body, loading());
  let p;
  try {
    p = await invoke('getOrganizationProfile', { organizationId });
  } catch (error) {
    put(modal.body, h('div', { class: 'alert alert-error' }, errorMessage(error)));
    return;
  }
  const o = p.organization;
  put(modal.body, 
    h('div', {}, h('h2', { class: 'page-title' }, o.name || o.legalName),
      h('div', { class: 'badges section-gap' }, badge(o.verificationState), badge(null, humanize(o.organizationType)))),
    h('h4', {}, 'Organization'),
    dl([['Legal name', o.legalName], ['Display name', o.displayName], ['Registration no.', o.registrationNumber],
      ['City', o.city], ['Address', o.address], ['Verified', o.verifiedAt ? fmtDate(o.verifiedAt) : null], ['Registered', fmtDate(o.createdAt)]]),
    h('h4', {}, 'Duties'),
    dl([['Published', fmtNum(p.stats.published)], ['Filled', fmtNum(p.stats.filled)], ['Completed', fmtNum(p.stats.completed)],
      ['Reports about them', fmtNum(p.stats.reportsAgainst)]]),
    h('h4', {}, `Facilities (${p.facilities.length})`),
    table([
      { label: 'Facility', render: f => cellMain(f.name, f.address) },
      { label: 'City', render: f => f.city || '—' },
      { label: 'Status', render: f => badge(f.status) },
    ], p.facilities, { emptyTitle: 'No facilities yet' }),
    h('h4', {}, `Members (${p.members.length})`),
    table([
      { label: 'User', render: m => h('span', { class: 'mono' }, m.userId) },
      { label: 'Role', render: m => humanize(m.role) },
      { label: 'Status', render: m => badge(m.status) },
      { label: 'Joined', render: m => fmtDate(m.joinedAt) },
    ], p.members, { emptyTitle: 'No members' }),
    h('h4', {}, 'Verification history'), casesTable(p.cases));
}

// ── Duties ────────────────────────────────────────────────

const money = pay => (pay ? `${pay.currency === 'INR' ? '₹' : `${pay.currency} `}${fmtNum(pay.amount)} ${pay.basis === 'per_hour' ? '/ hr' : '/ shift'}` : '—');

const dutyColumns = [
  { label: 'Duty', render: u => cellMain(u.specialtyName || 'Duty', u.department) },
  { label: 'Hospital', render: u => cellMain(u.organizationName || u.organizationId, u.facilityName) },
  { label: 'City', render: u => u.city || '—' },
  { label: 'Starts', render: u => cellMain(fmtDateTime(u.startAt), humanize(u.shiftType)) },
  { label: 'Seats', render: u => (u.headcount != null ? `${u.headcount - (u.remainingHeadcount ?? u.headcount)}/${u.headcount}` : '—') },
  { label: 'Pay', render: u => money(u.payment) },
  { label: 'Status', render: u => h('div', { class: 'badges' }, badge(u.status), u.moderationHidden ? badge('overdue', 'Hidden') : null) },
];

export function renderDuties(root, ctx) {
  const promise = pagedList(root, {
    title: 'Duties', subtitle: 'Every shift posted by hospitals',
    filters: ['all', 'published', 'filled', 'in_progress', 'completed', 'paused', 'draft', 'cancelled', 'closed']
      .map(v => ({ value: v, label: v === 'all' ? 'All' : humanize(v).replace(/^./, c => c.toUpperCase()) })),
    fetchPage: async (filter, cursor) => {
      const r = await invoke('listDuties', { filter, ...(cursor ? { cursor } : {}) });
      return { rows: r.duties, nextCursor: r.nextCursor };
    },
    columns: dutyColumns,
    onRow: u => showDuty(u, { onChange: () => ctx.rerender() }),
    emptyTitle: 'No duties',
  });
  if (ctx.param) openDuty(ctx.param, { onChange: () => ctx.rerender() });
  return promise;
}

function visibilityButton(duty, onDone) {
  if (!roles.admin()) return null;
  if (duty.moderationHidden) {
    return h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => {
      const ok = await actionDialog({
        title: 'Restore this duty?', message: 'It becomes visible to doctors again if it has not started.',
        confirmLabel: 'Restore', reasonPlaceholder: 'e.g. HOSPITAL_CORRECTED_LISTING',
        onConfirm: v => invoke('setDutyVisibility', { dutyId: duty.dutyId, visibility: 'visible', ...v }),
      });
      if (ok) { toast('Duty restored.'); onDone(); }
    } }, 'Restore duty');
  }
  if (duty.status === 'published') {
    return h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: async () => {
      const ok = await actionDialog({
        title: 'Hide this duty?', message: 'Doctors can no longer see or apply to it. Existing applications stay as they are.',
        confirmLabel: 'Hide duty', danger: true, reasonPlaceholder: 'e.g. MISLEADING_PAY',
        onConfirm: v => invoke('setDutyVisibility', { dutyId: duty.dutyId, visibility: 'hidden', ...v }),
      });
      if (ok) { toast('Duty hidden.'); onDone(); }
    } }, icon('eyeOff', 'icon-sm'), 'Hide duty');
  }
  return null;
}

function showDuty(u, { onChange = () => {} } = {}) {
  const modal = openModal({ title: u.specialtyName || 'Duty', subtitle: u.dutyId, wide: true });
  const done = () => { modal.close(); onChange(); };
  add(modal.body, 
    h('div', { class: 'page-head' },
      h('div', { class: 'badges' }, badge(u.status), u.moderationHidden ? badge('overdue', 'Hidden by moderation') : null),
      visibilityButton(u, done)),
    u.moderationHidden ? h('div', { class: 'alert alert-warn' }, `Hidden ${fmtRelative(u.hiddenAt)} · ${humanize(u.hiddenReason)}`) : null,
    dl([['Hospital', u.organizationName || u.organizationId], ['Facility', u.facilityName], ['City', u.city], ['Department', u.department],
      ['Starts', fmtDateTime(u.startAt)], ['Ends', fmtDateTime(u.endAt)], ['Shift', humanize(u.shiftType)],
      ['Seats', u.headcount != null ? `${u.remainingHeadcount ?? '?'} of ${u.headcount} open` : null], ['Pay', money(u.payment)],
      ['Posted', fmtDate(u.createdAt)]]),
    h('div', { class: 'section-gap btn-row' },
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { modal.close(); openOrganization(u.organizationId); } },
        icon('building', 'icon-sm'), 'Open hospital')));
}

/** Opens a duty by ID (from search or a link). */
export async function openDuty(dutyId, opts = {}) {
  try {
    const { duty } = await invoke('getDuty', { dutyId });
    showDuty(duty, opts);
  } catch (error) {
    toast(errorMessage(error), { error: true });
  }
}

// ── Duty moderation ───────────────────────────────────────

export async function renderDutyModeration(root, ctx) {
  const { duties } = await invoke('listDuties', { filter: 'hidden', limit: 50 });
  add(root, 
    pageHead('Duty Moderation', 'Duties hidden from doctors by moderation. Restore one once the hospital fixes it.',
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => ctx.navigate('duties') }, icon('calendar'), 'All duties')),
    h('div', { class: 'alert alert-info' }, 'Hide a duty from the Duties list, or resolve a report with "Hide duty". A duty that has already started cannot be republished.'),
    card(null, null, table([
      ...dutyColumns.slice(0, 4),
      { label: 'Hidden', render: u => cellMain(fmtRelative(u.hiddenAt), humanize(u.hiddenReason)) },
      { label: '', render: u => visibilityButton(u, () => ctx.rerender()) },
    ], duties, {
      onRow: u => showDuty(u, { onChange: () => ctx.rerender() }),
      emptyTitle: 'No hidden duties', emptyDetail: 'Nothing is hidden by moderation right now.',
    })));
}

