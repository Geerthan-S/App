/** Master Config, Medical Councils (trusted registries) and Feature Flags. */

import { h, icon, fmtDateTime, badge, add, put } from '../core/dom.js';
import { actionDialog, card, dl, pageHead, toast, toggle } from '../core/ui.js';
import { invoke } from '../core/session.js';

const versionMeta = item => (item.version ? `Version ${item.version} · changed ${fmtDateTime(item.updatedAt)}` : 'Default value, never changed');

const readOnlyNote = canEdit => (canEdit ? null
  : h('div', { class: 'alert alert-info' }, 'Read only. Only super admins can change platform settings.'));

/** A number setting with an audited save. */
function numberSetting({ label, hint, value, range, unit, canEdit, onSave }) {
  const input = h('input', { class: 'input', type: 'number', min: range.min, max: range.max, step: 1, value: String(value), disabled: !canEdit });
  const save = h('button', { class: 'btn btn-primary', type: 'submit', disabled: !canEdit }, 'Save');
  const form = h('form', { novalidate: true },
    h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'btn-row' }, h('div', {}, input), h('span', { class: 'muted' }, unit), save),
      h('span', { class: 'hint' }, `${hint} Allowed ${range.min}–${range.max}.`)));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const n = Number(input.value);
    if (!Number.isInteger(n) || n < range.min || n > range.max) {
      toast(`Enter a whole number from ${range.min} to ${range.max}.`, { error: true });
      return;
    }
    await onSave(n);
  });
  return form;
}

export async function renderMasterConfig(root, ctx) {
  const config = await invoke('getPlatformConfig');
  const { offerPolicy: offer, verificationPolicy: policy, canEdit } = config;
  const save = (title, configKey, configValue) => actionDialog({
    title, message: 'Takes effect immediately for new work and is recorded in the audit trail.', reason: false, notes: false,
    confirmLabel: 'Save',
    onConfirm: () => invoke('updatePlatformConfig', { configKey, configValue }),
  }).then(ok => { if (ok) { toast('Saved.'); ctx.rerender(); } });

  add(root, 
    pageHead('Master Config', 'Platform settings. Every change is validated on the server and audited.'),
    readOnlyNote(canEdit),
    h('div', { class: 'grid grid-2' },
      card('Assignment offers', versionMeta(offer), numberSetting({
        label: 'Offer expiry', unit: 'hours', value: offer.offerExpiryHours, range: offer.range, canEdit,
        hint: 'How long a selected doctor has to confirm before the seat reopens.',
        onSave: n => save(`Set offer expiry to ${n} hours?`, 'offer_policy', { offerExpiryHours: n }),
      })),
      card('Verification policy', versionMeta(policy), h('div', {},
        numberSetting({
          label: 'Review SLA', unit: 'hours', value: policy.slaHours, range: policy.ranges.slaHours, canEdit,
          hint: 'Target time from submission to decision. Drives SLA timers and the attention center.',
          onSave: n => save(`Set the review SLA to ${n} hours?`, 'verification_policy', { slaHours: n, reverifyAfterMonths: policy.reverifyAfterMonths }),
        }),
        numberSetting({
          label: 'Re-verification interval', unit: 'months', value: policy.reverifyAfterMonths, range: policy.ranges.reverifyAfterMonths, canEdit,
          hint: 'Verified doctors appear in Credential Renewals after this long.',
          onSave: n => save(`Re-verify doctors every ${n} months?`, 'verification_policy', { slaHours: policy.slaHours, reverifyAfterMonths: n }),
        })))),
    h('div', { class: 'section-gap' }, card('App release', versionMeta(config.appRelease), appReleaseForm(config.appRelease, canEdit, ctx))),
    h('div', { class: 'section-gap' }, card('Fixed security settings', 'Set in code; shown for reference', dl([
      ['Re-authentication window', `${config.fixed.stepUpAuthMaxAgeSeconds / 60} minutes`],
      ['Max evidence file size', `${config.fixed.maxEvidenceFileSizeBytes / (1024 * 1024)} MB`],
      ['Evidence link lifetime', `${config.fixed.signedUrlExpirySeconds / 60} minutes`],
      ['Consent version', config.fixed.consentVersion],
      ['Staff sign-in', 'Password + authenticator app (TOTP)'],
    ]))));
}

const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Minimum supported version and maintenance mode, read live by the mobile app. */
function appReleaseForm(release, canEdit, ctx) {
  const field = (label, value, hint, attrs = {}) => {
    const input = h('input', { class: 'input', value: value ?? '', disabled: !canEdit, spellcheck: false, ...attrs });
    return [input, h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('span', { class: 'hint' }, hint) : null)];
  };
  const [android, androidField] = field('Minimum Android version', release.minimumVersion.android, 'Older installs are blocked with an update screen.');
  const [ios, iosField] = field('Minimum iOS version', release.minimumVersion.ios, 'Unused until an iOS app ships.');
  const [latest, latestField] = field('Latest version', release.latestVersion, 'The version currently in the store.');
  const [url, urlField] = field('Update link', release.updateUrl, 'https link to the Play Store listing; leave empty to hide the button.', { type: 'url' });
  const maintenanceOn = h('input', { type: 'checkbox', checked: release.maintenance.enabled, disabled: !canEdit });
  const message = h('textarea', { class: 'textarea', maxlength: 300, disabled: !canEdit,
    placeholder: 'Shown to every user while maintenance is on' }, release.maintenance.message || '');
  const err = h('div', { class: 'alert alert-error', hidden: true });
  const form = h('form', { novalidate: true },
    h('div', { class: 'form-grid' }, androidField, iosField, latestField, urlField),
    h('label', { class: 'check section-gap' }, maintenanceOn, 'Maintenance mode: block the app for everyone'),
    h('div', { class: 'field' }, h('label', {}, 'Maintenance message'), message),
    err,
    h('div', { class: 'btn-row end' }, h('button', { class: 'btn btn-primary', type: 'submit', disabled: !canEdit }, 'Save')));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.hidden = true;
    const bad = [[android, 'Android'], [ios, 'iOS'], [latest, 'Latest']].find(([i]) => !SEMVER.test(i.value.trim()));
    if (bad) { err.textContent = `${bad[1]} version must look like 1.4.2.`; err.hidden = false; return; }
    const link = url.value.trim();
    if (link && !/^https:\/\//.test(link)) { err.textContent = 'The update link must start with https://'; err.hidden = false; return; }
    const value = {
      minimumVersion: { android: android.value.trim(), ios: ios.value.trim() },
      latestVersion: latest.value.trim(),
      updateUrl: link || null,
      maintenance: { enabled: maintenanceOn.checked, message: message.value.trim() },
    };
    const ok = await actionDialog({
      title: value.maintenance.enabled ? 'Turn maintenance mode on?' : 'Save app release settings?',
      message: value.maintenance.enabled
        ? 'Every user is blocked from the app until you turn it off. Server functions keep running.'
        : 'Installs older than the minimum version see an update screen immediately.',
      reason: false, notes: false, danger: value.maintenance.enabled, confirmLabel: 'Save',
      onConfirm: () => invoke('updatePlatformConfig', { configKey: 'app_release', configValue: value }),
    });
    if (ok) { toast('App release settings saved.'); ctx.rerender(); }
  });
  return form;
}

// Mirrors HOSTNAME_PATTERN in functions/src/admin/adminFunctions.ts; the server validates again.
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const normalizeDomain = d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');

export async function renderCouncils(root, ctx) {
  const config = await invoke('getPlatformConfig');
  const { registryDomains, canEdit } = config;
  const domains = [...registryDomains.value];

  const list = h('div', { class: 'list-rows' });
  const input = h('input', { class: 'input', placeholder: 'e.g. www.nmc.org.in', spellcheck: false, disabled: !canEdit });
  const err = h('div', { class: 'alert alert-error', hidden: true });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Save changes');
  let dirty = false;

  const draw = () => {
    put(list, ...(domains.length ? domains.map(domain => h('div', {},
      h('div', { class: 'btn-row' }, icon('landmark'), h('div', {}, h('div', { class: 'cell-main mono' }, domain),
        h('div', { class: 'cell-sub' }, 'Approvals may cite pages on this host'))),
      canEdit ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: domains.length === 1,
        title: domains.length === 1 ? 'At least one registry is required' : 'Remove',
        onclick: () => { domains.splice(domains.indexOf(domain), 1); dirty = true; draw(); } }, icon('x', 'icon-sm'), 'Remove') : null))
      : [h('div', { class: 'alert alert-warn' }, 'No trusted registry yet, so no case can be approved. Add the official council register first.')]));
    saveBtn.disabled = !canEdit || !dirty || !domains.length;
  };
  const addForm = h('form', { class: 'btn-row', novalidate: true }, h('div', {}, input),
    h('button', { class: 'btn btn-secondary', type: 'submit', disabled: !canEdit }, icon('plus'), 'Add'));
  addForm.addEventListener('submit', e => {
    e.preventDefault();
    const domain = normalizeDomain(input.value);
    err.hidden = true;
    if (!HOSTNAME.test(domain)) { err.textContent = 'Enter a bare host name such as www.nmc.org.in.'; err.hidden = false; return; }
    if (domains.includes(domain)) { err.textContent = 'Already trusted.'; err.hidden = false; return; }
    if (domains.length >= 50) { err.textContent = 'At most 50 registries.'; err.hidden = false; return; }
    domains.push(domain);
    input.value = '';
    dirty = true;
    draw();
  });
  saveBtn.addEventListener('click', async () => {
    const ok = await actionDialog({
      title: `Trust ${domains.length} registr${domains.length === 1 ? 'y' : 'ies'} for approvals?`,
      extra: h('div', { class: 'badges' }, domains.map(d => badge(null, d))), reason: false, notes: false, confirmLabel: 'Save',
      onConfirm: () => invoke('updatePlatformConfig', { configKey: 'approved_registry_domains', configValue: { value: domains } }),
    });
    if (ok) { toast('Trusted registries saved.'); ctx.rerender(); }
  });
  draw();

  add(root, 
    pageHead('Medical Councils', 'Official registers a verifier may cite when approving a case'),
    readOnlyNote(canEdit),
    h('div', { class: 'grid grid-main' },
      card('Trusted registries', versionMeta(registryDomains), h('div', {}, list, h('div', { class: 'section-gap' }), err, addForm),
        saveBtn),
      card('How approval uses this', null, h('div', { class: 'stack' },
        h('p', { class: 'muted' }, 'To approve, a verifier records the registry page they checked. The server only accepts pages on a host listed here, checked within the last 24 hours, with every field matching and an Active status.'),
        h('div', { class: 'alert alert-warn' }, 'Automatic registry sync is not available: the National Medical Commission and state councils publish no machine-readable API we are authorised to use. Checks are done by hand on the official sites (BLOCKED_EXTERNAL).')))));
}

const FLAG_LABELS = {
  phase2_availability_enabled: ['Doctor availability rules', 'Doctors set recurring availability; hospitals see it when selecting.'],
  phase2_replacement_enabled: ['Duty replacement requests', 'A selected doctor can ask for a replacement instead of cancelling.'],
  phase2_disputes_enabled: ['Assignment disputes', 'Either party can open a dispute on a completed assignment.'],
};

export async function renderFlags(root, ctx) {
  const config = await invoke('getPlatformConfig');
  const { canEdit } = config;
  add(root, 
    pageHead('Feature Flags', 'Phase 2 features, off until each is ready. Changes apply to every user immediately.'),
    readOnlyNote(canEdit),
    card(null, null, h('div', { class: 'list-rows' }, config.featureFlags.map(flag => {
      const [label, detail] = FLAG_LABELS[flag.key] || [flag.key, ''];
      return h('div', {},
        h('div', {}, h('div', { class: 'cell-main' }, label), h('div', { class: 'cell-sub' }, detail),
          h('div', { class: 'cell-sub mono' }, `${flag.key} · ${versionMeta(flag)}`)),
        toggle(flag.enabled, {
          disabled: !canEdit, label,
          onChange: async (enabled, input) => {
            input.checked = !enabled;
            const ok = await actionDialog({
              title: `${enabled ? 'Turn on' : 'Turn off'} "${label}"?`, message: 'Applies to every user immediately.',
              reason: false, notes: false, confirmLabel: enabled ? 'Turn on' : 'Turn off', danger: !enabled,
              onConfirm: () => invoke('setFeatureFlag', { flagKey: flag.key, enabled }),
            });
            if (ok) { toast(`${label} ${enabled ? 'on' : 'off'}.`); ctx.rerender(); }
          },
        }));
    }))));
}
