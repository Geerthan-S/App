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
const hasPortalAccess = token =>
  token.signInProvider === 'password' && Boolean(token.claims.isVerifier || token.claims.isSuperAdmin);

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

function fmtDate(ts) {
  if (!ts) return '—';
  try {
    const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
  } catch { return '—'; }
}

// ── Queue & Table ─────────────────────────────────────────
async function refreshQueue() {
  setStatus('Refreshing queue…');
  try {
    const { cases = [] } = await invoke('getVerificationQueue');

    const by = s => cases.filter(c => c.status === s).length;
    setTxt('count-pending',  by('submitted'));
    setTxt('count-inreview', by('under_review'));
    setTxt('count-info',     by('needs_information'));
    setTxt('count-total',    cases.length);
    setTxt('queue-badge',    cases.length);
    setTxt('table-count',    `${cases.length} case${cases.length === 1 ? '' : 's'}`);

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

      // Subject cell
      const tdSubject = mk('td');
      tdSubject.append(
        div('subject-name', record.subjectName || 'Unknown'),
        div('subject-id',   (record.subjectId || record.caseId || '').slice(0, 18)),
      );

      // Type cell
      const tdType = mk('td');
      tdType.append(span('type-badge', record.subjectType || 'doctor'));

      // Case ID cell
      const tdId = mk('td', 'case-id-cell');
      tdId.textContent = (record.caseId || '').slice(0, 14) + '…';

      // Date cell
      const tdDate = mk('td');
      tdDate.style.color = 'var(--text-secondary)';
      tdDate.textContent = fmtDate(record.createdAt);

      // Status cell
      const statusBadge = span(`status-badge ${statusKey}`, (record.status || '').replace(/_/g, ' '));
      const tdStatus = mk('td');
      tdStatus.append(statusBadge);

      // Action cell
      const btn = mk('button', 'btn-action');
      btn.textContent = 'Review';
      btn.addEventListener('click', () =>
        openCase(record.caseId).catch(e => setStatus(e.message))
      );
      const tdAction = mk('td');
      tdAction.append(btn);

      const tr = mk('tr');
      tr.append(tdSubject, tdType, tdId, tdDate, tdStatus, tdAction);
      tbody.append(tr);
    }
    setStatus(`${cases.length} case${cases.length === 1 ? '' : 's'} in queue.`);
  } catch (e) {
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

  setTxt('modal-title',    `${currentCase.subjectType || 'Doctor'} Verification`);
  setTxt('modal-subtitle', `Case · ${currentCase.caseId}`);

  // Subject detail grid — all text content, no innerHTML
  const grid = el('modal-details');
  grid.replaceChildren();
  const fields = [
    ['Full Name',        details.subject?.fullName || details.subject?.legalName],
    ['Council',          details.subject?.council],
    ['Registration No.', details.subject?.registrationNo || details.subject?.registrationNumber],
    ['Qualification',    details.subject?.qualification],
    ['Primary Specialty', details.subject?.primarySpecialty],
    ['Experience (yrs)', details.subject?.yearsOfExperience],
    ['Subject ID',       currentCase.subjectId],
    ['Status',           currentCase.status],
    // A stale case reviews an older profile revision; the server refuses to decide it.
    ['Profile Revision', details.isStale
      ? `STALE — case reviews r${currentCase.subjectRevision ?? 1}, profile is r${details.subject?.profileRevision ?? '?'}`
      : `r${details.subject?.profileRevision ?? 1}`],
  ];
  for (const [label, value] of fields) {
    const card = mk('div', 'detail-item');
    card.append(div('label', label), div('value', value ?? '—'));
    grid.append(card);
  }

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
    await refreshQueue();
    setStatus('Decision recorded with a full audit entry.');
  } catch (e) {
    setStatus(e.message);
    btn.textContent = 'Record Decision';
    btn.disabled    = false;
  }
}

// ── Auth & Boot ───────────────────────────────────────────
function showWorkspace(name) {
  const display = name || 'Doctor';
  setTxt('user-name',   display);
  setTxt('user-avatar', display[0].toUpperCase());
  el('login-screen').hidden = true;
  el('admin-shell').hidden  = false;
  refreshQueue().catch(e => setStatus(e.message));
}

function showLogin(msg = '') {
  closeReauth(new Error('Signed out.'));
  hideModal();
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
        showWorkspace(user.displayName || user.email.split('@')[0]);
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
el('refresh').addEventListener('click',  () => refreshQueue().catch(e => setStatus(e.message)));

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
