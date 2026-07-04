/**
 * Shared onboarding API client (FD-035, FD-092, FD-104).
 */
(function (global) {
  function apiBase() {
    const base =
      (typeof global.resolveApiBase === 'function' && global.resolveApiBase()) ||
      global.API_BASE ||
      global.location?.origin ||
      '';
    return String(base).replace(/\/$/, '');
  }

  async function parseJson(res) {
    return res.json().catch(() => ({}));
  }

  async function fetchOnboarding() {
    const res = await fetch(`${apiBase()}/api/voice-agent/onboarding`, { credentials: 'include' });
    if (!res.ok) return null;
    const json = await parseJson(res);
    return json.success ? json : null;
  }

  async function fetchBlockers() {
    const res = await fetch(`${apiBase()}/api/voice-agent/onboarding/blockers`, { credentials: 'include' });
    if (!res.ok) return null;
    const json = await parseJson(res);
    return json.success ? json : null;
  }

  async function patchConnectMeta(meta = {}) {
    const res = await fetch(`${apiBase()}/api/voice-agent/onboarding/connect`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta)
    });
    const json = await parseJson(res);
    if (!res.ok) throw new Error(json.message || json.error || 'Could not save onboarding progress');
    return json;
  }

  async function startWizardStep(step, meta = {}) {
    const res = await fetch(`${apiBase()}/api/voice-agent/onboarding/wizard-started`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wizard_step: step, ...meta })
    });
    const json = await parseJson(res);
    if (!res.ok) throw new Error(json.message || json.error || 'Could not start wizard step');
    return json;
  }

  async function fetchCalendarCalendars(email) {
    if (!email) return { calendars: [] };
    const res = await fetch(
      `${apiBase()}/api/calendar/calendars?email=${encodeURIComponent(email)}`,
      { credentials: 'include' }
    );
    if (!res.ok) return { calendars: [] };
    return parseJson(res);
  }

  async function fetchLatestTestCall() {
    const res = await fetch(`${apiBase()}/api/voice-agent/test-call/latest`, { credentials: 'include' });
    if (!res.ok) return null;
    const json = await parseJson(res);
    return json;
  }

  async function selectCalendar(email, calendarId, calendarName, calendarTimezone) {
    if (!email || !calendarId) throw new Error('email and calendar_id required');
    const res = await fetch(`${apiBase()}/api/calendar/select`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        calendar_id: calendarId,
        calendar_name: calendarName || calendarId,
        calendar_timezone: calendarTimezone || undefined
      })
    });
    const json = await parseJson(res);
    if (!res.ok) throw new Error(json.error || json.message || 'Could not save calendar selection');
    return json;
  }

  global.SomoOnboardingApi = {
    apiBase,
    fetchOnboarding,
    fetchBlockers,
    patchConnectMeta,
    startWizardStep,
    fetchCalendarCalendars,
    fetchLatestTestCall,
    selectCalendar
  };
})(typeof window !== 'undefined' ? window : global);
