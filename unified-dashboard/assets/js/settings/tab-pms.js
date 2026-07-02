window.SettingsPage = window.SettingsPage || {};
const SP = window.SettingsPage;

function showPmsMessage(detailsEl, errorEl, text, isError) {
    if (errorEl) {
        errorEl.style.display = isError ? 'block' : 'none';
        errorEl.textContent = isError ? text : '';
    }
    if (detailsEl && !isError) {
        detailsEl.textContent = text;
    }
}

async function loadPmsStatus() {
    const statusEl = document.getElementById('pmsStatus');
    const detailsEl = document.getElementById('pmsDetails');
    const actionsEl = document.getElementById('pmsActions');
    const typeEl = document.getElementById('pmsTypeSelect');
    const errorEl = document.getElementById('pmsError');
    if (!statusEl) return;

    const clinicId = SP.clinicId || localStorage.getItem('clinic_id') || null;
    if (!SP.API_BASE) {
        statusEl.textContent = 'API not configured';
        return;
    }

    statusEl.textContent = 'Checking PMS connection...';
    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }
    try {
        const q = clinicId ? `?clinic_id=${encodeURIComponent(clinicId)}` : '';
        const res = await fetch(`${SP.API_BASE}/api/tenant/pms/status${q}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) {
            statusEl.textContent = 'Unable to load PMS status';
            showPmsMessage(detailsEl, errorEl, data.error || data.message || 'Unable to load status', true);
            return;
        }
        const type = (data.pms_type || 'somo').toLowerCase();
        if (typeEl) typeEl.value = type;
        statusEl.textContent = data.pms_enabled
            ? `Connected: ${type.toUpperCase()}`
            : 'Not connected';
        const parts = [];
        if (data.health?.message) parts.push(data.health.message);
        if (data.config?.practice_id) parts.push(`Practice ${data.config.practice_id}`);
        if (data.pms_last_sync_at) parts.push(`Last sync: ${new Date(data.pms_last_sync_at).toLocaleString()}`);
        if (type === 'somo') {
            parts.push('Configure Google Calendar below for conflict detection.');
        }
        detailsEl.textContent = parts.join(' • ');
        if (typeof window.loadE10SyncStatus === 'function') loadE10SyncStatus();

        const disconnectBtn = data.pms_enabled
            ? `<button class="btn btn-secondary btn-sm" onclick="disconnectPms()">Disconnect</button>`
            : '';
        actionsEl.innerHTML = `
            <button class="btn btn-primary btn-sm" onclick="connectPmsSomo()">Use Somo calendar</button>
            <button class="btn btn-primary btn-sm" onclick="connectPmsAthena()">Connect Athena</button>
            <button class="btn btn-secondary btn-sm" onclick="testPmsConnection()">Test connection</button>
            ${disconnectBtn}
        `;
    } catch (e) {
        statusEl.textContent = 'Failed to load PMS status';
        showPmsMessage(detailsEl, errorEl, e.message, true);
    }
}

async function connectPmsSomo() {
    const clinicId = SP.clinicId || localStorage.getItem('clinic_id');
    const detailsEl = document.getElementById('pmsDetails');
    const errorEl = document.getElementById('pmsError');
    const res = await fetch(`${SP.API_BASE}/api/tenant/pms/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clinic_id: clinicId, pms_type: 'somo', config: { mirror_google: true } })
    });
    const data = await res.json();
    if (data.success) {
        showPmsMessage(detailsEl, errorEl, 'Somo PMS mode enabled. Connect Google Calendar below for conflict detection.', false);
        loadPmsStatus();
    } else {
        showPmsMessage(detailsEl, errorEl, data.error || 'Connect failed', true);
    }
}

async function connectPmsAthena() {
    const clinicId = SP.clinicId || localStorage.getItem('clinic_id');
    const detailsEl = document.getElementById('pmsDetails');
    const errorEl = document.getElementById('pmsError');

    const practiceId = prompt('Athena practice_id (from developer portal):');
    if (!practiceId) return;
    const departmentId = prompt('Athena department_id (run discover script if unknown):') || '';
    const clientId = prompt('Athena client_id:');
    if (!clientId) return;
    const clientSecret = prompt('Athena client_secret:');
    if (!clientSecret) return;

    const res = await fetch(`${SP.API_BASE}/api/tenant/pms/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            clinic_id: clinicId,
            pms_type: 'athena',
            config: {
                practice_id: practiceId,
                department_id: departmentId || undefined,
                client_id: clientId,
                client_secret: clientSecret,
                mirror_google: false
            }
        })
    });
    const data = await res.json();
    if (data.success) {
        showPmsMessage(detailsEl, errorEl, 'Athena PMS connected. Run Test connection to verify scheduling.', false);
        loadPmsStatus();
    } else {
        showPmsMessage(detailsEl, errorEl, data.error || 'Athena connect failed', true);
    }
}

async function testPmsConnection() {
    const clinicId = SP.clinicId || localStorage.getItem('clinic_id');
    const detailsEl = document.getElementById('pmsDetails');
    const errorEl = document.getElementById('pmsError');
    const res = await fetch(`${SP.API_BASE}/api/tenant/pms/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clinic_id: clinicId })
    });
    const data = await res.json();
    if (data.success) {
        const slots = data.schedule_sample?.available_slots || data.schedule_sample?.slots || [];
        const slotHint = slots.length ? ` Sample slots: ${slots.slice(0, 3).join(', ')}` : '';
        showPmsMessage(detailsEl, errorEl, `PMS connection OK.${slotHint}`, false);
    } else {
        showPmsMessage(detailsEl, errorEl, data.error || data.health?.message || 'Test failed', true);
    }
}

async function disconnectPms() {
    const clinicId = SP.clinicId || localStorage.getItem('clinic_id');
    const detailsEl = document.getElementById('pmsDetails');
    const errorEl = document.getElementById('pmsError');
    if (!confirm('Disconnect practice management integration? Kelly will use degraded booking until reconnected.')) {
        return;
    }
    const q = clinicId ? `?clinic_id=${encodeURIComponent(clinicId)}` : '';
    const res = await fetch(`${SP.API_BASE}/api/tenant/pms/disconnect${q}`, {
        method: 'DELETE',
        credentials: 'include'
    });
    const data = await res.json();
    if (data.success) {
        showPmsMessage(detailsEl, errorEl, 'PMS disconnected.', false);
        loadPmsStatus();
    } else {
        showPmsMessage(detailsEl, errorEl, data.error || 'Disconnect failed', true);
    }
}

function onPmsTypeChange(ev) {
    const val = ev?.target?.value;
    const errorEl = document.getElementById('pmsError');
    if (val === 'dentrix' || val === 'eaglesoft') {
        if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.textContent = 'Dental PMS adapters require vendor API keys (deferred). Use Somo or Athena for now.';
        }
        ev.target.value = 'somo';
        return;
    }
    if (val === 'athena') {
        connectPmsAthena();
    }
}

SP.loadPmsStatus = loadPmsStatus;
SP.connectPmsSomo = connectPmsSomo;
SP.connectPmsAthena = connectPmsAthena;
SP.testPmsConnection = testPmsConnection;
SP.disconnectPms = disconnectPms;
SP.onPmsTypeChange = onPmsTypeChange;

window.loadPmsStatus = loadPmsStatus;
window.connectPmsSomo = connectPmsSomo;
window.connectPmsAthena = connectPmsAthena;
window.testPmsConnection = testPmsConnection;
window.disconnectPms = disconnectPms;
window.onPmsTypeChange = onPmsTypeChange;
