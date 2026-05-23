import { getApiBase } from './funnelSession';
import { middlewareApiBaseFromLocation } from '../landingAssistantApi';

const FUNNEL_HEADERS = { 'ngrok-skip-browser-warning': 'true' };

export function resolveFunnelApiBase() {
  const loc =
    typeof window !== 'undefined' && window.location
      ? { hostname: window.location.hostname, port: window.location.port, origin: window.location.origin }
      : null;
  if (loc?.port === '4000') {
    return loc.origin.replace(/\/$/, '');
  }
  const fromEnv = middlewareApiBaseFromLocation(process.env.REACT_APP_API_BASE || '', loc);
  return fromEnv || getApiBase();
}

export async function fetchRoutineConcerns() {
  const base = resolveFunnelApiBase();
  const res = await fetch(`${base}/api/public/routines/concerns`, {
    headers: FUNNEL_HEADERS,
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not load care plans');
  }
  return data.concerns || [];
}

export async function fetchRoutinePreview(concernId) {
  const base = resolveFunnelApiBase();
  const id = String(concernId || '').trim();
  const res = await fetch(`${base}/api/public/routines/${encodeURIComponent(id)}/preview`, {
    headers: FUNNEL_HEADERS,
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not load program preview');
  }
  return data.preview;
}

export async function confirmPatientVerifyCode(email, code) {
  const base = resolveFunnelApiBase();
  const res = await fetch(`${base}/api/patient/verify/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...FUNNEL_HEADERS,
    },
    body: JSON.stringify({
      email: String(email || '').trim(),
      code: String(code || '').trim(),
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Invalid verification code');
  }
  return data;
}

export async function activateRoutineTemplate(concernId, sessionId) {
  const base = resolveFunnelApiBase();
  const res = await fetch(`${base}/api/patient/routine/template`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': String(sessionId || '').trim(),
      ...FUNNEL_HEADERS,
    },
    body: JSON.stringify({ concern_id: String(concernId || '').trim() }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not activate your program');
  }
  return data;
}

export async function createPatientAuthHandoff(sessionId) {
  const base = resolveFunnelApiBase();
  const res = await fetch(`${base}/api/patient/auth/handoff/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': String(sessionId || '').trim(),
      ...FUNNEL_HEADERS,
    },
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not create app link');
  }
  return data;
}

export async function faceReadStatus() {
  const base = resolveFunnelApiBase();
  const res = await fetch(`${base}/api/public/face-read/status`, {
    headers: FUNNEL_HEADERS,
  });
  return res.json();
}

export async function faceReadUpload(blob) {
  const base = resolveFunnelApiBase();
  const fd = new FormData();
  fd.append('image', blob, 'selfie.jpg');
  const res = await fetch(`${base}/api/public/face-read`, {
    method: 'POST',
    body: fd,
    headers: FUNNEL_HEADERS,
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    const err = new Error(data.hint || data.error || 'Estimate failed');
    err.code = data.error;
    throw err;
  }
  return data.face_read;
}

export async function postFunnelIntake(body) {
  const base = resolveFunnelApiBase();
  const res = await fetch(`${base}/api/public/funnel/intake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...FUNNEL_HEADERS,
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not validate your match');
  }
  return data.proposal;
}

export async function postFunnelMatch(body) {
  const base = resolveFunnelApiBase();
  const res = await fetch(`${base}/api/public/funnel/match`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...FUNNEL_HEADERS,
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not match your concern');
  }
  return data.match;
}

export async function fetchFunnelSpecialists(zip, limit = 12) {
  const base = resolveFunnelApiBase();
  const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
  const q = new URLSearchParams({ zip: z, limit: String(limit) });
  const res = await fetch(`${base}/api/public/funnel/specialists?${q}`, {
    headers: FUNNEL_HEADERS,
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not load specialists');
  }
  return data;
}

/** Fire-and-forget funnel handoff analytics (requires patient session). */
export function recordFunnelPortalEvent(sessionId, event, metadata = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid || !event) return Promise.resolve();
  const base = resolveFunnelApiBase();
  return fetch(`${base}/api/patient/funnel/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': sid,
      ...FUNNEL_HEADERS,
    },
    body: JSON.stringify({
      event,
      route: metadata.route ?? null,
      concern_id: metadata.concern_id ?? null,
      user_goal: metadata.user_goal ?? null,
    }),
  }).catch(() => {});
}

export async function bridgeFunnelToKelly(sessionId, payload) {
  const base = resolveFunnelApiBase();
  const res = await fetch(`${base}/api/patient/funnel/bridge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': String(sessionId || '').trim(),
      ...FUNNEL_HEADERS,
    },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not save match context');
  }
  return data;
}

export async function fetchPatientRoutineTemplate(sessionId) {
  const base = resolveFunnelApiBase();
  const res = await fetch(`${base}/api/patient/routine/template`, {
    headers: {
      'x-session-id': String(sessionId || '').trim(),
      ...FUNNEL_HEADERS,
    },
  });
  const data = await res.json();
  if (!res.ok) return null;
  return data;
}

export async function sendPatientVerifyCode(email) {
  const base = resolveFunnelApiBase();
  const res = await fetch(`${base}/api/patient/verify/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...FUNNEL_HEADERS,
    },
    body: JSON.stringify({ email: String(email || '').trim() }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not send verification code');
  }
  return data;
}
