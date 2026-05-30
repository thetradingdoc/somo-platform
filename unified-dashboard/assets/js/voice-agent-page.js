/**
 * Voice Agent control center — load/save for agent.html
 */
(function (global) {
  const API_BASE = () =>
    (typeof resolveApiBase === 'function'
      ? resolveApiBase()
      : (global.API_BASE || global.location?.origin || 'http://localhost:4000').replace(/\/$/, ''));

  function getAuthHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (typeof global.getAuthHeaders === 'function') {
      return { ...h, ...global.getAuthHeaders() };
    }
    return h;
  }

  async function fetchKellyStatus() {
    const res = await fetch(`${API_BASE()}/api/kelly/status`, {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Kelly status unavailable');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Kelly status failed');
    return json;
  }

  async function fetchBillingStatus() {
    const res = await fetch(`${API_BASE()}/api/voice-billing/status`, {
      credentials: 'include'
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.billing : null;
  }

  async function toggleKelly(enabled) {
    const res = await fetch(`${API_BASE()}/api/kelly/toggle`, {
      method: 'PATCH',
      credentials: 'include',
      headers: getAuthHeaders(),
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) throw new Error('Toggle failed');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Toggle failed');
    return json;
  }

  async function fetchVoiceSettings() {
    const res = await fetch(`${API_BASE()}/api/voice-agent/settings`, {
      credentials: 'include'
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.settings : null;
  }

  async function saveVoiceSettings(payload) {
    const res = await fetch(`${API_BASE()}/api/voice-agent/settings`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      const err = new Error(
        json.message || json.error || 'Could not save voice settings'
      );
      err.code = json.error || null;
      throw err;
    }
    return json;
  }

  async function fetchAgentStats() {
    const res = await fetch(`${API_BASE()}/api/customer/dashboard/agent/stats`, {
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Stats unavailable');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Stats failed');
    return json;
  }

  async function fetchPrompt() {
    const res = await fetch(`${API_BASE()}/api/customer/agent/prompt`, {
      credentials: 'include'
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.prompt : null;
  }

  async function savePrompt(prompt) {
    const res = await fetch(`${API_BASE()}/api/customer/agent/prompt`, {
      method: 'PUT',
      credentials: 'include',
      headers: getAuthHeaders(),
      body: JSON.stringify({ prompt })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Prompt save failed');
    }
    return json;
  }

  function formatDuration(seconds) {
    const s = Math.max(0, parseInt(seconds, 10) || 0);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }

  function outcomeBadgeClass(outcome) {
    const o = String(outcome || 'info').toLowerCase();
    return `va-outcome va-outcome-${o.replace(/[^a-z_]/g, '') || 'info'}`;
  }

  function outcomeLabel(outcome) {
    const map = {
      booked: 'Booked',
      voicemail: 'Voicemail',
      pa_flagged: 'PA flagged',
      transferred: 'Transferred',
      info: 'Info only'
    };
    return map[String(outcome || '').toLowerCase()] || 'Call';
  }

  function shouldRedirectToSetup(customer) {
    if (!customer) return false;
    if (customer.voice_setup_completed_at) return false;
    const trial = String(customer.trial_status || '').toLowerCase();
    return trial === 'active';
  }

  global.VoiceAgentPage = {
    API_BASE,
    fetchKellyStatus,
    fetchBillingStatus,
    toggleKelly,
    fetchVoiceSettings,
    saveVoiceSettings,
    fetchAgentStats,
    fetchPrompt,
    savePrompt,
    formatDuration,
    outcomeBadgeClass,
    outcomeLabel,
    formatPromptSyncedAt,
    shouldRedirectToSetup
  };
})(typeof window !== 'undefined' ? window : global);
