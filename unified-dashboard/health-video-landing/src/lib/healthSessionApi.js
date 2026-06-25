const apiBase = () => (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '') || '';

function url(path) {
  const base = apiBase();
  return base ? `${base}${path}` : path;
}

export async function startSession({
  terms_accepted,
  locale,
  reply_language,
  terms_version,
  display_name,
  metadata
}) {
  const res = await fetch(url('/api/health-session/start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      terms_accepted,
      locale,
      reply_language,
      terms_version,
      display_name,
      metadata
    })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Start failed');
  return data;
}

export async function sendTurn(sessionId, text) {
  const res = await fetch(url(`/api/health-session/${sessionId}/turn`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Turn failed');
  return data;
}

export async function endSession(sessionId, sessionToken) {
  const res = await fetch(url(`/api/health-session/${sessionId}/end`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-health-session-token': sessionToken
    },
    body: JSON.stringify({ session_token: sessionToken })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'End failed');
  return data;
}

export async function fetchReport(sessionId, sessionToken) {
  const res = await fetch(url(`/api/health-session/${sessionId}/report`), {
    headers: { 'x-health-session-token': sessionToken }
  });
  const data = await res.json();
  return data.report || null;
}

export function resolveSseUrl(sseUrl) {
  if (!sseUrl) return null;
  if (sseUrl.startsWith('http')) return sseUrl;
  return url(sseUrl);
}
