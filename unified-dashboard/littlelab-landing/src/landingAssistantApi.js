/**
 * @param {{ apiBase: string, message: string, sessionId: string, clinicId?: string|null, preferredLanguage?: string, kellyFlow?: string|null, signal?: AbortSignal }} opts
 * @param {string|null} [opts.kellyFlow='skincare'] — Sent as `kelly_flow` so middleware sets `routine_intake_active` (Skin & Care). Pass `null` to omit (default triage tools/prompt).
 * @returns {Promise<{ success?: boolean, reply?: string, session_id?: string, error?: string, toolsUsed?: string[] }>}
 */
export async function sendLandingAssistantTurn({
  apiBase,
  message,
  sessionId,
  clinicId,
  preferredLanguage = 'en',
  kellyFlow = 'skincare',
  signal
}) {
  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base) {
    return Promise.reject(new Error('API base URL is not configured'));
  }
  const url = `${base}/api/public/landing-assistant/turn`;
  const body = {
    message: String(message || '').trim(),
    session_id: sessionId
  };
  if (clinicId) body.clinic_id = clinicId;
  if (preferredLanguage) body.preferred_language = String(preferredLanguage).trim().toLowerCase();
  if (kellyFlow != null && String(kellyFlow).trim() !== '') {
    body.kelly_flow = String(kellyFlow).trim().toLowerCase();
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify(body),
    signal
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `Request failed (${r.status})`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

export function getOrCreateLandingSessionId(storageKey = 'littlelab_landing_assistant_sid') {
  try {
    let s = sessionStorage.getItem(storageKey);
    if (s) return s;
    s =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `ls_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    sessionStorage.setItem(storageKey, s);
    return s;
  } catch (_) {
    return `ls_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

export function resolveMiddlewareApiBase() {
  const fromEnv = (process.env.REACT_APP_API_BASE || '').trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'development') return 'http://localhost:4000';
  if (typeof window !== 'undefined' && window.location?.origin) {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return window.location.origin;
  }
  return '';
}
