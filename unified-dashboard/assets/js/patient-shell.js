import { patientSession } from './patient-session.js';

function escapeHtml(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ensureToastHost() {
  if (document.getElementById('patientToastHost')) return;
  const host = document.createElement('div');
  host.id = 'patientToastHost';
  host.style.position = 'fixed';
  host.style.left = '16px';
  host.style.right = '16px';
  host.style.bottom = '100px'; // above bottom tabs
  host.style.zIndex = '2000';
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.gap = '8px';
  document.body.appendChild(host);
}

export function showToast(message, type = 'info') {
  ensureToastHost();
  const host = document.getElementById('patientToastHost');
  const el = document.createElement('div');
  const bg = type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : type === 'warning' ? '#f59e0b' : '#2563eb';
  el.style.background = bg;
  el.style.color = '#fff';
  el.style.padding = '12px 14px';
  el.style.borderRadius = '12px';
  el.style.boxShadow = '0 10px 20px rgba(0,0,0,0.15)';
  el.style.fontSize = '14px';
  el.style.lineHeight = '1.25';
  el.innerHTML = escapeHtml(message);
  host.appendChild(el);
  setTimeout(() => {
    try { host.removeChild(el); } catch (_) {}
  }, 4500);
}

function ensureHelpModal() {
  if (document.getElementById('patientHelpModal')) return;
  const modal = document.createElement('div');
  modal.id = 'patientHelpModal';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.background = 'rgba(0,0,0,0.45)';
  modal.style.display = 'none';
  modal.style.zIndex = '2100';
  modal.innerHTML = `
    <div role="dialog" aria-modal="true" aria-label="Help and support" style="max-width:560px;margin:10vh auto;background:#fff;border-radius:16px;box-shadow:0 20px 40px rgba(0,0,0,0.2);overflow:hidden;">
      <div style="padding:16px 18px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;">
        <div style="font-weight:700;font-size:16px;">Help & Support</div>
        <button id="patientHelpCloseBtn" style="border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;">×</button>
      </div>
      <div style="padding:16px 18px;">
        <div id="patientSupportConfig" style="padding:12px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;margin-bottom:12px;">
          <div style="font-weight:700;margin-bottom:6px;">Clinic contact</div>
          <div style="color:#374151;font-size:13px;">Loading…</div>
        </div>
        <div style="font-weight:600;margin-bottom:6px;">Having trouble?</div>
        <ul style="margin:0 0 12px 18px;color:#374151;">
          <li>If video won’t join, wait until your join window opens and try again.</li>
          <li>If payment fails, retry from your appointment “Pay now”.</li>
          <li>If you’re signed out, sign in again to refresh your session.</li>
        </ul>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <a href="appointments.html" style="padding:10px 12px;border-radius:12px;background:#1e40af;color:#fff;font-weight:600;text-decoration:none;min-height:44px;display:inline-flex;align-items:center;">Go to Appointments</a>
          <button id="patientHelpSignOutBtn" style="padding:10px 12px;border-radius:12px;border:1px solid #e5e7eb;background:#fff;font-weight:600;min-height:44px;cursor:pointer;">Sign out</button>
        </div>
      </div>
    </div>
  `;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideHelp();
  });
  document.body.appendChild(modal);
  document.getElementById('patientHelpCloseBtn').addEventListener('click', hideHelp);
  document.getElementById('patientHelpSignOutBtn').addEventListener('click', () => {
    patientSession.clear();
    window.location.href = 'patient-login.html';
  });

  // Keyboard: ESC closes (mvp-57)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = document.getElementById('patientHelpModal');
      if (m && m.style.display === 'block') hideHelp();
    }
  });
}

export function showHelp() {
  ensureHelpModal();
  const modal = document.getElementById('patientHelpModal');
  modal.style.display = 'block';
  loadSupportConfig();
}
export function hideHelp() {
  const modal = document.getElementById('patientHelpModal');
  if (modal) modal.style.display = 'none';
}

async function loadSupportConfig() {
  const box = document.getElementById('patientSupportConfig');
  if (!box) return;
  try {
    const sessionId = patientSession.getSessionId();
    const base = window.API_BASE || 'http://localhost:4000';
    const res = await fetch(`${base}/api/patient/support-config`, {
      headers: { 'x-session-id': sessionId, 'ngrok-skip-browser-warning': 'true' }
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load');
    const s = data.support || {};
    box.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;">Clinic contact</div>
      <div style="color:#374151;font-size:13px;line-height:1.35;">
        ${s.phone ? `<div><strong>Phone:</strong> <a href="tel:${s.phone}">${s.phone}</a></div>` : ''}
        ${s.email ? `<div><strong>Email:</strong> <a href="mailto:${s.email}">${s.email}</a></div>` : ''}
        ${s.hours ? `<div><strong>Hours:</strong> ${s.hours}</div>` : ''}
        ${(!s.phone && !s.email && !s.hours) ? `<div>Contact info isn’t available yet.</div>` : ''}
      </div>
    `;
  } catch (_) {
    box.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;">Clinic contact</div>
      <div style="color:#374151;font-size:13px;">Contact info isn’t available yet.</div>
    `;
  }
}

function pageKeyFromPath() {
  const p = (window.location.pathname || '').split('/').pop() || '';
  if (p.includes('patient-dashboard')) return 'home';
  if (p.includes('schedule')) return 'calendar';
  if (p.includes('my-records')) return 'products';
  if (p.includes('appointments')) return 'routine';
  if (p.includes('wallet')) return 'wallet';
  if (p === 'profile.html' || p.includes('profile')) return 'profile';
  return 'home';
}

const DEFAULT_PATIENT_FEATURES = Object.freeze({
  wallet_enabled: false,
  chat_enabled: false
});

let patientFeaturesPromise = null;

export async function getPatientFeatureFlags() {
  if (patientFeaturesPromise) return patientFeaturesPromise;
  patientFeaturesPromise = (async () => {
    try {
      const sessionId = patientSession.getSessionId();
      if (!sessionId) return { ...DEFAULT_PATIENT_FEATURES };
      const base = window.API_BASE || 'http://localhost:4000';
      const res = await fetch(`${base}/api/patient/features`, {
        headers: { 'x-session-id': sessionId, 'ngrok-skip-browser-warning': 'true' }
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !data?.features) return { ...DEFAULT_PATIENT_FEATURES };
      return {
        wallet_enabled: !!data.features.wallet_enabled,
        chat_enabled: !!data.features.chat_enabled
      };
    } catch (_) {
      return { ...DEFAULT_PATIENT_FEATURES };
    }
  })();
  return patientFeaturesPromise;
}

export function mountBottomTabs() {
  // Require session for shell-mounted patient pages
  patientSession.requireSessionOrRedirect();

  if (document.getElementById('patientBottomTabs')) return;
  // Prevent content from being covered by tabs on mobile (tabs raised 12px from bottom)
  try {
    document.body.style.paddingBottom = '100px';
  } catch (_) {}
  const active = pageKeyFromPath();

  const tabs = document.createElement('nav');
  tabs.id = 'patientBottomTabs';
  tabs.className = 'patient-bottom-tabs';
  tabs.innerHTML = `
    <a class="tab ${active === 'home' ? 'active' : ''}" href="patient-dashboard.html" aria-label="Today" ${active === 'home' ? 'aria-current="page"' : ''}>
      <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg></span><span class="label">Today</span>
    </a>
    <a class="tab ${active === 'calendar' ? 'active' : ''}" href="schedule.html" aria-label="Timeline" ${active === 'calendar' ? 'aria-current="page"' : ''}>
      <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg></span><span class="label">Timeline</span>
    </a>
    <a class="tab ${active === 'profile' ? 'active' : ''}" href="profile.html" aria-label="Account" ${active === 'profile' ? 'aria-current="page"' : ''}>
      <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.6-6 8-6s6.5 2 8 6"/></svg></span><span class="label">Account</span>
    </a>
    <a class="tab ${active === 'routine' ? 'active' : ''}" href="appointments.html" aria-label="Routine" ${active === 'routine' ? 'aria-current="page"' : ''}>
      <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg></span><span class="label">Routine</span>
    </a>
    <a class="tab ${active === 'products' ? 'active' : ''}" href="my-records.html" aria-label="Products" ${active === 'products' ? 'aria-current="page"' : ''}>
      <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M9 13h6M9 17h6"/></svg></span><span class="label">Products</span>
    </a>
    <a class="tab ${active === 'wallet' ? 'active' : ''}" data-wallet-tab="1" href="wallet.html" aria-label="Wallet" ${active === 'wallet' ? 'aria-current="page"' : ''}>
      <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><rect x="2.5" y="6.5" width="19" height="11" rx="2"/><path d="M2.5 10.5h19"/><path d="M16 14h3"/></svg></span><span class="label">Wallet</span>
    </a>
  `;
  document.body.appendChild(tabs);
  getPatientFeatureFlags().then((features) => {
    if (!features.wallet_enabled) {
      tabs.querySelectorAll('[data-wallet-tab="1"]').forEach((el) => el.remove());
      document.querySelectorAll('a[href="wallet.html"]').forEach((el) => el.remove());
      if ((window.location.pathname || '').endsWith('/wallet.html') || (window.location.pathname || '').endsWith('wallet.html')) {
        window.location.href = 'appointments.html?wallet=disabled';
      }
    }
  }).catch(() => {});
}

