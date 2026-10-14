import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, EmailAuthProvider, onAuthStateChanged,
  reauthenticateWithCredential, signOut,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';

// A bare username maps to an internal Firebase email/password account.
// Must match scripts/set-admin-login.mjs.
const ADMIN_LOGIN_DOMAIN = 'admin.doctor-c7c29.web.app';
const toLoginEmail = username =>
  (username.includes('@') ? username : `${username}@${ADMIN_LOGIN_DOMAIN}`).toLowerCase();

// The portal accepts only email/password sessions holding a staff claim.
const isStaff = claims => Boolean(claims.isVerifier || claims.isSupportAdmin || claims.isSuperAdmin);
const hasPortalAccess = token => token.signInProvider === 'password' && isStaff(token.claims);

// Which parts of the portal each claim opens. The server enforces the same rules.
let claims = {};
const ACCESS = {
  staff:    () => isStaff(claims),
  verifier: () => Boolean(claims.isVerifier || claims.isSuperAdmin),
  admin:    () => Boolean(claims.isSupportAdmin || claims.isSuperAdmin),
};
const roleLabel = () =>
  claims.isSuperAdmin ? 'Super Admin' : claims.isSupportAdmin ? 'Support Admin' : 'Credential Verifier';

const SIGN_IN_ERRORS = {
  'auth/invalid-credential':     'Invalid username or password.',
  'auth/invalid-email':          'Invalid username or password.',
  'auth/user-disabled':          'This account has been disabled.',
  'auth/too-many-requests':      'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/operation-not-allowed':  'Email/password sign-in is not enabled for this project.',
};
const signInMessage = err => SIGN_IN_ERRORS[err.code] || 'Sign-in failed. Please try again.';

// ── Safe DOM helpers (no innerHTML with user data) ─────────
const el    = id           => document.getElementById(id);
const mk    = (tag, cls)   => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
const span  = (cls, text)  => { const n = mk('span', cls); n.textContent = text; return n; };
const div   = (cls, text)  => { const n = mk('div',  cls); if (text !== undefined) n.textContent = text; return n; };
const setTxt = (id, text)  => { el(id).textContent = text; };
const setStatus = msg      => setTxt('status', msg);

// Whitelist untrusted strings used as CSS class suffixes
const SAFE_CASE_STATUSES = new Set(['submitted','under_review','needs_information','approved','rejected']);
const SAFE_SCAN_STATUSES = new Set(['clean','pending','infected','rejected']);
const SAFE_AUDIT_RESULTS = new Set(['SUCCESS','FAILED','DENIED']);
const safeClass = (whitelist, value, fallback = '') =>
  whitelist.has(value) ? value : fallback;

let auth, functions, currentCase, currentDetails, _booted = false;

const invoke = async (name, data = {}) =>
  (await httpsCallable(functions, name)(data)).data;

// Sensitive callables demand auth_time within 10 minutes; re-prompt after 8.
async function ensureRecentSignIn() {
  if (!auth.currentUser) throw new Error('Your session has ended. Sign in again.');
  const token   = await auth.currentUser.getIdTokenResult();
  const authAge = Date.now() - Date.parse(token.authTime);
  if (!Number.isFinite(authAge) || authAge > 8 * 60 * 1000) {
    await promptReauth();
  }
}

let pendingReauth = null;

/** Resolves once the password is re-confirmed; rejects if the dialog is cancelled. */
function promptReauth() {
  if (pendingReauth) return pendingReauth.promise;
  pendingReauth = {};
  pendingReauth.promise = new Promise((resolve, reject) => {
    pendingReauth.resolve = resolve;
    pendingReauth.reject  = reject;
  });
  el('reauth-form').reset();
  showReauthErr('');
  el('reauth-submit').disabled = false;
  el('reauth-modal').classList.remove('hidden');
  el('reauth-password').focus();
  return pendingReauth.promise;
}

function closeReauth(error) {
  el('reauth-modal').classList.add('hidden');
  el('reauth-form').reset();
  const pending = pendingReauth;
  pendingReauth = null;
  if (!pending) return;
  if (error) pending.reject(error); else pending.resolve();
}

function showReauthErr(msg) {
  const box = el('reauth-status');
  box.textContent = msg;
  box.hidden      = !msg;
}

async function submitReauth(event) {
  event.preventDefault();
  const password = el('reauth-password').value;
  if (!password) { showReauthErr('Enter your password.'); return; }
  const btn = el('reauth-submit');
  btn.disabled = true;
  try {
    const user = auth.currentUser;
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    closeReauth();
  } catch (err) {
    showReauthErr(err.code === 'auth/invalid-credential' ? 'Incorrect password.' : signInMessage(err));
    btn.disabled = false;
  }
}

const toDate = ts => (ts && ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts));

function fmtDate(ts) {
  if (!ts) return '—';
  const d = toDate(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = toDate(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const fmtCount = n => (Number.isFinite(n) ? n.toLocaleString('en-IN') : '—');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function fillDetails(gridId, fields) {
  const grid = el(gridId);
  grid.replaceChildren();
  for (const [label, value] of fields) {
    const card = mk('div', 'detail-item');
    card.append(div('label', label), div('value', value ?? '—'));
    grid.append(card);
  }
}

function td(...children) {
  const cell = mk('td');
  cell.append(...children);
  return cell;
}

// ── Views & Navigation ────────────────────────────────────
const VIEWS = {
  dashboard: {
    section: 'view-dashboard', title: 'Dashboard',
    subtitle: 'Live platform totals and work waiting for review',
    load: () => loadDashboard(),
  },
  doctors: {
    section: 'view-verification', title: 'Doctor Verification',
    subtitle: 'Review submitted doctor credentials against official registries',
    load: () => loadQueue('doctors', 'doctor'),
  },
  hospitals: {
    section: 'view-verification', title: 'Hospital Verification',
    subtitle: 'Review hospital registrations against official records',
    load: () => loadQueue('hospitals', 'organization'),
  },
  moderation: {
    section: 'view-moderation', title: 'Duty Moderation',
    subtitle: 'Act on duties and users reported by the community',
    load: () => loadReports(),
  },
  audit: {
    section: 'view-audit', title: 'Audit & Compliance',
    subtitle: 'Immutable record of every privileged action',
    load: () => loadAudit(),
  },
  config: {
    section: 'view-config', title: 'Master Config',
    subtitle: 'Platform settings and feature flags',
    load: () => loadConfig(),
  },
};
const VIEW_ACCESS = {
  dashboard: 'staff', doctors: 'verifier', hospitals: 'verifier', moderation: 'admin', audit: 'admin', config: 'admin',
};

let currentView = null;
const canOpen = name => Boolean(VIEWS[name]) && ACCESS[VIEW_ACCESS[name]]();

function applyAccess() {
  document.querySelectorAll('[data-access]').forEach(node => {
    node.hidden = !ACCESS[node.dataset.access]();
  });
}

async function showView(name) {
  if (!canOpen(name)) return;
  const view = VIEWS[name];
  currentView = name;
  document.querySelectorAll('.nav-item[data-view]').forEach(item =>
    item.classList.toggle('active', item.dataset.view === name));
  document.querySelectorAll('.view').forEach(section => { section.hidden = section.id !== view.section; });
  setTxt('page-title', view.title);
  setTxt('page-subtitle', view.subtitle);
  setStatus('');
  await view.load();
}

const reloadView = () => (currentView ? VIEWS[currentView].load() : Promise.resolve())
  .catch(e => setStatus(e.message));

// ── Dashboard ─────────────────────────────────────────────
async function loadDashboard() {
  setStatus('Loading dashboard…');
  const d = await invoke('getAdminDashboard');
  if (currentView !== 'dashboard') return;

  setTxt('dash-doctor-cases', fmtCount(d.pending.doctorCases));
  setTxt('dash-org-cases',    fmtCount(d.pending.organizationCases));
  setTxt('dash-reports',      fmtCount(d.pending.openReports));
  setTxt('doctor-badge',      d.pending.doctorCases);
  setTxt('hospital-badge',    d.pending.organizationCases);
  setTxt('report-badge',      d.pending.openReports);

  setTxt('dash-doctors',      fmtCount(d.doctors.total));
  setTxt('dash-doctors-sub',  `${fmtCount(d.doctors.verified)} verified`);
  setTxt('dash-orgs',         fmtCount(d.organizations.total));
  setTxt('dash-orgs-sub',     `${fmtCount(d.organizations.approved)} approved`);
  setTxt('dash-duties',       fmtCount(d.duties.published));
  setTxt('dash-duties-sub',   `${fmtCount(d.duties.filled)} filled`);
  setTxt('dash-applications', fmtCount(d.applications.total));
  setTxt('dash-assignments-sub', `${fmtCount(d.assignments.open)} assignments in progress`);
  setTxt('dash-generated',    `Updated ${fmtDateTime(d.generatedAt)}`);
  setStatus('');
}

// ── Verification Queue ────────────────────────────────────
// Doctor and hospital cases arrive in one queue; each tab shows its own type.
async function loadQueue(viewName, subjectType) {
  setStatus('Refreshing queue…');
  const { cases: allCases = [] } = await invoke('getVerificationQueue');
  if (currentView !== viewName) return;

  const ofType = type => allCases.filter(c => (c.subjectType || 'doctor') === type);
  setTxt('doctor-badge',   ofType('doctor').length);
  setTxt('hospital-badge', ofType('organization').length);

  const cases = ofType(subjectType);
  const by = s => cases.filter(c => c.status === s).length;
  setTxt('count-pending',  by('submitted'));
  setTxt('count-inreview', by('under_review'));
  setTxt('count-info',     by('needs_information'));
  setTxt('count-total',    cases.length);
  setTxt('table-count',    plural(cases.length, 'case'));

  const tbody = el('case-list');
  tbody.replaceChildren();

  if (!cases.length) {
    el('cases-table').hidden = true;
    el('empty-queue').hidden = false;
    setStatus('Queue is clear.');
    return;
  }
  el('cases-table').hidden = false;
  el('empty-queue').hidden = true;

  for (const record of cases) {
    const statusKey = safeClass(SAFE_CASE_STATUSES, record.status);

    const tdId = td();
    tdId.className = 'case-id-cell';
    tdId.textContent = (record.caseId || '').slice(0, 14) + '…';

    const tdDate = td();
    tdDate.style.color = 'var(--text-secondary)';
    tdDate.textContent = fmtDate(record.createdAt);

    const btn = mk('button', 'btn-action');
    btn.textContent = 'Review';
    btn.addEventListener('click', () =>
      openCase(record.caseId).catch(e => setStatus(e.message))
    );

    const tr = mk('tr');
    tr.append(
      td(div('subject-name', record.subjectName || 'Unknown'),
         div('subject-id', (record.subjectId || record.caseId || '').slice(0, 18))),
      td(span('type-badge', subjectType === 'organization' ? 'hospital' : 'doctor')),
      tdId,
      tdDate,
      td(span(`status-badge ${statusKey}`, (record.status || '').replace(/_/g, ' '))),
      td(btn),
    );
    tbody.append(tr);
  }
  setStatus(`${plural(cases.length, 'case')} in queue.`);
}

// ── Duty Moderation ───────────────────────────────────────
const MODERATION_ACTIONS = {
  duty: [
    ['hide_duty', 'Hide duty', 'Pauses the listing so doctors can no longer see or apply to it.'],
    ['dismiss',   'Dismiss report', 'Closes the report with no change to the duty.'],
  ],
  user: [
    ['warn_user',    'Record warning', 'Records a warning on the audit trail. The user is not notified automatically.'],
    ['suspend_user', 'Suspend account', 'Blocks every platform action and signs the user out of all devices.'],
    ['dismiss',      'Dismiss report', 'Closes the report with no change to the account.'],
  ],
};
let currentReport = null;

async function loadReports() {
  setStatus('Loading reports…');
  const { moderationQueue: reports = [] } = await invoke('getAdminQueues');
  if (currentView !== 'moderation') return;

  setTxt('report-badge', reports.length);
  setTxt('report-count', plural(reports.length, 'report'));
  const tbody = el('report-list');
  tbody.replaceChildren();
  el('reports-table').hidden = !reports.length;
  el('empty-reports').hidden = Boolean(reports.length);

  for (const report of reports) {
    const actionable = Boolean(MODERATION_ACTIONS[report.targetType]);
    const btn = mk('button', 'btn-action');
    btn.textContent = 'Resolve';
    btn.disabled = !actionable;
    btn.title = actionable ? '' : 'Unknown target type';
    btn.addEventListener('click', () => openReport(report));

    const tdDate = td();
    tdDate.style.color = 'var(--text-secondary)';
    tdDate.textContent = fmtDate(report.createdAt);

    const tr = mk('tr');
    tr.append(
      td(div('subject-id', report.targetId || '—')),
      td(span('type-badge', report.targetType || 'unknown')),
      td(div('', report.reason || report.reasonCode || report.category || '—')),
      td(div('subject-id', report.reporterId || '—')),
      tdDate,
      td(btn),
    );
    tbody.append(tr);
  }
  setStatus(reports.length ? `${plural(reports.length, 'open report')}.` : 'No open reports.');
}

function openReport(report) {
  currentReport = report;
  setTxt('moderation-title',    report.targetType === 'duty' ? 'Reported Duty' : 'Reported User');
  setTxt('moderation-subtitle', `Report · ${report.reportId}`);
  fillDetails('moderation-details', [
    ['Target',      report.targetId],
    ['Target Type', report.targetType],
    ['Reason',      report.reason || report.reasonCode || report.category],
    ['Reported By', report.reporterId],
    ['Reported',    fmtDateTime(report.createdAt)],
    ['Details',     report.details || report.description || report.notes],
  ]);

  const select = el('moderation-action');
  select.replaceChildren();
  for (const [value, label] of MODERATION_ACTIONS[report.targetType]) {
    const option = mk('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  el('moderation-form').reset();
  updateModerationHint();
  el('moderation-submit').disabled = false;
  el('moderation-modal').classList.remove('hidden');
}

function updateModerationHint() {
  if (!currentReport) return;
  const chosen = MODERATION_ACTIONS[currentReport.targetType]
    .find(([value]) => value === el('moderation-action').value);
  setTxt('moderation-hint', chosen ? chosen[2] : '');
}

function hideReport() {
  el('moderation-modal').classList.add('hidden');
  currentReport = null;
}

async function submitModeration(event) {
  event.preventDefault();
  if (!currentReport) return;
  const action = el('moderation-action').value;
  const label  = el('moderation-action').selectedOptions[0]?.textContent || action;
  const payload = {
    reportId:   currentReport.reportId,
    action,
    reasonCode: el('moderation-reason').value.trim(),
    notes:      el('moderation-notes').value.trim() || undefined,
  };
  if (payload.reasonCode.length < 2) { setStatus('Enter a reason code.'); return; }
  if (!window.confirm(`${label} for ${currentReport.targetType} ${currentReport.targetId}?`)) return;

  const btn = el('moderation-submit');
  btn.disabled = true;
  try {
    await ensureRecentSignIn();
    setStatus('Applying action…');
    await invoke('submitModerationAction', payload);
    hideReport();
    await reloadView();
    setStatus('Action applied and recorded in the audit trail.');
  } catch (e) {
    setStatus(e.message);
    btn.disabled = false;
  }
}

// ── Audit & Compliance ────────────────────────────────────
let auditFilter = {};
let auditCursor = null;

async function loadAudit(append = false) {
  setStatus('Loading audit trail…');
  const query = { ...auditFilter, limit: 25 };
  if (append && auditCursor) query.cursor = auditCursor;
  const { entries = [], nextCursor = null } = await invoke('getAuditLogs', query);
  if (currentView !== 'audit') return;

  const tbody = el('audit-list');
  if (!append) tbody.replaceChildren();
  auditCursor = nextCursor;
  el('audit-more').hidden = !nextCursor;

  for (const entry of entries) {
    const resultKey = safeClass(SAFE_AUDIT_RESULTS, entry.result);
    const tr = mk('tr');
    tr.append(
      td(div('mono', fmtDateTime(entry.createdAt))),
      td(div('mono', entry.action || '—')),
      td(div('', entry.actorRole || '—'), div('cell-sub mono', entry.actorId || '')),
      td(div('', entry.targetType || '—'), div('cell-sub mono', entry.targetId || '')),
      td(span(`result-badge ${resultKey}`, entry.result || '—')),
    );
    tr.addEventListener('click', () => openAuditEntry(entry));
    tbody.append(tr);
  }

  const shown = tbody.children.length;
  el('audit-table').hidden = !shown;
  el('empty-audit').hidden = Boolean(shown);
  setTxt('audit-count', `${shown}${nextCursor ? '+' : ''} ${shown === 1 ? 'entry' : 'entries'}`);
  setStatus('');
}

function applyAuditFilter(event) {
  event.preventDefault();
  const field = el('audit-filter-field').value;
  const value = el('audit-filter-value').value.trim();
  if (field && !value) { setStatus('Enter a value to filter by.'); return; }
  auditFilter = field ? { [field]: field === 'action' ? value.toUpperCase() : value } : {};
  auditCursor = null;
  loadAudit().catch(e => setStatus(e.message));
}

function openAuditEntry(entry) {
  setTxt('audit-title', entry.action || 'Audit Entry');
  setTxt('audit-subtitle', `Entry · ${entry.auditId}`);
  fillDetails('audit-details', [
    ['Time',           fmtDateTime(entry.createdAt)],
    ['Result',         entry.result],
    ['Actor',          `${entry.actorRole || '—'} · ${entry.actorId || '—'}`],
    ['Target',         `${entry.targetType || '—'} · ${entry.targetId || '—'}`],
    ['Reason Code',    entry.reasonCode],
    ['Correlation ID', entry.correlationId],
  ]);
  setTxt('audit-before', entry.beforeSummary ? JSON.stringify(entry.beforeSummary, null, 2) : '—');
  setTxt('audit-after',  entry.afterSummary  ? JSON.stringify(entry.afterSummary,  null, 2) : '—');
  el('audit-modal').classList.remove('hidden');
}

// ── Master Config ─────────────────────────────────────────
const FLAG_LABELS = {
  phase2_availability_enabled: 'Doctor availability rules',
  phase2_replacement_enabled:  'Duty replacement requests',
  phase2_disputes_enabled:     'Assignment disputes',
};
let configCanEdit = false;

const versionMeta = item => (item.version
  ? `v${item.version} · updated ${fmtDateTime(item.updatedAt)}`
  : 'Default (never changed)');

async function loadConfig() {
  setStatus('Loading configuration…');
  const config = await invoke('getPlatformConfig');
  if (currentView !== 'config') return;

  configCanEdit = Boolean(config.canEdit);
  el('config-readonly').hidden = configCanEdit;

  const { offerPolicy } = config;
  const hours = el('offer-hours');
  hours.value    = offerPolicy.offerExpiryHours;
  hours.min      = offerPolicy.range.min;
  hours.max      = offerPolicy.range.max;
  hours.disabled = !configCanEdit;
  el('offer-save').disabled = !configCanEdit;
  setTxt('offer-hint', `How long a doctor has to confirm a selection. Allowed ${offerPolicy.range.min}–${offerPolicy.range.max} hours.`);
  setTxt('offer-meta', versionMeta(offerPolicy));

  const list = el('flag-list');
  list.replaceChildren();
  for (const flag of config.featureFlags) {
    const info = mk('div');
    info.append(div('flag-name', FLAG_LABELS[flag.key] || flag.key), div('flag-key', `${flag.key} · ${versionMeta(flag)}`));

    const toggle = mk('label', 'switch');
    const input  = mk('input');
    input.type     = 'checkbox';
    input.checked  = flag.enabled;
    input.disabled = !configCanEdit;
    input.setAttribute('aria-label', FLAG_LABELS[flag.key] || flag.key);
    input.addEventListener('change', () => toggleFlag(flag.key, input));
    toggle.append(input, mk('span', 'track'));

    const row = mk('div', 'flag-row');
    row.append(info, toggle);
    list.append(row);
  }

  const { fixed } = config;
  fillDetails('fixed-settings', [
    ['Re-authentication window', `${fixed.stepUpAuthMaxAgeSeconds / 60} minutes`],
    ['Max evidence file size',   `${fixed.maxEvidenceFileSizeBytes / (1024 * 1024)} MB`],
    ['Evidence link lifetime',   `${fixed.signedUrlExpirySeconds / 60} minutes`],
    ['Consent version',          fixed.consentVersion],
  ]);
  setStatus('');
}

async function saveOfferPolicy(event) {
  event.preventDefault();
  if (!configCanEdit) return;
  const input = el('offer-hours');
  const offerExpiryHours = Number(input.value);
  if (!Number.isInteger(offerExpiryHours) || offerExpiryHours < Number(input.min) || offerExpiryHours > Number(input.max)) {
    setStatus(`Offer expiry must be a whole number from ${input.min} to ${input.max}.`);
    return;
  }
  if (!window.confirm(`Set offer expiry to ${offerExpiryHours} hours? New offers will use this immediately.`)) return;

  const btn = el('offer-save');
  btn.disabled = true;
  try {
    await ensureRecentSignIn();
    setStatus('Saving…');
    await invoke('updatePlatformConfig', { configKey: 'offer_policy', configValue: { offerExpiryHours } });
    await reloadView();
    setStatus('Offer policy saved and recorded in the audit trail.');
  } catch (e) {
    setStatus(e.message);
  } finally {
    btn.disabled = !configCanEdit;
  }
}

async function toggleFlag(flagKey, input) {
  const enabled = input.checked;
  const label   = FLAG_LABELS[flagKey] || flagKey;
  if (!window.confirm(`${enabled ? 'Enable' : 'Disable'} "${label}" for every user?`)) {
    input.checked = !enabled;
    return;
  }
  input.disabled = true;
  try {
    await ensureRecentSignIn();
    setStatus('Saving…');
    await invoke('setFeatureFlag', { flagKey, enabled });
    await reloadView();
    setStatus(`"${label}" ${enabled ? 'enabled' : 'disabled'} and recorded in the audit trail.`);
  } catch (e) {
    input.checked  = !enabled;
    input.disabled = !configCanEdit;
    setStatus(e.message);
  }
}

// ── Case Modal ────────────────────────────────────────────
async function openCase(caseId) {
  setStatus('Loading case…');
  await ensureRecentSignIn();
  const details  = await invoke('getVerificationCaseDetails', { caseId });
  currentCase    = details.case;
  currentDetails = details;

  setTxt('modal-title',    currentCase.subjectType === 'organization' ? 'Hospital Verification' : 'Doctor Verification');
  setTxt('modal-subtitle', `Case · ${currentCase.caseId}`);

  // Subject detail grid — all text content, no innerHTML
  fillDetails('modal-details', [
    ['Name',             details.subject?.fullName || details.subject?.legalName],
    ['Council',          details.subject?.council],
    ['Registration No.', details.subject?.registrationNo || details.subject?.registrationNumber],
    ['Organization Type', details.subject?.organizationType],
    ['Qualification',    details.subject?.qualification],
    ['Primary Specialty', details.subject?.primarySpecialty],
    ['Experience (yrs)', details.subject?.yearsOfExperience],
    ['Subject ID',       currentCase.subjectId],
    ['Status',           currentCase.status],
    // A stale case reviews an older profile revision; the server refuses to decide it.
    ['Profile Revision', details.isStale
      ? `STALE — case reviews r${currentCase.subjectRevision ?? 1}, profile is r${details.subject?.profileRevision ?? '?'}`
      : `r${details.subject?.profileRevision ?? 1}`],
  ]);

  // Evidence list — all safe DOM methods
  const evEl = el('modal-evidence');
  evEl.replaceChildren();
  const docs = details.documents || [];

  if (!docs.length) {
    const p = mk('p');
    p.textContent = 'No documents indexed yet.';
    p.style.color    = 'var(--text-muted)';
    p.style.fontSize = '13px';
    evEl.append(p);
  } else {
    const list = mk('div', 'evidence-list');
    for (const doc of docs) {
      const scanKey = safeClass(SAFE_SCAN_STATUSES, doc.scanStatus, 'pending');

      const evInfo = mk('div', 'evidence-info');
      const icon   = mk('div', 'evidence-icon');
      icon.textContent = '📄';
      const meta   = mk('div', 'evidence-meta');
      meta.append(div('doc-id', doc.documentId), div('doc-type', doc.contentType || 'document'));
      evInfo.append(icon, meta);

      const evActions = mk('div', 'evidence-actions');
      evActions.append(span(`scan-badge ${scanKey}`, scanKey));

      if (doc.scanStatus === 'clean') {
        const inspectBtn = mk('button', 'btn-inspect');
        inspectBtn.textContent = 'Inspect ↗';
        inspectBtn.addEventListener('click', async () => {
          try {
            await ensureRecentSignIn();
            const r = await invoke('getEvidenceReadUrl', { documentId: doc.documentId });
            window.open(r.signedUrl, '_blank', 'noopener,noreferrer');
          } catch (e) { setStatus(e.message); }
        });
        evActions.append(inspectBtn);
      }

      const row = mk('div', 'evidence-row');
      row.append(evInfo, evActions);
      list.append(row);
    }
    evEl.append(list);
  }

  // Reset decision form
  el('decision-form').reset();
  el('source-fields').hidden = true;
  const submitBtn = el('decision-submit');
  submitBtn.textContent = 'Record Decision';
  submitBtn.disabled    = false;

  showModal();
  setStatus('Review evidence before recording a decision.');
}

function showModal() { el('review-modal').classList.remove('hidden'); }
function hideModal()  {
  el('review-modal').classList.add('hidden');
  currentCase    = null;
  currentDetails = null;
}

// ── Decision Submission ───────────────────────────────────
async function submitDecision(event) {
  event.preventDefault();
  if (!currentCase) return;

  const decision = el('decision').value;
  const payload  = {
    caseId:     currentCase.caseId,
    decision,
    reasonCode: el('reason-code').value.trim(),
    notes:      el('notes').value.trim(),
  };

  if (decision === 'approved') {
    const checkedAt = Date.parse(el('checked-at').value);
    if (!Number.isFinite(checkedAt)) {
      setStatus('Enter when you checked the official source.');
      return;
    }
    payload.review = {
      sourceUrl:                 el('source-url').value.trim(),
      checkedAt:                 new Date(checkedAt).toISOString(),
      registrationNumberMatched: el('registration-match').checked,
      nameMatched:               el('name-match').checked,
      councilMatched:            el('council-match').checked,
      qualificationMatched:      el('qualification-match').checked,
      officialStatus:            el('official-status').value,
    };
  }

  if (!window.confirm(`Record "${decision}" for case ${currentCase.caseId}?`)) return;

  const btn       = el('decision-submit');
  btn.textContent = 'Recording…';
  btn.disabled    = true;

  try {
    setStatus('Recording decision…');
    await invoke('recordVerificationDecision', payload);
    hideModal();
    await reloadView();
    setStatus('Decision recorded with a full audit entry.');
  } catch (e) {
    setStatus(e.message);
    btn.textContent = 'Record Decision';
    btn.disabled    = false;
  }
}

// ── Auth & Boot ───────────────────────────────────────────
function showWorkspace(name, tokenClaims) {
  claims = tokenClaims || {};
  const display = name || 'Staff';
  setTxt('user-name',   display);
  setTxt('user-avatar', display[0].toUpperCase());
  setTxt('user-role',   roleLabel());
  applyAccess();
  el('login-screen').hidden = true;
  el('admin-shell').hidden  = false;
  showView('dashboard').catch(e => setStatus(e.message));
}

function showLogin(msg = '') {
  closeReauth(new Error('Signed out.'));
  hideModal();
  hideReport();
  el('audit-modal').classList.add('hidden');
  claims = {};
  currentView = null;
  el('admin-shell').hidden  = true;
  el('login-screen').hidden = false;
  el('tf-password').value   = '';
  el('btn-signin').disabled = false;
  showLoginErr(msg);
}

async function boot() {
  const local      = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const configPath = local ? '/firebase-config.json' : '/__/firebase/init.json';
  const res        = await fetch(configPath, { cache: 'no-store' });
  if (!res.ok) throw new Error('Firebase config unavailable for this portal.');
  const app = initializeApp(await res.json());
  auth      = getAuth(app);
  functions = getFunctions(app, 'asia-south1');  // must match setGlobalOptions in functions/src/index.ts
  _booted   = true;

  // Single entry point into the workspace, for fresh and persisted sessions alike.
  // Any session without portal access (e.g. an old Google session) is signed out.
  onAuthStateChanged(auth, async user => {
    if (!user) return;
    try {
      const token = await user.getIdTokenResult(true);
      if (hasPortalAccess(token)) {
        showWorkspace(user.displayName || user.email.split('@')[0], token.claims);
        return;
      }
    } catch (_) {}
    await signOut(auth).catch(() => {});
    showLogin('This account does not have admin access.');
  });
}

// ── Event Wiring ──────────────────────────────────────────
function showLoginErr(msg) {
  const box = el('login-status');
  box.textContent = msg;
  box.hidden      = !msg;
}

el('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  showLoginErr('');

  const username = el('tf-username').value.trim();
  const password = el('tf-password').value;
  if (!username || !password) {
    showLoginErr('Enter your username and password.');
    return;
  }
  if (!_booted) {
    showLoginErr('Still connecting to Firebase. Try again in a moment.');
    return;
  }

  const btn = el('btn-signin');
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, toLoginEmail(username), password);
    el('tf-password').value = '';
  } catch (err) {
    showLoginErr(signInMessage(err));
  } finally {
    btn.disabled = false;
  }
});

// Password show / hide
el('toggle-pass').addEventListener('click', () => {
  const inp  = el('tf-password');
  inp.type   = inp.type === 'password' ? 'text' : 'password';
});

el('sign-out').addEventListener('click', async () => {
  if (auth && auth.currentUser) await signOut(auth).catch(() => {});
  showLogin();
});
el('refresh').addEventListener('click', reloadView);

document.querySelectorAll('.nav-item[data-view]').forEach(item =>
  item.addEventListener('click', () => showView(item.dataset.view).catch(e => setStatus(e.message))));
document.querySelectorAll('.metric-link[data-goto]').forEach(card =>
  card.addEventListener('click', () => showView(card.dataset.goto).catch(e => setStatus(e.message))));

el('moderation-form').addEventListener('submit', submitModeration);
el('moderation-action').addEventListener('change', updateModerationHint);
el('moderation-close').addEventListener('click', hideReport);
el('moderation-cancel').addEventListener('click', hideReport);

el('audit-filter').addEventListener('submit', applyAuditFilter);
el('audit-filter-field').addEventListener('change', () => {
  const field = el('audit-filter-field').value;
  const input = el('audit-filter-value');
  input.disabled    = !field;
  input.placeholder = field === 'targetId' ? 'e.g. doctor or duty ID' : 'e.g. MODERATION_SUSPEND_USER';
  if (!field) input.value = '';
});
el('audit-more').addEventListener('click', () => loadAudit(true).catch(e => setStatus(e.message)));
el('audit-close').addEventListener('click', () => el('audit-modal').classList.add('hidden'));

el('offer-form').addEventListener('submit', saveOfferPolicy);

el('moderation-modal').addEventListener('click', e => {
  if (e.target === el('moderation-modal')) hideReport();
});
el('audit-modal').addEventListener('click', e => {
  if (e.target === el('audit-modal')) el('audit-modal').classList.add('hidden');
});

el('decision').addEventListener('change', () => {
  el('source-fields').hidden = el('decision').value !== 'approved';
});
el('decision-form').addEventListener('submit', submitDecision);
el('modal-close').addEventListener('click',  hideModal);
el('modal-cancel').addEventListener('click', hideModal);
el('review-modal').addEventListener('click', e => {
  if (e.target === el('review-modal')) hideModal();
});
el('reauth-form').addEventListener('submit', submitReauth);
el('reauth-cancel').addEventListener('click', () => closeReauth(new Error('Re-authentication cancelled.')));

boot().catch(e => showLoginErr(e.message || 'Failed to connect to Firebase.'));
