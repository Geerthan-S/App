/**
 * Shared UI pieces: modal, action dialog with reason code, toast, tables,
 * tabs, detail lists, empty and loading states.
 */

import { $, h, icon, clear } from './dom.js';

// ── Toasts ────────────────────────────────────────────────
export function toast(message, { error = false, timeout = 4500 } = {}) {
  const node = h('div', { class: `toast${error ? ' error' : ''}`, role: error ? 'alert' : 'status' },
    icon(error ? 'alert' : 'check', 'icon-sm'), h('span', {}, message));
  $('toasts').append(node);
  setTimeout(() => node.remove(), timeout);
}

export const errorMessage = err => {
  const code = err?.details?.code;
  if (code === 'RATE_LIMITED') return 'Too many requests. Wait a moment and try again.';
  if (code === 'MFA_REQUIRED') return 'Two-step verification is required. Sign out and sign in with your authenticator code.';
  return err?.message || 'Something went wrong.';
};

export const toastError = err => toast(errorMessage(err), { error: true, timeout: 7000 });

// ── Modal ─────────────────────────────────────────────────
const stack = [];

/** Opens a modal and returns { close, body, foot }. Escape and backdrop clicks close it. */
export function openModal({ title, subtitle, wide = false, onClose } = {}) {
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot', hidden: true });
  const closeBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Close' }, icon('x'));
  const dialog = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' },
      h('div', {}, h('div', { class: 'modal-title' }, title), subtitle ? h('div', { class: 'modal-sub' }, subtitle) : null),
      closeBtn),
    body, foot);
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    stack.splice(stack.indexOf(entry), 1);
    onClose?.();
  };
  const entry = { close };
  stack.push(entry);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  $('modal-root').append(backdrop);
  // On touch devices focus the dialog itself, so the keyboard doesn't open unasked.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  dialog.tabIndex = -1;
  setTimeout(() => (touch ? dialog : dialog.querySelector('input, select, textarea, button:not([aria-label="Close"])') || closeBtn).focus(), 0);
  const showFoot = (...nodes) => { foot.hidden = false; clear(foot).append(...nodes); };
  return { close, body, foot, showFoot, dialog };
}

export const closeAllModals = () => [...stack].reverse().forEach(m => m.close());

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
});

/**
 * A confirm dialog for privileged actions. With `reason: true` it asks for an
 * upper-case reason code (and optional notes) that the server records in the
 * audit trail. Resolves to { reasonCode, notes } or null if cancelled.
 */
export function actionDialog({
  title, message, confirmLabel = 'Confirm', danger = false, reason = true, notes = true,
  reasonPlaceholder = 'e.g. POLICY_VIOLATION', extra = null, onConfirm,
}) {
  return new Promise(resolve => {
    let settled = false;
    const modal = openModal({ title, onClose: () => { if (!settled) resolve(null); } });
    const err = h('div', { class: 'alert alert-error', hidden: true });
    const reasonInput = reason ? h('input', { class: 'input', placeholder: reasonPlaceholder, maxlength: 64, autocomplete: 'off', spellcheck: false }) : null;
    const notesInput = notes ? h('textarea', { class: 'textarea', maxlength: 1000, placeholder: 'Optional context for the audit trail' }) : null;
    reasonInput?.addEventListener('input', () => { reasonInput.value = reasonInput.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'); });
    const confirm = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit' }, confirmLabel);
    const form = h('form', { novalidate: true },
      message ? h('p', { class: 'muted' }, message) : null,
      extra,
      h('div', { class: 'section-gap' }),
      err,
      reasonInput ? h('div', { class: 'field' }, h('label', {}, 'Reason code'), reasonInput,
        h('span', { class: 'hint' }, 'Upper-case letters, digits and underscores. Saved to the audit trail.')) : null,
      notesInput ? h('div', { class: 'field' }, h('label', {}, 'Notes'), notesInput) : null,
      h('div', { class: 'btn-row end' },
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => modal.close() }, 'Cancel'), confirm));
    modal.body.append(form);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const reasonCode = reasonInput?.value.trim().replace(/^_+|_+$/g, '');
      if (reasonInput && !/^[A-Z0-9_]{2,64}$/.test(reasonCode || '')) {
        err.textContent = 'Enter a reason code of at least 2 characters.';
        err.hidden = false;
        return;
      }
      const values = { reasonCode, notes: notesInput?.value.trim() || undefined };
      if (!onConfirm) { settled = true; modal.close(); resolve(values); return; }
      confirm.disabled = true;
      try {
        await onConfirm(values);
        settled = true;
        modal.close();
        resolve(values);
      } catch (error) {
        err.textContent = errorMessage(error);
        err.hidden = false;
        confirm.disabled = false;
      }
    });
  });
}

// ── Building blocks ───────────────────────────────────────
export const loading = (text = 'Loading…') => h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('div', { class: 'section-gap' }, text));

export const empty = (title, detail = '', iconName = 'check') =>
  h('div', { class: 'empty' }, icon(iconName), h('div', { class: 'empty-title' }, title), detail ? h('div', {}, detail) : null);

export const errorBox = (err, retry) => h('div', { class: 'empty' }, icon('alert'),
  h('div', { class: 'empty-title' }, 'Could not load this section'),
  h('div', {}, errorMessage(err)),
  retry ? h('div', { class: 'section-gap' }, h('button', { class: 'btn btn-secondary btn-sm', onclick: retry }, 'Try again')) : null);

export const pageHead = (title, subtitle, ...actions) =>
  h('div', { class: 'page-head' },
    h('div', {}, h('h1', { class: 'page-title' }, title), subtitle ? h('p', { class: 'page-sub' }, subtitle) : null),
    actions.length ? h('div', { class: 'btn-row' }, ...actions) : null);

export const card = (title, subtitle, body, ...actions) =>
  h('section', { class: 'card' },
    title ? h('div', { class: 'card-head' },
      h('div', {}, h('h2', { class: 'card-title' }, title), subtitle ? h('div', { class: 'card-sub' }, subtitle) : null),
      actions.length ? h('div', { class: 'btn-row' }, ...actions) : null) : null,
    h('div', { class: 'card-body' }, body));

/**
 * columns: [{ label, render(row) => node|string, class }]
 * Rows are clickable when onRow is given.
 */
export function table(columns, rows, { onRow, emptyTitle = 'Nothing here', emptyDetail = '' } = {}) {
  if (!rows.length) return empty(emptyTitle, emptyDetail);
  const tbody = h('tbody');
  for (const row of rows) {
    const tr = h('tr', onRow ? { class: 'clickable', tabindex: 0 } : {},
      columns.map(col => h('td', { class: col.class, 'data-label': col.label || '' }, col.render(row))));
    if (onRow) {
      tr.addEventListener('click', e => { if (!e.target.closest('button, a, input, select, label')) onRow(row); });
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') onRow(row); });
    }
    tbody.append(tr);
  }
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'table stack-on-mobile' }, h('thead', {}, h('tr', {}, columns.map(c => h('th', {}, c.label)))), tbody));
}

export const cellMain = (main, sub) => h('div', {}, h('div', { class: 'cell-main' }, main ?? '—'), sub ? h('div', { class: 'cell-sub' }, sub) : null);

/** Pill tabs. options: [{ value, label, count }] */
export function tabs(options, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, options.map(opt =>
    h('button', {
      class: `tab${opt.value === active ? ' active' : ''}`, type: 'button', role: 'tab',
      'aria-selected': String(opt.value === active), onclick: () => onChange(opt.value),
    }, opt.label, Number.isFinite(opt.count) ? h('span', { class: 'n' }, String(opt.count)) : null)));
}

/** Detail grid from [[label, value]] pairs; empty values show a dash. */
export const dl = pairs => h('div', { class: 'dl' }, pairs.filter(Boolean).map(([label, value]) =>
  h('div', { class: 'dl-item' }, h('div', { class: 'dl-label' }, label),
    h('div', { class: 'dl-value' }, value instanceof Node ? value : (value === null || value === undefined || value === '' ? '—' : String(value))))));

export const moreButton = (onClick, label = 'Load more') =>
  h('div', { class: 'table-foot' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: onClick }, label));

export const toggle = (checked, { disabled = false, label, onChange }) => {
  const input = h('input', { type: 'checkbox', checked, disabled, 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked, input));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }));
};
