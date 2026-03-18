import { patientSession } from './patient-session.js';

const DEFAULT_BASE = window.API_BASE || 'http://localhost:4000';

export const patientApi = {
  baseUrl: DEFAULT_BASE,
  async request(path, options = {}) {
    const sessionId = patientSession.getSessionId();
    const journeyId = patientSession.getJourneyId();
    const headers = {
      'ngrok-skip-browser-warning': 'true',
      ...(options.headers || {})
    };
    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    if (sessionId) headers['x-session-id'] = sessionId;
    if (journeyId) headers['x-journey-id'] = journeyId;

    const method = (options.method || 'GET').toUpperCase();
    const isGet = method === 'GET';
    const canRetry = isGet || (headers['idempotency-key'] || headers['Idempotency-Key']);
    const maxAttempts = canRetry ? (isGet ? 3 : 2) : 1;

    let lastErr = null;
    let res = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          ...options,
          headers
        });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 250 * attempt));
          continue;
        }
      }
    }
    if (lastErr) return { success: false, error: 'Network error. Please try again.' };

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      // ignore
    }

    if (res.status === 401) {
      patientSession.clear();
      window.location.href = 'patient-login.html';
      return { success: false, error: 'Session expired' };
    }

    if (!res.ok && data && data.error) return data;
    if (!res.ok) return { success: false, error: `Request failed (${res.status})` };
    return data || { success: true };
  },

  getAppointments() {
    return this.request('/api/patient/appointments', { method: 'GET' });
  },
  rescheduleAppointment(id, new_date, new_time, idempotencyKey) {
    return this.request(`/api/patient/appointments/${encodeURIComponent(id)}/reschedule`, {
      method: 'PUT',
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
      body: JSON.stringify({ new_date, new_time })
    });
  },
  cancelAppointment(id, reason, idempotencyKey) {
    return this.request(`/api/patient/appointments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
      body: JSON.stringify({ reason: reason || '' })
    });
  },
  getReceipts() {
    return this.request('/api/patient/receipts', { method: 'GET' });
  }
};

