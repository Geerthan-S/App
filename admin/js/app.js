/**
 * HealthForce Admin — staff workspace.
 *
 * Boot → sign-in (password + authenticator) → workspace. Sections are listed
 * in NAV; each renders into #content from live, server-authorized callables.
 */

import { $, h, icon, clear, hydrateIcons, initials } from './core/dom.js';
import { closeAllModals, errorBox, loading, openModal, toastError } from './core/ui.js';
import {
  session, roles, roleLabel, initFirebase, refreshToken, hasPortalAccess, onSessionChange, signOut,
  signInWithPassword, completeSecondFactor, authMessage, needsEnrollment, startTotpEnrollment,
  finishTotpEnrollment, qrDataUrl, invoke, enrolledFactors, loadSessionPolicy,
} from './core/session.js';
import { renderDashboard, renderAttention } from './views/dashboard.js';
import { renderQueue, renderRenewals, openCase } from './views/verification.js';
import {
  renderDoctors, renderHospitals, renderDuties, renderDutyModeration, openDoctor, openOrganization, openDuty,
} from './views/directory.js';
import { renderReports } from './views/moderation.js';
import { renderAudit } from './views/governance.js';
import { renderStaff, renderSystemHealth, renderNotifications, renderSupport } from './views/platform.js';
import { renderMasterConfig, renderCouncils, renderFlags } from './views/config.js';
import { openAccount } from './views/account.js';

// ── Sections ──────────────────────────────────────────────
const NAV = [
  { group: null, items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid', access: 'staff', render: renderDashboard },
    { id: 'attention', label: 'Attention Center', icon: 'alert', access: 'staff', render: renderAttention, count: 'attention' },
  ] },
  { group: 'Verification', items: [
    { id: 'doctors-verification', label: 'Doctor Verification', icon: 'stethoscope', access: 'verifier', render: (c, x) => renderQueue(c, x, 'doctor'), count: 'doctorCases' },
    { id: 'hospitals-verification', label: 'Hospital Verification', icon: 'building', access: 'verifier', render: (c, x) => renderQueue(c, x, 'organization'), count: 'organizationCases' },
    { id: 'escalated', label: 'Escalated Cases', icon: 'flame', access: 'verifier', render: (c, x) => renderQueue(c, x, 'escalated'), count: 'escalated', hot: true },
    { id: 'renewals', label: 'Credential Renewals', icon: 'refresh', access: 'staff', render: renderRenewals },
  ] },
  { group: 'Management', items: [
    { id: 'doctors', label: 'Doctors', icon: 'users', access: 'staff', render: renderDoctors },
    { id: 'hospitals', label: 'Hospitals', icon: 'building', access: 'staff', render: renderHospitals },
    { id: 'duties', label: 'Duties', icon: 'calendar', access: 'staff', render: renderDuties },
  ] },
  { group: 'Moderation', items: [
    { id: 'reports', label: 'Reports', icon: 'flag', access: 'admin', render: renderReports, count: 'openReports' },
    { id: 'duty-moderation', label: 'Duty Moderation', icon: 'eyeOff', access: 'admin', render: renderDutyModeration },
  ] },
  { group: 'Governance', items: [
    { id: 'audit', label: 'Audit & Compliance', icon: 'scroll', access: 'admin', render: (c, x) => renderAudit(c, x, 'all') },
    { id: 'admin-activity', label: 'Admin Activity', icon: 'activity', access: 'admin', render: (c, x) => renderAudit(c, x, 'staff') },
  ] },
  { group: 'Platform', items: [
    { id: 'staff', label: 'Admins & Roles', icon: 'key', access: 'admin', render: renderStaff },
    { id: 'system-health', label: 'System Health', icon: 'pulse', access: 'admin', render: renderSystemHealth },
    { id: 'notifications', label: 'Notifications', icon: 'send', access: 'admin', render: renderNotifications },
    { id: 'support', label: 'Support Cases', icon: 'lifebuoy', access: 'admin', render: renderSupport },
  ] },
  { group: 'Configuration', items: [
    { id: 'config', label: 'Master Config', icon: 'sliders', access: 'admin', render: renderMasterConfig },
    { id: 'councils', label: 'Medical Councils', icon: 'landmark', access: 'admin', render: renderCouncils },
    { id: 'flags', label: 'Feature Flags', icon: 'toggle', access: 'admin', render: renderFlags },
  ] },
];
const SECTIONS = NAV.flatMap(g => g.items);
const sectionById = id => SECTIONS.find(s => s.id === id);
const canOpen = section => Boolean(section) && roles[section.access]();

// ── Screens ───────────────────────────────────────────────
const SCREENS = ['screen-login', 'screen-mfa', 'screen-enroll', 'screen-app'];
const show = id => SCREENS.forEach(s => { $(s).hidden = s !== id; });
const showError = (id, message) => { $(id).textContent = message || ''; $(id).hidden = !message; };

let pendingResolver = null;
let enrollment = null;
let notice = '';

function showLogin(message = '') {
  closeAllModals();
  stopTimers();
  $('login-form').reset();
  $('login-submit').disabled = false;
  showError('login-error', message);
  show('screen-login');
  $('login-username').focus();
}

async function handleLogin(e) {
  e.preventDefault();
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  if (!username || !password) { showError('login-error', 'Enter your username and password.'); return; }
  $('login-submit').disabled = true;
  showError('login-error', '');
  try {
    const result = await signInWithPassword(username, password);
    if (result.resolver) {
      pendingResolver = result.resolver;
      $('mfa-form').reset();
      showError('mfa-error', '');
      show('screen-mfa');
      $('mfa-code').focus();
    }
    // Without a second factor, onSessionChange routes to enrollment or the workspace.
  } catch (err) {
    showError('login-error', authMessage(err));
  } finally {
    $('login-submit').disabled = false;
    $('login-password').value = '';
  }
}

async function handleMfa(e) {
  e.preventDefault();
  const code = $('mfa-code').value.trim();
  if (!/^\d{6}$/.test(code)) { showError('mfa-error', 'Enter the 6-digit code.'); return; }
  $('mfa-submit').disabled = true;
  try {
    await completeSecondFactor(pendingResolver, code);
    pendingResolver = null;
  } catch (err) {
    showError('mfa-error', authMessage(err));
  } finally {
    $('mfa-submit').disabled = false;
  }
}

async function showEnrollment() {
  show('screen-enroll');
  $('enroll-form').reset();
  showError('enroll-error', '');
  $('enroll-submit').disabled = true;
  try {
    enrollment = await startTotpEnrollment();
    $('enroll-qr').src = qrDataUrl(enrollment.qrUrl);
    $('enroll-secret').textContent = enrollment.secretKey.replace(/(.{4})/g, '$1 ').trim();
    $('enroll-submit').disabled = false;
    $('enroll-code').focus();
  } catch (err) {
    showError('enroll-error',
      `${authMessage(err)} Two-step verification must be enabled for this project (Identity Platform, TOTP).`);
  }
}

async function handleEnroll(e) {
  e.preventDefault();
  const code = $('enroll-code').value.trim();
  if (!/^\d{6}$/.test(code)) { showError('enroll-error', 'Enter the 6-digit code from the app.'); return; }
  $('enroll-submit').disabled = true;
  try {
    await finishTotpEnrollment(enrollment.secret, code);
    enrollment = null;
    // The current session predates the second factor; sign in again with it.
    notice = 'Two-step verification is on. Sign in again with your authenticator code.';
    await signOut();
  } catch (err) {
    showError('enroll-error', authMessage(err));
    $('enroll-submit').disabled = false;
  }
}

// ── Workspace ─────────────────────────────────────────────
const counts = {};
let currentId = null;
let timers = [];

const stopTimers = () => { timers.forEach(clearInterval); timers = []; };

function buildNav() {
  const nav = clear($('nav'));
  for (const group of NAV) {
    const items = group.items.filter(canOpen);
    if (!items.length) continue;
    if (group.group) nav.append(h('div', { class: 'nav-group' }, group.group));
    for (const item of items) {
      const n = item.count ? counts[item.count] : 0;
      nav.append(h('a', {
        class: `nav-link${item.id === currentId ? ' active' : ''}`, href: `#/${item.id}`,
        'aria-current': item.id === currentId ? 'page' : null,
        onclick: () => setDrawer(false),
      }, icon(item.icon), h('span', {}, item.label),
      n ? h('span', { class: `count${item.hot ? ' hot' : ''}` }, String(n)) : null));
    }
  }
}

/** Sidebar and bell counts, refreshed on boot, every 2 minutes and after actions. */
async function refreshCounts() {
  try {
    const [dash, attention] = await Promise.all([invoke('getAdminDashboard'), invoke('getAttentionItems')]);
    Object.assign(counts, {
      doctorCases: dash.pending.doctorCases,
      organizationCases: dash.pending.organizationCases,
      openReports: roles.admin() ? dash.pending.openReports : 0,
      escalated: dash.insights?.sla?.escalated ?? 0,
      attention: attention.items.length,
    });
    $('bell-count').textContent = attention.items.length > 99 ? '99+' : String(attention.items.length);
    $('bell-count').hidden = !attention.items.length;
    buildNav();
  } catch (_) {
    // Counts are a convenience; each section reports its own errors.
  }
}

const routeFromHash = () => {
  const [id, param] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { id: id || 'dashboard', param: param ? decodeURIComponent(param) : null };
};

const navigate = (id, param) => {
  const hash = `#/${id}${param ? `/${encodeURIComponent(param)}` : ''}`;
  if (window.location.hash === hash) render(); else window.location.hash = hash;
};

let renderSeq = 0;

async function render() {
  if ($('screen-app').hidden) return;
  let { id } = routeFromHash();
  const { param } = routeFromHash();
  if (!canOpen(sectionById(id))) id = 'dashboard';
  const section = sectionById(id);
  const seq = ++renderSeq;
  currentId = id;
  buildNav();
  const content = clear($('content'));
  content.append(loading());
  document.title = `${section.label} · HealthForce Admin`;
  const ctx = {
    param, navigate, refreshCounts,
    isCurrent: () => seq === renderSeq,
    rerender: render,
  };
  try {
    const node = h('div');
    await section.render(node, ctx);
    if (seq !== renderSeq) return;
    clear(content).append(node);
    content.focus({ preventScroll: true });
  } catch (err) {
    if (seq !== renderSeq) return;
    clear(content).append(errorBox(err, render));
  }
}

function setupTopbar() {
  const name = session.user.displayName || session.user.email.split('@')[0];
  $('profile-name').textContent = name;
  $('profile-role').textContent = roleLabel();
  $('profile-avatar').textContent = initials(name);

  $('mfa-chip').className = `chip ${session.secondFactor ? 'chip-ok' : session.emulator || !session.mfaRequired ? 'chip-warn' : 'chip-bad'}`;
  $('mfa-chip-label').textContent = session.secondFactor ? 'MFA active'
    : session.emulator ? 'Emulator · no MFA' : !session.mfaRequired ? 'MFA not enforced yet' : 'MFA off';
  $('env-badge').textContent = session.emulator ? 'Local emulator · demo-healthforce' : 'Live · asia-south1';

  const tick = () => {
    $('clock').textContent = new Date().toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  };
  tick();
  stopTimers();
  timers.push(setInterval(tick, 30_000), setInterval(refreshCounts, 120_000));
}

async function enterWorkspace() {
  show('screen-app');
  setupTopbar();
  await render();
  refreshCounts();
}

// ── Global search (Ctrl K) ────────────────────────────────
const HIT_ICON = { doctor: 'stethoscope', organization: 'building', duty: 'calendar', case: 'shield', user: 'user' };

function openSearch() {
  if ($('screen-app').hidden) return;
  const modal = openModal({ title: 'Search' });
  modal.dialog.classList.add('palette');
  const input = h('input', {
    class: 'input', placeholder: 'ID, registration number, name, email or +91 phone',
    autocomplete: 'off', spellcheck: false, 'aria-label': 'Search',
  });
  const results = h('div', { class: 'palette-results' }, h('div', { class: 'palette-note' },
    'Exact IDs and registration numbers, or the start of a name. Email and phone lookups are for support staff.'));
  modal.body.replaceWith(h('div', {}, input, results));
  input.focus();

  let timer = null;
  let seq = 0;
  const openHit = hit => {
    modal.close();
    if (hit.type === 'doctor' || hit.type === 'user') openDoctor(hit.id, { refreshCounts });
    else if (hit.type === 'organization') openOrganization(hit.id);
    else if (hit.type === 'duty') openDuty(hit.id, { refreshCounts });
    else if (hit.type === 'case') openCase(hit.id, { onChange: refreshCounts });
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) return;
    timer = setTimeout(async () => {
      const mine = ++seq;
      clear(results).append(h('div', { class: 'palette-note' }, 'Searching…'));
      try {
        const { results: hits } = await invoke('adminSearch', { query });
        if (mine !== seq) return;
        clear(results);
        if (!hits.length) { results.append(h('div', { class: 'palette-note' }, 'No matches.')); return; }
        hits.forEach(hit => results.append(h('button', { class: 'palette-hit', type: 'button', onclick: () => openHit(hit) },
          icon(HIT_ICON[hit.type] || 'grid'),
          h('div', {}, h('div', { class: 'cell-main' }, hit.title),
            h('div', { class: 'cell-sub' }, `${hit.type === 'organization' ? 'hospital' : hit.type} · ${hit.subtitle || hit.id}`)))));
      } catch (err) {
        if (mine === seq) clear(results).append(h('div', { class: 'palette-note' }, err.message));
      }
    }, 250);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') results.querySelector('.palette-hit')?.click();
  });
}

// ── Theme ─────────────────────────────────────────────────
// ── Mobile navigation drawer ─────────────────────────────
function setDrawer(open) {
  $('sidebar').classList.toggle('open', open);
  $('scrim').hidden = !open;
  $('menu-btn').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('no-scroll', open);
  if (open) $('sidebar').querySelector('.nav-link.active, .nav-link')?.focus();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme-color').content = theme === 'dark' ? '#121315' : '#F4F4F1';
  $('theme-label').textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
  try { localStorage.setItem('hf-admin-theme', theme); } catch (_) { /* storage may be blocked */ }
}

function initialTheme() {
  try {
    const saved = localStorage.getItem('hf-admin-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch (_) { /* ignore */ }
  // Light is the app's default theme.
  return 'light';
}

// ── Wiring ────────────────────────────────────────────────
function wire() {
  $('login-form').addEventListener('submit', handleLogin);
  $('mfa-form').addEventListener('submit', handleMfa);
  $('mfa-cancel').addEventListener('click', () => { pendingResolver = null; showLogin(); });
  $('enroll-form').addEventListener('submit', handleEnroll);
  $('enroll-cancel').addEventListener('click', () => signOut());
  window.addEventListener('hashchange', render);

  $('menu-btn').addEventListener('click', () => setDrawer(!$('sidebar').classList.contains('open')));
  $('scrim').addEventListener('click', () => setDrawer(false));
  $('skip-link').addEventListener('click', () => $('content').focus());
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('sidebar').classList.contains('open')) setDrawer(false); });
  $('search-btn').addEventListener('click', openSearch);
  $('bell-btn').addEventListener('click', () => navigate('attention'));
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
  });

  const menu = $('profile-menu');
  const toggleMenu = open => { menu.hidden = !open; $('profile-btn').setAttribute('aria-expanded', String(open)); };
  $('profile-btn').addEventListener('click', e => { e.stopPropagation(); toggleMenu(menu.hidden); });
  document.addEventListener('click', e => { if (!menu.contains(e.target)) toggleMenu(false); });
  menu.addEventListener('click', async e => {
    const action = e.target.closest('button')?.dataset.action;
    if (!action) return;
    toggleMenu(false);
    if (action === 'account') openAccount();
    if (action === 'theme') applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    if (action === 'signout') await signOut();
  });
}

/**
 * Ties each `.field` label to its control so screen readers announce the
 * label, for forms built anywhere in the portal (including dialogs).
 */
let fieldSeq = 0;
function linkFieldLabels(node) {
  if (node.nodeType !== 1) return;
  const fields = node.matches('.field') ? [node] : [...node.querySelectorAll('.field')];
  for (const field of fields) {
    const label = field.querySelector(':scope > label');
    const control = field.querySelector('input, select, textarea');
    if (!label || !control || label.htmlFor) continue;
    if (!control.id) control.id = `field-${++fieldSeq}`;
    label.htmlFor = control.id;
  }
}

async function boot() {
  new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(linkFieldLabels)))
    .observe(document.body, { childList: true, subtree: true });
  applyTheme(initialTheme());
  hydrateIcons();
  wire();
  try {
    await initFirebase();
  } catch (err) {
    showLogin(err.message);
    $('login-submit').disabled = true;
    return;
  }
  if (session.emulator) $('env-note').textContent = 'Local emulator: two-step verification is not available here.';

  // Single entry point for fresh and restored sessions.
  onSessionChange(async user => {
    if (!user) {
      showLogin(notice);
      notice = '';
      return;
    }
    try {
      const token = await refreshToken(true);
      if (!hasPortalAccess(token)) {
        notice = 'This account does not have staff access.';
        await signOut();
        return;
      }
      await loadSessionPolicy();
      if (needsEnrollment()) {
        if (enrolledFactors().length) {
          // Enrolled, but this session skipped the second factor (e.g. restored from before enrollment).
          notice = 'Sign in again and enter your authenticator code.';
          await signOut();
        } else {
          await showEnrollment();
        }
        return;
      }
      await enterWorkspace();
    } catch (err) {
      toastError(err);
      await signOut();
    }
  });
}

boot();
