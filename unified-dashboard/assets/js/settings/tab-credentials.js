window.SettingsPage = window.SettingsPage || {};
const SP = window.SettingsPage;

async function loadCredentialsSettings() {
  const customer = SP.currentCustomer;
  if (!customer) return;
  let profile = customer.provider_profile;
  if (typeof profile === 'string') {
    try { profile = JSON.parse(profile); } catch (_) { profile = {}; }
  }
  profile = profile || {};
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val != null) el.value = val;
  };
  set('credLicenseNumber', profile.license_number);
  set('credLicenseState', profile.license_state || profile.license_region);
  const status = document.getElementById('credNpiDocStatus');
  if (status && profile.npi_document_name) {
    status.textContent = `On file: ${profile.npi_document_name}`;
  }
}

async function saveCredentialsSettings() {
  const msg = document.getElementById('credSaveMsg');
  const fileInput = document.getElementById('credNpiDoc');
  const patch = {
    license_number: document.getElementById('credLicenseNumber')?.value?.trim() || null,
    license_state: document.getElementById('credLicenseState')?.value?.trim() || null
  };
  const file = fileInput?.files?.[0];
  if (file) {
    if (file.size > 2 * 1024 * 1024) {
      if (msg) {
        msg.style.display = 'block';
        msg.textContent = 'File must be under 2 MB.';
        msg.style.color = 'var(--danger)';
      }
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    patch.npi_document_name = file.name;
    patch.npi_document_base64 = b64.slice(0, 500000);
    patch.npi_document_type = file.type || 'application/octet-stream';
  }
  try {
    const res = await fetch(`${SP.API_BASE}/api/customer/account`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_profile: patch })
    });
    const data = await res.json();
    if (msg) {
      msg.style.display = 'block';
      msg.textContent = data.success ? 'Credentials saved.' : data.error || 'Save failed';
      msg.style.color = data.success ? 'var(--success)' : 'var(--danger)';
    }
    if (data.success && SP.currentCustomer) {
      SP.currentCustomer.provider_profile = data.customer?.provider_profile || patch;
    }
  } catch (e) {
    if (msg) {
      msg.style.display = 'block';
      msg.textContent = e.message;
      msg.style.color = 'var(--danger)';
    }
  }
}

window.loadCredentialsSettings = loadCredentialsSettings;
window.saveCredentialsSettings = saveCredentialsSettings;

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadCredentialsSettings, 800);
});
