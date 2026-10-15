/** My account: profile, two-step verification and password. */

import { h, badge, fmtDate, add } from '../core/dom.js';
import { dl, openModal, toast, actionDialog } from '../core/ui.js';
import {
  session, roleLabel, enrolledFactors, unenrollFactor, reauthenticate, changePassword, authMessage, signOut,
} from '../core/session.js';

export function openAccount() {
  const modal = openModal({ title: 'My account & security', wide: true });
  const user = session.user;
  const factors = enrolledFactors();

  const pwErr = h('div', { class: 'alert alert-error', hidden: true });
  const pw1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: 12 });
  const pw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const pwSubmit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Change password');
  const pwForm = h('form', { novalidate: true }, pwErr,
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', {}, 'New password'), pw1, h('span', { class: 'hint' }, 'At least 12 characters.')),
      h('div', { class: 'field' }, h('label', {}, 'Confirm'), pw2)),
    h('div', { class: 'btn-row end' }, pwSubmit));
  pwForm.addEventListener('submit', async e => {
    e.preventDefault();
    pwErr.hidden = true;
    const fail = m => { pwErr.textContent = m; pwErr.hidden = false; };
    if (pw1.value.length < 12) return fail('Use at least 12 characters.');
    if (pw1.value !== pw2.value) return fail('The passwords do not match.');
    pwSubmit.disabled = true;
    try {
      await reauthenticate('Confirm your current password to change it.');
      await changePassword(pw1.value);
      toast('Password changed.');
      pwForm.reset();
    } catch (error) {
      fail(authMessage(error));
    } finally {
      pwSubmit.disabled = false;
    }
  });

  const factorRows = factors.length
    ? h('div', { class: 'list-rows' }, factors.map(f => h('div', {},
      h('div', {}, h('div', { class: 'cell-main' }, f.displayName || 'Authenticator app'), h('div', { class: 'cell-sub' }, `Added ${fmtDate(f.enrollmentTime)}`)),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
        const ok = await actionDialog({
          title: 'Remove this authenticator?', danger: true, reason: false, notes: false, confirmLabel: 'Remove',
          message: 'Staff tools need two-step verification, so you will be signed out and asked to set up a new authenticator.',
          onConfirm: async () => { await reauthenticate('Confirm it’s you to remove the authenticator.'); await unenrollFactor(f.uid); },
        });
        if (ok) { toast('Authenticator removed.'); modal.close(); await signOut(); }
      } }, 'Remove'))))
    : h('div', { class: 'alert alert-warn' }, session.emulator
      ? 'The local emulator has no two-step verification. In production you set it up at first sign-in.'
      : 'No authenticator enrolled.');

  add(modal.body, 
    h('h4', {}, 'Profile'),
    dl([['Name', user.displayName], ['Username', user.email?.split('@')[0]], ['Role', roleLabel()],
      ['Last sign-in', fmtDate(user.metadata?.lastSignInTime)]]),
    h('h4', {}, 'Two-step verification'),
    h('div', { class: 'btn-row' }, badge(session.secondFactor ? 'ok' : 'warning', session.secondFactor ? 'This session used your authenticator' : 'This session has no second factor')),
    h('div', { class: 'section-gap' }, factorRows),
    h('h4', {}, 'Password'), pwForm);
}
