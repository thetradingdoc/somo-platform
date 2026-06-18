/**
 * Shared provider portal API helpers — single fetch layer for business pages.
 */
(function (global) {
  const API_BASE = () =>
    (typeof resolveApiBase === 'function'
      ? resolveApiBase()
      : (global.API_BASE || global.location?.origin || 'http://localhost:4000')
    ).replace(/\/$/, '');

  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (typeof global.getAuthHeaders === 'function') {
      return { ...h, ...global.getAuthHeaders() };
    }
    return h;
  }

  async function apiGet(path) {
    const res = await fetch(`${API_BASE()}${path}`, {
      credentials: 'include',
      headers: authHeaders()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || json.message || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async function apiPost(path, body) {
    const res = await fetch(`${API_BASE()}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify(body || {})
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || json.message || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async function apiPatch(path, body) {
    const res = await fetch(`${API_BASE()}${path}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify(body || {})
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || json.message || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  global.ppApi = {
    base: API_BASE,
    get: apiGet,
    post: apiPost,
    patch: apiPatch
  };
})(typeof window !== 'undefined' ? window : global);
