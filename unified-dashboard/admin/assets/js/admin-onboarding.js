/**
 * Admin onboarding API helpers (FD-059–074, FD-238–257).
 */
(function (global) {
  function apiFetch(path, opts = {}) {
    if (global.AdminShell?.apiFetch) return global.AdminShell.apiFetch(path, opts);
    const base = (global.API_BASE || global.location?.origin || '').replace(/\/$/, '');
    return fetch(`${base}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined
    }).then(async (res) => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json.error || json.message || res.statusText);
        err.code = json.code;
        err.field = json.field;
        throw err;
      }
      return json;
    });
  }

  async function listInvites() {
    const r = await apiFetch('/api/admin/invites');
    return r.invites || [];
  }

  async function createInvite(payload) {
    return apiFetch('/api/admin/invites', { method: 'POST', body: payload });
  }

  async function resendInvite(inviteId) {
    return apiFetch(`/api/admin/invites/${encodeURIComponent(inviteId)}/resend`, {
      method: 'POST',
      body: { send_email: true }
    });
  }

  async function revokeInvite(inviteId) {
    return apiFetch(`/api/admin/invites/${encodeURIComponent(inviteId)}/revoke`, { method: 'POST' });
  }

  async function convertLead(leadId, payload = {}) {
    return apiFetch(`/api/admin/invites/convert-lead/${encodeURIComponent(leadId)}`, {
      method: 'POST',
      body: { send_email: true, ...payload }
    });
  }

  async function fetchStuckOnboarding(days = 7) {
    return apiFetch(`/api/admin/voice-onboarding/stuck?days=${days}`);
  }

  async function fetchTenantOnboarding(customerId) {
    return apiFetch(`/api/admin/voice-onboarding/customers/${encodeURIComponent(customerId)}/voice-onboarding`);
  }

  async function resetOnboarding(customerId, state = 'voice_setup_incomplete') {
    return apiFetch(`/api/admin/voice-onboarding/customers/${encodeURIComponent(customerId)}/reset-onboarding`, {
      method: 'POST',
      body: { state }
    });
  }

  async function compareOpener(customerId) {
    return apiFetch(`/api/admin/voice-onboarding/customers/${encodeURIComponent(customerId)}/opener-compare`);
  }

  function tenantNameplate(tenant) {
    if (tenant?.shadow_week_active) return { label: 'SHADOW', cls: 'sfd-nameplate--shadow' };
    if (tenant?.pilot_live_at) return { label: 'LIVE', cls: 'sfd-nameplate--live' };
    if (tenant?.pending_invite) return { label: 'PENDING INVITE', cls: 'sfd-nameplate--pending-invite' };
    if (tenant?.onboarding_state && !['live', 'voice_setup_complete'].includes(tenant.onboarding_state)) {
      return { label: 'SETUP', cls: 'sfd-nameplate--off' };
    }
    return { label: '—', cls: 'sfd-nameplate--off' };
  }

  function tenantNameplateHtml(tenant) {
    const { label, cls } = tenantNameplate(tenant);
    return `<span class="sfd-nameplate ${cls} sfd-nameplate--sm"><span class="sfd-nameplate__led"></span>${label}</span>`;
  }

  global.AdminOnboarding = {
    apiFetch,
    listInvites,
    createInvite,
    resendInvite,
    revokeInvite,
    convertLead,
    fetchStuckOnboarding,
    fetchTenantOnboarding,
    resetOnboarding,
    compareOpener,
    tenantNameplate,
    tenantNameplateHtml
  };
})(typeof window !== 'undefined' ? window : global);
