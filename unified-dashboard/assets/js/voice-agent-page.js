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

  async function fetchVoiceAgentStatus() {
    const res = await fetch(`${API_BASE()}/api/voice-agent/status`, {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Voice agent status unavailable');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Voice agent status failed');
    return json;
  }

  async function fetchIntegrationsStatus() {
    const res = await fetch(`${API_BASE()}/api/tenant/integrations/status`, {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Integrations status unavailable');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Integrations status failed');
    return json;
  }

  async function toggleKelly(enabled) {
    const res = await fetch(`${API_BASE()}/api/kelly/toggle`, {
      method: 'PATCH',
      credentials: 'include',
      headers: getAuthHeaders(),
      body: JSON.stringify({ enabled })
    });
    if (res.status === 401) {
      const err = new Error('Session expired — please sign in again.');
      err.code = 'auth_required';
      err.status = 401;
      throw err;
    }
    if (!res.ok) throw new Error('Toggle failed');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Toggle failed');
    return json;
  }

  async function fetchVoiceSettings(clinicId) {
    const cid =
      clinicId ||
      (typeof global.ppGetClinicId === 'function' ? global.ppGetClinicId() : null);
    const qs = cid ? `?clinic_id=${encodeURIComponent(cid)}` : '';
    const res = await fetch(`${API_BASE()}/api/voice-agent/settings${qs}`, {
      credentials: 'include'
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.settings : null;
  }

  async function saveVoiceSettings(payload) {
    const res = await fetch(`${API_BASE()}/api/voice-agent/settings`, {
      method: 'PATCH',
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

  async function fetchOnboarding() {
    const res = await fetch(`${API_BASE()}/api/voice-agent/onboarding`, {
      credentials: 'include'
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json : null;
  }

  function shouldRedirectToSetup(customer) {
    if (!customer) return false;
    if (customer.voice_setup_completed_at) return false;
    const state = customer.onboarding_state;
    if (state === 'voice_setup_complete' || state === 'live') return false;
    if (state === 'voice_setup_incomplete' || state === 'activation_shown' || state === 'terms_accepted') {
      return true;
    }
    const trial = String(customer.trial_status || '').toLowerCase();
    return trial === 'active';
  }

  async function resolveOnboardingRedirect() {
    const data = await fetchOnboarding();
    if (!data?.destination?.path) return null;
    const state = data.onboarding_state;
    if (state === 'voice_setup_complete' || state === 'live') return null;
    if (
      state === 'voice_setup_incomplete' ||
      state === 'activation_shown' ||
      state === 'terms_accepted'
    ) {
      return data.destination.path;
    }
    return null;
  }

  function formatPromptSyncedAt(iso) {
    if (!iso) return 'never';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'unknown';
      return d.toLocaleString();
    } catch (_) {
      return 'unknown';
    }
  }

  function dispositionLabel(disposition) {
    const map = {
      booked: 'Booked',
      insurance_verified: 'Insurance OK',
      copay_collected: 'Copay paid',
      copay_pending: 'Copay pending',
      handoff: 'Handoff',
      message_taken: 'Message',
      stedi_down: 'Eligibility down',
      pms_sync_pending: 'PMS pending'
    };
    const key = String(disposition || '').toLowerCase();
    return map[key] || outcomeLabel(disposition);
  }

  function defaultOutboundOpener(practiceName) {
    const name = String(practiceName || '').trim() || 'our office';
    return `Hi, I'm Kelly from ${name}. Is now still a good time to talk?`;
  }

  function applyOutboundOpenerDefault(settings, inputId, practiceName) {
    const el = document.getElementById(inputId);
    if (!el) return;
    const existing = String(settings?.outbound_opener || '').trim();
    if (existing) {
      el.value = existing;
      return;
    }
    const name =
      practiceName ||
      settings?.practice_name ||
      settings?.company_name ||
      window.__ppKellyStatus?.practice_name ||
      '';
    el.value = defaultOutboundOpener(name);
    el.placeholder = el.value;
  }

  global.VoiceAgentPage = {
    API_BASE,
    fetchKellyStatus,
    fetchVoiceAgentStatus,
    fetchIntegrationsStatus,
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
    dispositionLabel,
    formatPromptSyncedAt,
    defaultOutboundOpener,
    applyOutboundOpenerDefault,
    fetchOnboarding,
    resolveOnboardingRedirect,
    shouldRedirectToSetup
  };
})(typeof window !== 'undefined' ? window : global);
