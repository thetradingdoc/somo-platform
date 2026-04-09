/**
 * @param {{ apiBase: string, message: string, sessionId: string, clinicId?: string|null, preferredLanguage?: string, kellyFlow?: string|null, signal?: AbortSignal }} opts
 * @param {string|null} [opts.kellyFlow='skincare'] — Sent as `kelly_flow` so middleware sets `routine_intake_active` (Skin & Care). Pass `null` to omit (default triage tools/prompt).
 * @returns {Promise<{ success?: boolean, reply?: string, session_id?: string, error?: string, toolsUsed?: string[] }>}
 */
export async function sendLandingAssistantTurn({
  apiBase,
  message,
  sessionId,
  turnSeq = null,
  clinicId,
  preferredLanguage = '',
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
  if (turnSeq != null && Number.isFinite(Number(turnSeq))) body.turn_seq = Number(turnSeq);
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

export async function publishLandingThreadEvent({
  apiBase,
  sessionId,
  eventType = 'attachment',
  text,
  fileName = null,
  mimeType = null,
  signal
}) {
  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base) throw new Error('API base URL is not configured');
  const url = `${base}/api/public/landing-assistant/thread-event`;
  const body = {
    session_id: String(sessionId || '').trim(),
    type: String(eventType || 'note').trim(),
    text: String(text || '').trim(),
    file_name: fileName ? String(fileName).trim() : null,
    mime_type: mimeType ? String(mimeType).trim() : null
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify(body),
    signal
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.success) {
    const err = new Error(data.error || `Request failed (${r.status})`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

export async function incrementLandingVoiceMetric({ apiBase, sessionId, metricName, value = 1, signal }) {
  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base || !sessionId || !metricName) return { success: false, skipped: true };
  const r = await fetch(`${base}/api/public/landing-assistant/voice-metrics/inc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({
      session_id: String(sessionId).trim(),
      metric_name: String(metricName).trim(),
      value: Number(value) || 1
    }),
    signal
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.success) {
    const err = new Error(data.error || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function publishLandingVoiceTimeline({
  apiBase,
  sessionId,
  turnSeq,
  lang,
  detectedLanguage = '',
  preferredLanguage = '',
  ttsVoice = '',
  ttsModel = '',
  ttsLang = '',
  points = {},
  signal
}) {
  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base || !sessionId) return { success: false, skipped: true };
  const safePoints = points && typeof points === 'object' ? points : {};
  const r = await fetch(`${base}/api/public/landing-assistant/voice-metrics/inc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({
      session_id: String(sessionId).trim(),
      metric_name: 'voice.timeline',
      value: 1,
      turn_seq: Number(turnSeq) || 0,
      lang: String(lang || '').trim().toLowerCase(),
      detected_language: String(detectedLanguage || '').trim().toLowerCase(),
      preferred_language: String(preferredLanguage || '').trim().toLowerCase(),
      tts_voice: String(ttsVoice || '').trim(),
      tts_model: String(ttsModel || '').trim(),
      tts_lang: String(ttsLang || '').trim().toLowerCase(),
      points: safePoints
    }),
    signal
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.success) {
    const err = new Error(data.error || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function fetchBeautyFactsByBarcode({ apiBase, barcode, signal }) {
  const base = String(apiBase || '').replace(/\/$/, '');
  const clean = String(barcode || '').replace(/[^\d]/g, '');
  if (!base) throw new Error('API base URL is not configured');
  if (!/^\d{8,14}$/.test(clean)) throw new Error('Invalid barcode');
  const r = await fetch(`${base}/api/public/beautyfacts/${clean}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    signal
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.success) {
    const err = new Error(data.error || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function fetchLandingResultSnapshot({ apiBase, sessionId, signal }) {
  const base = String(apiBase || '').replace(/\/$/, '');
  const sid = String(sessionId || '').trim();
  if (!base) throw new Error('API base URL is not configured');
  if (!sid) throw new Error('sessionId required');
  const r = await fetch(`${base}/api/public/landing-assistant/results/${encodeURIComponent(sid)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    signal
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.success) {
    const err = new Error(data.error || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data;
}

export async function submitLandingResultEdit({
  apiBase,
  sessionId,
  fieldPath,
  userValue,
  reasonForChange = '',
  confidenceAfter = null,
  signal
}) {
  const base = String(apiBase || '').replace(/\/$/, '');
  const sid = String(sessionId || '').trim();
  if (!base) throw new Error('API base URL is not configured');
  if (!sid) throw new Error('sessionId required');
  if (!fieldPath) throw new Error('fieldPath required');
  const r = await fetch(`${base}/api/public/landing-assistant/results/${encodeURIComponent(sid)}/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({
      field_path: fieldPath,
      user_value: userValue,
      reason_for_change: reasonForChange,
      confidence_after: confidenceAfter
    }),
    signal
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.success) {
    const err = new Error(data.error || `Request failed (${r.status})`);
    err.status = r.status;
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
  if (typeof window !== 'undefined' && window.location?.origin) {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return window.location.origin;
  }
  if (process.env.NODE_ENV === 'development') return 'http://localhost:4000';
  return '';
}
