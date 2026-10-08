import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  reauthenticateWithPopup, signInWithPopup, signOut,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';

// ── Test credentials (remove before production) ────────────
const TEST_USERNAME = 'doctor';
const TEST_PASSWORD = '123';

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

async function ensureRecentSignIn() {
  // Skip step-up re-auth in test mode (no Google session)
  if (!auth.currentUser) return;
  const token   = await auth.currentUser.getIdTokenResult();
  const authAge = Date.now() - Date.parse(token.authTime);
  if (!Number.isFinite(authAge) || authAge > 8 * 60 * 1000) {
    await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
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
  el('admin-shell').hidden  = true;
  el('login-screen').hidden = false;
  const btn = el('btn-signin');
  btn.disabled    = false;
  btn.textContent = 'Sign In';
  showLoginErr(msg);
}

async function boot() {
  const local      = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const configPath = local ? '/firebase-config.json' : '/__/firebase/init.json';
  const res        = await fetch(configPath, { cache: 'no-store' });
  if (!res.ok) throw new Error('Firebase config unavailable for this portal.');
  const app = initializeApp(await res.json());
  auth      = getAuth(app);
  functions = getFunctions(app);
  _booted   = true;

  // If a verified Firebase session is already persisted in the browser, skip login
  onAuthStateChanged(auth, async user => {
    if (!user) return;
    try {
      const token = await user.getIdTokenResult(true);
      if (token.claims.isVerifier || token.claims.isSuperAdmin) {
        showWorkspace(user.displayName || user.email || 'Verifier');
      }
    } catch (_) {}
  });
}

// ── Event Wiring ──────────────────────────────────────────
function showLoginErr(msg) {
  const box = el('login-status');
  box.textContent = msg;
  box.hidden      = !msg;
}

// Username / password login (test credentials only for now)
el('login-form').addEventListener('submit', e => {
  e.preventDefault();
  showLoginErr('');

  const username = el('tf-username').value.trim();
  const password = el('tf-password').value;

  if (username === TEST_USERNAME && password === TEST_PASSWORD) {
    doGoogleSignIn();
  } else {
    showLoginErr('Invalid username or password.');
  }
});

// Google sign-in button
el('btn-google').addEventListener('click', () => doGoogleSignIn());

async function doGoogleSignIn() {
  const signinBtn = el('btn-signin');
  const googleBtn = el('btn-google');
  signinBtn.disabled = true;
  googleBtn.disabled = true;
  googleBtn.textContent = 'Signing in…';
  showLoginErr('');

  try {
    const cred  = await signInWithPopup(auth, new GoogleAuthProvider());
    const token = await cred.user.getIdTokenResult(true);
    if (!token.claims.isVerifier && !token.claims.isSuperAdmin) {
      await signOut(auth);
      showLoginErr('This Google account does not have verifier access.');
      return;
    }
    showWorkspace(cred.user.displayName || cred.user.email || 'Verifier');
  } catch (err) {
    showLoginErr(err.code === 'auth/popup-closed-by-user'
      ? 'Sign-in cancelled.'
      : (err.message || 'Sign-in failed. Please try again.'));
  } finally {
    signinBtn.disabled = false;
    googleBtn.disabled = false;
    googleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg> Continue with Google`;
  }
}

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

boot().catch(e => showLoginErr(e.message || 'Failed to connect to Firebase.'));
