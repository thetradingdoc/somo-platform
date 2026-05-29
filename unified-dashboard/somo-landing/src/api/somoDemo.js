const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export const USE_CASES = [
  { id: 'receptionist', label: 'Receptionist' },
  { id: 'appointment_setter', label: 'Appointment Setter' },
  { id: 'lead_qualification', label: 'Lead Qualification' },
  { id: 'customer_service', label: 'Customer Service' },
  { id: 'debt_collection', label: 'Debt Collection' },
  { id: 'survey', label: 'Survey' }
];

export async function requestDemoCall({ name, phone, use_case, consent }) {
  const base = API_BASE || '';
  const res = await fetch(`${base}/api/public/dodgecall/request-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone, use_case, consent })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

const SIGNUP_PREFILL_KEY = 'somo_signup_prefill';

/** Persist demo fields for signup wizard prefill (same origin as /signup). */
export function saveSignupPrefill({ name, phone, use_case }) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(
      SIGNUP_PREFILL_KEY,
      JSON.stringify({
        name: name || '',
        phone: phone || '',
        use_case: use_case || ''
      })
    );
  } catch (_) {
    /* ignore */
  }
}

export function signupUrl() {
  return import.meta.env.VITE_SIGNUP_URL || '/signup?utm_source=somo';
}
