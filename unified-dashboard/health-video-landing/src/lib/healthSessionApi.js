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

export async function sendTurn(sessionId, text, sessionToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers['x-health-session-token'] = sessionToken;
  const res = await fetch(url(`/api/health-session/${sessionId}/turn`), {
    method: 'POST',
    headers,
    body: JSON.stringify({ text, source: 'ui_turn' })
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error || 'Turn failed');
    err.code = data.code;
    throw err;
  }
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

function authHeaders(sessionToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers['x-health-session-token'] = sessionToken;
  return headers;
}

export async function fetchRouting(sessionId, sessionToken) {
  const res = await fetch(url(`/api/health-session/${sessionId}/routing`), {
    headers: authHeaders(sessionToken)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Routing fetch failed');
  return data.routing;
}

export async function requestEligibilityQuote(sessionId, sessionToken, body = {}) {
  const res = await fetch(url(`/api/health-session/${sessionId}/eligibility`), {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Eligibility failed');
  return data.routing;
}

export async function startCopayRoute(sessionId, sessionToken, body = {}) {
  const res = await fetch(url(`/api/health-session/${sessionId}/route`), {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Route failed');
  return data.routing;
}

export async function mockPayCopay(sessionId, sessionToken) {
  const res = await fetch(url(`/api/health-session/${sessionId}/pay/mock`), {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify({})
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Mock pay failed');
  return data.routing;
}
