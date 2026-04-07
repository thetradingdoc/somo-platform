/**
 * LiveKit token for landing "Try now" demo rooms (no appointment).
 * Uses POST /api/livekit/token — same as business video; room is try-landing-{slug}.
 */

export async function fetchLiveKitToken({ apiBase, room, identity, name, signal }) {
  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base) {
    throw new Error('API base URL is not configured');
  }
  const res = await fetch(`${base}/api/livekit/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room: String(room || '').trim(),
      identity: String(identity || '').trim(),
      name: String(name || 'Visitor').trim()
    }),
    credentials: 'omit',
    signal
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || `Token request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return { token: data.token, url: data.url, room: data.room };
}

/** Stable room name from landing assistant session id (LiveKit-safe). */
export function landingTryRoomName(sessionId) {
  const slug = String(sessionId || 'demo').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);
  return `try-landing-${slug || 'demo'}`;
}

export function landingLiveKitIdentity(sessionId) {
  const slug = String(sessionId || 'user').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 28);
  return `landing-${slug || 'user'}`;
}

/**
 * Publish canonical vision capture events to middleware.
 */
export async function publishVisionCaptureEvent({ apiBase, eventType, payload, idempotencyKey, actor = 'assistant', signal }) {
  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base) return { success: false, skipped: true, reason: 'missing_api_base' };
  const res = await fetch(`${base}/api/video-consult/vision/capture-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type: eventType,
      payload: payload || {},
      actor,
      idempotency_key: idempotencyKey || null
    }),
    credentials: 'omit',
    signal
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || `Vision capture event failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function fetchVisionSessionState({ apiBase, sessionId, signal }) {
  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base || !sessionId) return { success: false, skipped: true };
  const res = await fetch(`${base}/api/video-consult/vision/session/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    signal
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || `Vision session state failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function incrementVisionMetric({ apiBase, sessionId, metricName, signal }) {
  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base || !sessionId || !metricName) return { success: false, skipped: true };
  const res = await fetch(`${base}/api/video-consult/vision/metrics/inc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      metric_name: metricName
    }),
    credentials: 'omit',
    signal
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || `Vision metric increment failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
