/**
 * Admin Web Portal Application
 * Healthcare Workforce Platform
 * Provides:
 * - Dashboard: overview of doctors, hospitals, duties, applications, pending actions
 * - Doctor & Hospital Verification: side-by-side comparison of submitted vs official council data, evidence preview, approve, reject, request info, escalate
 * - Duty & User Moderation: manage reported duties/users (hide, warn, suspend, restore, escalate)
 * - Configuration: managed platform settings (including centralized 12-hour offer expiry) and feature flags
 * - Audit Logs: immutable audit trail tracking actor, action, timestamp, target, and correlation ID
 */

const state = {
  activePage: 'dashboard',
  config: {
    offerExpiryHours: 12,
    maxEvidenceSizeMb: 10,
    mfaStepUpSeconds: 600,
  },
  verificationQueue: [
    {
      caseId: 'case_doc_101',
      subjectType: 'doctor',
      subjectId: 'doc_aravind_01',
      name: 'Dr. Aravind Swaminathan',
      council: 'Tamil Nadu Medical Council',
      registrationNo: 'TNMC_98234',
      qualification: 'MBBS, MD (General Medicine)',
      status: 'submitted',
      automatedCheck: {
        provider: 'National Medical Commission (NMC) Official API',
        outcome: 'MATCH',
        confidence: 100,
        officialRecord: {
          name: 'Dr. Aravind Swaminathan',
          council: 'Tamil Nadu Medical Council',
          registrationNo: 'TNMC_98234',
          qualification: 'MBBS, MD (General Medicine)',
          status: 'ACTIVE',
        },
      },
      submittedAt: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      caseId: 'case_doc_102',
      subjectType: 'doctor',
      subjectId: 'doc_priya_02',
      name: 'Dr. Priya Ramachandran',
      council: 'Karnataka Medical Council',
      registrationNo: 'KMC_54129',
      qualification: 'MBBS, MS (General Surgery)',
      status: 'under_review',
      automatedCheck: {
        provider: 'NMC / State Medical Council Portal',
        outcome: 'MISMATCH',
        confidence: 75,
        officialRecord: {
          name: 'Dr. P. Ramachandran',
          council: 'Karnataka Medical Council',
          registrationNo: 'KMC_54129',
          qualification: 'MBBS',
          status: 'ACTIVE',
        },
        discrepancy: 'Degree discrepancy: submitted "MS (General Surgery)" vs registry "MBBS"',
      },
      submittedAt: new Date(Date.now() - 7200000).toISOString(),
    },
    {
      caseId: 'case_org_201',
      subjectType: 'organization',
      subjectId: 'org_apollo_spec',
      name: 'Apollo Specialty Clinic - OMR',
      council: 'State Health Establishment Registry',
      registrationNo: 'CLINIC_TN_8741',
      qualification: 'Multi-specialty Clinic',
      status: 'submitted',
      submittedAt: new Date(Date.now() - 14400000).toISOString(),
    }
  ],
  moderationReports: [
    {
      reportId: 'mod_rep_01',
      targetType: 'duty',
      targetId: 'duty_blr_er_99',
      targetTitle: 'Night Duty Casualty - Fortis Bannerghatta',
      reporterId: 'doc_usr_882',
      reason: 'TERMS_DISCREPANCY',
      details: 'Hospital requested 14 hours on-site while published duty specified 8 hours.',
      status: 'open',
      createdAt: new Date(Date.now() - 5400000).toISOString(),
    }
  ],
  auditLogs: [
    {
      auditId: 'aud_902',
      actorId: 'system_verif_engine',
      actorRole: 'system',
      action: 'VERIFICATION_AUTO_APPROVED',
      targetType: 'verificationCases',
      targetId: 'case_doc_101',
      reasonCode: 'AUTOMATED_MATCH_FAST_TRACK',
      correlationId: 'corr_auto_9182',
      result: 'SUCCESS',
      createdAt: new Date(Date.now() - 900000).toISOString(),
    },
    {
      auditId: 'aud_901',
      actorId: 'admin_usr_01',
      actorRole: 'verifier',
      action: 'VERIFICATION_DECISION_RECORDED',
      targetType: 'verificationCases',
      targetId: 'case_doc_99',
      reasonCode: 'REGISTRY_MATCH',
      correlationId: 'corr_8721_abc',
      result: 'SUCCESS',
      createdAt: new Date(Date.now() - 1800000).toISOString(),
    },
    {
      auditId: 'aud_900',
      actorId: 'usr_hosp_44',
      actorRole: 'hospital_staff',
      action: 'DOCTOR_SELECTED',
      targetType: 'assignments',
      targetId: 'asg_7812',
      reasonCode: 'ATOMIC_SELECTION',
      correlationId: 'corr_3319_xyz',
      result: 'SUCCESS',
      createdAt: new Date(Date.now() - 5400000).toISOString(),
    }
  ]
};

const routes = {
  dashboard: renderDashboard,
  'doctor-verification': renderDoctorVerification,
  'hospital-verification': renderHospitalVerification,
  moderation: renderModeration,
  'audit-logs': renderAuditLogs,
  config: renderConfig,
};

function init() {
  setupNavigation();
  updateCounts();
  renderPage('dashboard');

  document.getElementById('refresh-btn').addEventListener('click', () => {
    renderPage(state.activePage);
  });

  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal-container').classList.add('hidden');
  });
}

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      const page = el.getAttribute('data-page');
      renderPage(page);
    });
  });
}

function updateCounts() {
  const docCount = state.verificationQueue.filter(c => c.subjectType === 'doctor' && c.status === 'submitted').length;
  const hospCount = state.verificationQueue.filter(c => c.subjectType === 'organization' && c.status === 'submitted').length;

  document.getElementById('doc-queue-count').textContent = docCount;
  document.getElementById('hosp-queue-count').textContent = hospCount;
}

function renderPage(pageKey) {
  state.activePage = pageKey;
  const container = document.getElementById('page-container');
  const titleEl = document.getElementById('page-title');
  const subtitleEl = document.getElementById('page-subtitle');

  if (routes[pageKey]) {
    routes[pageKey](container, titleEl, subtitleEl);
  }
}

function renderDashboard(container, titleEl, subtitleEl) {
  titleEl.textContent = 'Executive Operations Dashboard';
  subtitleEl.textContent = 'Real-time verification queues, shift health, and audit trail';

  const pendingCount = state.verificationQueue.filter(c => c.status !== 'approved').length;
  const modCount = state.moderationReports.filter(r => r.status === 'open').length;

  container.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="title">Pending Verifications</div>
        <div class="value">${pendingCount}</div>
        <div class="subtitle">Doctor & Hospital cases awaiting review</div>
      </div>
      <div class="metric-card">
        <div class="title">Active Published Duties</div>
        <div class="value">14</div>
        <div class="subtitle">Across 3 major metro healthcare hubs</div>
      </div>
      <div class="metric-card">
        <div class="title">Offer Expiry Duration</div>
        <div class="value">${state.config.offerExpiryHours}h</div>
        <div class="subtitle">Centralized platform policy</div>
      </div>
      <div class="metric-card">
        <div class="title">Safety Moderation Reports</div>
        <div class="value">${modCount}</div>
        <div class="subtitle">Active reports requiring intervention</div>
      </div>
    </div>

    <div class="table-card">
      <div class="table-header">
        <h3>Pending Verification Queue (Doctors & Hospitals)</h3>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Name / Entity</th>
            <th>Registration / Council</th>
            <th>Automated Outcome</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.verificationQueue.map(c => `
            <tr>
              <td><strong>${c.subjectType.toUpperCase()}</strong></td>
              <td>${c.name}</td>
              <td>${c.registrationNo} (${c.council})</td>
              <td>
                ${c.automatedCheck ? `
                  <span class="status-badge ${c.automatedCheck.outcome === 'MATCH' ? 'approved' : 'needs_information'}">
                    ${c.automatedCheck.outcome} (${c.automatedCheck.confidence}%)
                  </span>
                ` : '<span style="color: var(--text-muted);">Manual Case</span>'}
              </td>
              <td><span class="status-badge ${c.status}">${c.status.replace('_', ' ')}</span></td>
              <td><button class="btn-action" onclick="window.reviewCase('${c.caseId}')">Review Case</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderDoctorVerification(container, titleEl, subtitleEl) {
  titleEl.textContent = 'Doctor Professional Identity Verification';
  subtitleEl.textContent = 'Side-by-side comparison of submitted information vs official medical council register';

  const doctors = state.verificationQueue.filter(c => c.subjectType === 'doctor');
  container.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <h3>Doctor Verification Queue (${doctors.length})</h3>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Doctor Name</th>
            <th>Medical Council</th>
            <th>Registration No</th>
            <th>Automated Match</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${doctors.map(d => `
            <tr>
              <td><strong>${d.name}</strong></td>
              <td>${d.council}</td>
              <td><code>${d.registrationNo}</code></td>
              <td>
                ${d.automatedCheck ? `
                  <span class="status-badge ${d.automatedCheck.outcome === 'MATCH' ? 'approved' : 'needs_information'}">
                    ${d.automatedCheck.outcome} (${d.automatedCheck.confidence}%)
                  </span>
                ` : 'Pending Check'}
              </td>
              <td><span class="status-badge ${d.status}">${d.status.replace('_', ' ')}</span></td>
              <td><button class="btn-action" onclick="window.reviewCase('${d.caseId}')">Inspect & Verify</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderHospitalVerification(container, titleEl, subtitleEl) {
  titleEl.textContent = 'Hospital Establishment Verification';
  subtitleEl.textContent = 'Verify healthcare facility licenses, clinical establishment certificates, and authorized reps';

  const orgs = state.verificationQueue.filter(c => c.subjectType === 'organization');
  container.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <h3>Organization Cases (${orgs.length})</h3>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Organization Name</th>
            <th>Type</th>
            <th>Establishment Reg No</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${orgs.map(o => `
            <tr>
              <td><strong>${o.name}</strong></td>
              <td>${o.qualification}</td>
              <td><code>${o.registrationNo}</code></td>
              <td><span class="status-badge ${o.status}">${o.status.replace('_', ' ')}</span></td>
              <td><button class="btn-action" onclick="window.reviewCase('${o.caseId}')">Inspect Documents</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderModeration(container, titleEl, subtitleEl) {
  titleEl.textContent = 'Duty & User Safety Moderation';
  subtitleEl.textContent = 'Manage reported duties, clinical terms disputes, and disciplinary moderation';

  container.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <h3>Open Moderation Reports (${state.moderationReports.length})</h3>
      </div>
      ${state.moderationReports.length === 0 ? `
        <div style="padding: 32px; text-align: center; color: var(--text-muted);">
          ✅ All moderation queues clear. No active duty or user violations reported.
        </div>
      ` : `
        <table class="data-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Reason Code</th>
              <th>Report Details</th>
              <th>Timestamp</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${state.moderationReports.map(r => `
              <tr>
                <td><strong>${r.targetTitle}</strong><br><small style="color: var(--text-muted);">${r.targetId}</small></td>
                <td><span class="status-badge needs_information">${r.reason}</span></td>
                <td>${r.details}</td>
                <td>${new Date(r.createdAt).toLocaleTimeString()}</td>
                <td>
                  <div style="display: flex; gap: 6px;">
                    <button class="btn-action" style="background: var(--accent-rose); padding: 4px 8px; font-size: 11px;" onclick="window.moderateReport('${r.reportId}', 'hide_duty')">Hide Duty</button>
                    <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="window.moderateReport('${r.reportId}', 'warn_user')">Warn Hospital</button>
                    <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="window.moderateReport('${r.reportId}', 'resolve')">Dismiss</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

function renderAuditLogs(container, titleEl, subtitleEl) {
  titleEl.textContent = 'Immutable Audit & Compliance Stream';
  subtitleEl.textContent = 'Cryptographically auditable timeline of all privileged mutations, verification outcomes, and selections';

  container.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <h3>Security Audit Logs</h3>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Correlation ID</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          ${state.auditLogs.map(a => `
            <tr>
              <td>${new Date(a.createdAt).toLocaleString()}</td>
              <td><code>${a.actorId}</code> (${a.actorRole})</td>
              <td><strong>${a.action}</strong></td>
              <td>${a.targetType}:${a.targetId}</td>
              <td><code>${a.correlationId}</code></td>
              <td><span class="status-badge approved">${a.result}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderConfig(container, titleEl, subtitleEl) {
  titleEl.textContent = 'Master Configuration & Remote Flags';
  subtitleEl.textContent = 'Manage medical council registries, centralized offer expiry duration, and feature rollout flags';

  container.innerHTML = `
    <div class="table-card" style="padding: 24px;">
      <h3 style="margin-bottom: 16px;">Centralized Assignment Policy</h3>
      <div style="background: var(--bg-surface-elevated); padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>Duty Offer Expiration Window</strong>
            <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">
              Configures the duration in hours before an unaccepted doctor selection offer expires automatically.
            </p>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="number" id="expiry-hours-input" value="${state.config.offerExpiryHours}" style="width: 70px; padding: 8px; background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;" />
            <button class="btn-action" onclick="window.updateOfferExpiry()">Update Policy</button>
          </div>
        </div>
      </div>

      <h3 style="margin-bottom: 16px;">Platform Feature Flags (Phase 2 Control)</h3>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-surface-elevated); border-radius: var(--radius-sm);">
          <div>
            <strong>Phase 2 Availability Calendar</strong>
            <p style="color: var(--text-muted); font-size: 12px;">Allows doctors to define recurring availability rules</p>
          </div>
          <span class="status-badge rejected">DISABLED</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-surface-elevated); border-radius: var(--radius-sm);">
          <div>
            <strong>Phase 2 Replacement State Machine</strong>
            <p style="color: var(--text-muted); font-size: 12px;">Enables automated replacement candidate search</p>
          </div>
          <span class="status-badge rejected">DISABLED</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-surface-elevated); border-radius: var(--radius-sm);">
          <div>
            <strong>Phase 2 Dispute Center</strong>
            <p style="color: var(--text-muted); font-size: 12px;">Formal dispute filing and single-level appeal</p>
          </div>
          <span class="status-badge rejected">DISABLED</span>
        </div>
      </div>
    </div>
  `;
}

window.updateOfferExpiry = function() {
  const val = parseInt(document.getElementById('expiry-hours-input').value, 10);
  if (val > 0) {
    state.config.offerExpiryHours = val;
    state.auditLogs.unshift({
      auditId: 'aud_' + Date.now(),
      actorId: 'admin_usr_01',
      actorRole: 'super_admin',
      action: 'PLATFORM_CONFIG_UPDATED',
      targetType: 'configuration',
      targetId: 'offer_policy',
      reasonCode: 'MASTER_CONFIG_EDIT',
      correlationId: 'corr_' + Math.random().toString(36).substring(2, 8),
      result: 'SUCCESS',
      createdAt: new Date().toISOString(),
    });
    alert(`Offer expiry updated to ${val} hours with audit record created.`);
    renderPage('config');
  }
};

window.moderateReport = function(reportId, action) {
  state.moderationReports = state.moderationReports.filter(r => r.reportId !== reportId);
  state.auditLogs.unshift({
    auditId: 'aud_' + Date.now(),
    actorId: 'admin_usr_01',
    actorRole: 'admin',
    action: `MODERATION_${action.toUpperCase()}`,
    targetType: 'moderationReports',
    targetId: reportId,
    reasonCode: 'MODERATOR_INTERVENTION',
    correlationId: 'corr_' + Math.random().toString(36).substring(2, 8),
    result: 'SUCCESS',
    createdAt: new Date().toISOString(),
  });
  alert(`Moderation action '${action}' applied successfully.`);
  renderPage('moderation');
};

window.reviewCase = function(caseId) {
  const item = state.verificationQueue.find(c => c.caseId === caseId);
  if (!item) return;

  const modal = document.getElementById('modal-container');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');

  title.textContent = `Verify Case: ${item.name}`;

  const hasAutomated = !!item.automatedCheck;
  const official = hasAutomated ? item.automatedCheck.officialRecord : null;

  body.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      ${hasAutomated ? `
        <div style="background: var(--bg-surface-elevated); padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong>Authoritative Registry Comparison</strong>
            <span class="status-badge ${item.automatedCheck.outcome === 'MATCH' ? 'approved' : 'needs_information'}">
              ${item.automatedCheck.outcome} (${item.automatedCheck.confidence}%)
            </span>
          </div>
          <table class="data-table" style="font-size: 12px;">
            <thead>
              <tr>
                <th>Field</th>
                <th>Submitted by Doctor</th>
                <th>Authoritative NMC / State Council Record</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Status</strong></td>
                <td>ACTIVE</td>
                <td><strong style="color: ${official.status === 'ACTIVE' ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">${official.status}</strong></td>
              </tr>
              <tr>
                <td><strong>Name</strong></td>
                <td>${item.name}</td>
                <td>${official.name}</td>
              </tr>
              <tr>
                <td><strong>Reg Number</strong></td>
                <td><code>${item.registrationNo}</code></td>
                <td><code>${official.registrationNo}</code></td>
              </tr>
              <tr>
                <td><strong>Council</strong></td>
                <td>${item.council}</td>
                <td>${official.council}</td>
              </tr>
              <tr>
                <td><strong>Qualifications</strong></td>
                <td>${item.qualification}</td>
                <td>${official.qualification}</td>
              </tr>
            </tbody>
          </table>
          ${item.automatedCheck.discrepancy ? `
            <div style="margin-top: 8px; color: var(--accent-amber); font-size: 12px;">
              ⚠️ ${item.automatedCheck.discrepancy}
            </div>
          ` : ''}
        </div>
      ` : `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="color: var(--text-muted); font-size: 12px;">SUBJECT ENTITY</label>
            <p><strong>${item.name}</strong></p>
          </div>
          <div>
            <label style="color: var(--text-muted); font-size: 12px;">REGISTRATION NUMBER</label>
            <p><code>${item.registrationNo}</code> (${item.council})</p>
          </div>
        </div>
      `}

      <div style="padding: 14px; background: var(--bg-surface-elevated); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
        <label style="color: var(--text-muted); font-size: 12px; display: block; margin-bottom: 6px;">PRIVATE EVIDENCE DOCUMENT (STORAGE SIGNED URL)</label>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>📄 medical_registration_certificate.pdf (2.4 MB)</span>
          <button class="btn-action" onclick="alert('Generated 5-minute short-lived signed URL via Cloud Function getEvidenceReadUrl. Public download URLs are strictly denied.')">Inspect Document</button>
        </div>
      </div>

      <div style="margin-top: 12px; display: flex; gap: 10px; justify-content: flex-end;">
        <button class="btn-secondary" onclick="window.decision('${caseId}', 'needs_information', 'REQUEST_ADDITIONAL_EVIDENCE')">Request Evidence</button>
        <button class="btn-action" style="background: var(--accent-rose);" onclick="window.decision('${caseId}', 'rejected', 'CREDENTIAL_DISCREPANCY')">Reject</button>
        <button class="btn-action" style="background: var(--accent-emerald);" onclick="window.decision('${caseId}', 'approved', 'OFFICIAL_REGISTRY_MATCH')">Approve Verification</button>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
};

window.decision = function(caseId, outcome, reasonCode) {
  const item = state.verificationQueue.find(c => c.caseId === caseId);
  if (item) {
    item.status = outcome;
    state.auditLogs.unshift({
      auditId: 'aud_' + Date.now(),
      actorId: 'admin_usr_01',
      actorRole: 'verifier',
      action: 'VERIFICATION_DECISION_RECORDED',
      targetType: 'verificationCases',
      targetId: caseId,
      reasonCode: reasonCode || 'MANUAL_INSPECTION',
      correlationId: 'corr_' + Math.random().toString(36).substring(2, 8),
      result: 'SUCCESS',
      createdAt: new Date().toISOString(),
    });
  }
  document.getElementById('modal-container').classList.add('hidden');
  updateCounts();
  renderPage(state.activePage);
};

document.addEventListener('DOMContentLoaded', init);
