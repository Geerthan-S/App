/**
 * Safe DOM building. Every node is created with createElement and every piece
 * of data is set with textContent: no innerHTML, so server data can never be
 * interpreted as markup.
 */

export const $ = id => document.getElementById(id);

/**
 * h('div', { class: 'card', onclick: fn, dataset: { id } }, child, 'text', [more])
 * Strings and numbers become text nodes; null/false children are skipped.
 */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'text') node.textContent = value;
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clear = node => { node.replaceChildren(); return node; };

// ── Icons (static path data only) ─────────────────────────
const ICONS = {
  cross: 'M12 4v16M4 12h16',
  shield: 'M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3zM9 12l2 2 4-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 20a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 20a7 7 0 0 0-4-6.3',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  alert: 'M12 3l10 18H2L12 3zM12 10v4M12 17.5v.5',
  stethoscope: 'M6 3v6a4 4 0 0 0 8 0V3M10 13v3a5 5 0 0 0 10 0v-2M20 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4',
  flame: 'M12 3s5 4.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3 1-6 1-8.5z',
  refresh: 'M20 11a8 8 0 0 0-14.7-4.3L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.3L20 16M20 20v-4h-4',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14H4V6zM4 10h16M8 2v4M16 2v4',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  eyeOff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3.2 3.6M6.5 7.5C4.3 9 3 12 3 12s4 6 9 6c1.4 0 2.7-.4 3.9-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  scroll: 'M8 3h10a2 2 0 0 1 2 2v12M8 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10M8 3a2 2 0 0 1 2 2M10 9h6M10 13h6M10 17h4',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  key: 'M15 7a4 4 0 1 1-3.5 6L4 20.5V17h3v-3h3l1.5-1.5A4 4 0 0 1 15 7zM16 8h.01',
  pulse: 'M3 12h3l2-5 4 10 2-5h7',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z',
  lifebuoy: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  landmark: 'M3 21h18M5 21V10M10 21V10M14 21V10M19 21V10M2 10l10-6 10 6',
  toggle: 'M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7zM16 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  plus: 'M12 5v14M5 12h14',
  mapPin: 'M12 21s-7-6-7-11a7 7 0 1 1 14 0c0 5-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || ICONS.grid);
  svg.append(path);
  return svg;
}

/** Fills every static `data-icon` placeholder in the page. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => {
    if (!node.querySelector('svg')) node.prepend(icon(node.dataset.icon));
  });
}

// ── Formatting ────────────────────────────────────────────
const LOCALE = 'en-IN';

export const fmtNum = n => (Number.isFinite(n) ? n.toLocaleString(LOCALE) : '—');

export function fmtDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export function fmtDateTime(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
}

/** "5m ago", "in 2h 10m". */
export function fmtRelative(iso, nowMs = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '—';
  const diff = t - nowMs;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  let text;
  if (mins < 1) text = 'now';
  else if (mins < 60) text = `${mins}m`;
  else if (mins < 48 * 60) text = `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ''}`.trim();
  else text = `${Math.round(mins / 1440)}d`;
  if (text === 'now') return 'just now';
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

export const humanize = value => (value ? String(value).replace(/_/g, ' ') : '—');
export const initials = name => String(name || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';

// ── Status badges (fixed vocabulary → fixed classes) ──────
const BADGE_TONES = {
  ok: ['approved', 'clean', 'delivered', 'active', 'SUCCESS', 'verified', 'resolved', 'published', 'completed', 'on_track', 'ok'],
  warn: ['needs_information', 'pending', 'under_review', 'paused', 'due_soon', 'leased', 'failed', 'warning', 'draft', 'open', 'waiting_on_applicant', 'high'],
  bad: ['rejected', 'infected', 'dead_letter', 'suspended', 'DENIED', 'FAILED', 'overdue', 'cancelled', 'urgent', 'expired'],
  info: ['submitted', 'filled', 'in_progress', 'confirmed', 'selected', 'normal', 'blocked_external'],
  ink: ['ink'],
  lime: ['lime'],
};
const toneOf = value => Object.keys(BADGE_TONES).find(tone => BADGE_TONES[tone].includes(value));

export function badge(value, label) {
  const tone = toneOf(value);
  return h('span', { class: `badge${tone ? ` badge-${tone}` : ''}` }, label ?? humanize(value));
}

export function downloadCsv(filename, rows) {
  const escape = v => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Neutralise spreadsheet formulas in exported data.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = rows.map(r => r.map(escape).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Appends children like h(): skips null/false, flattens arrays. Use instead of node.append. */
export const add = (node, ...children) => append(node, children);
/** Replaces all children like h(). Use instead of node.replaceChildren. */
export const put = (node, ...children) => append(clear(node), children);
