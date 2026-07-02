window.SettingsPage = window.SettingsPage || {};
const SP = window.SettingsPage;

async function loadPracticeSettings() {
  const clinicId = SP.clinicId || localStorage.getItem('clinic_id');
  if (!SP.API_BASE || !clinicId) return;
  try {
    const q = `?clinic_id=${encodeURIComponent(clinicId)}`;
    const res = await fetch(`${SP.API_BASE}/api/tenant/clinic${q}`, { credentials: 'include' });
    const data = await res.json();
    if (!data.success) return;
    const c = data.clinic || {};
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null) el.value = val;
    };
    set('practiceTransferNumber', c.transfer_number);
    set('practiceNpi', c.npi);
    set('practiceTaxId', c.tax_id);
    set('practiceAddress', c.practice_address);
    set('practiceOfficeType', c.office_type || 'dental');
    if (c.payer_list_json) {
      try {
        const payers = JSON.parse(c.payer_list_json);
        set('practicePayers', Array.isArray(payers) ? payers.join(', ') : c.payer_list_json);
      } catch (_) {
        set('practicePayers', c.payer_list_json);
      }
    }
  } catch (_) {}
}

async function savePracticeSettings() {
  const clinicId = SP.clinicId || localStorage.getItem('clinic_id');
  const msg = document.getElementById('practiceSaveMsg');
  const payersRaw = document.getElementById('practicePayers')?.value || '';
  const payer_list = payersRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const body = {
    clinic_id: clinicId,
    transfer_number: document.getElementById('practiceTransferNumber')?.value?.trim(),
    npi: document.getElementById('practiceNpi')?.value?.trim(),
    tax_id: document.getElementById('practiceTaxId')?.value?.trim(),
    practice_address: document.getElementById('practiceAddress')?.value?.trim(),
    office_type: document.getElementById('practiceOfficeType')?.value || 'dental',
    payer_list
  };
  const res = await fetch(`${SP.API_BASE}/api/tenant/clinic`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (msg) {
    msg.style.display = 'block';
    msg.textContent = data.success ? 'Practice settings saved.' : data.error || 'Save failed';
    msg.style.color = data.success ? 'var(--success)' : 'var(--danger)';
  }
}

async function importRosterCsv() {
  const fileInput = document.getElementById('rosterCsvFile');
  const status = document.getElementById('rosterImportStatus');
  const file = fileInput?.files?.[0];
  if (!file) {
    if (status) status.textContent = 'Choose a CSV file first.';
    return;
  }
  const text = await file.text();
  const clinicId = SP.clinicId || localStorage.getItem('clinic_id');
  const res = await fetch(`${SP.API_BASE}/api/tenant/roster/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ clinic_id: clinicId, csv: text })
  });
  const data = await res.json();
  if (status) {
    status.textContent = data.success
      ? `Imported: ${data.created || 0} created, ${data.updated || 0} updated, ${data.failed || 0} failed.`
      : data.error || 'Import failed';
  }
}

async function loadE10SyncStatus() {
  const el = document.getElementById('e10SyncStatus');
  if (!el || !SP.API_BASE) return;
  try {
    const clinicId = SP.clinicId || localStorage.getItem('clinic_id');
    const q = clinicId ? `?clinic_id=${encodeURIComponent(clinicId)}` : '';
    const res = await fetch(`${SP.API_BASE}/api/tenant/pms/sync-status${q}`, { credentials: 'include' });
    const data = await res.json();
    if (!data.success) {
      el.textContent = 'Sync status unavailable';
      return;
    }
    el.textContent = `Pending writes: ${data.pending_pms_writes || 0} · Queue: ${data.pending_sync_queue || 0} · Appts (7d): ${data.appointments_last_7d || 0}`;
  } catch (e) {
    el.textContent = e.message;
  }
}

SP.loadPracticeSettings = loadPracticeSettings;
SP.savePracticeSettings = savePracticeSettings;
SP.importRosterCsv = importRosterCsv;
SP.loadE10SyncStatus = loadE10SyncStatus;
window.loadPracticeSettings = loadPracticeSettings;
window.savePracticeSettings = savePracticeSettings;
window.importRosterCsv = importRosterCsv;
window.loadE10SyncStatus = loadE10SyncStatus;
