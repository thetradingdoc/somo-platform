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
