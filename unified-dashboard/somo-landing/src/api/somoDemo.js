const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export const USE_CASES = [
  { id: 'dental_front_desk', label: 'Dental', tier: 'light', icon: 'specialties' },
  { id: 'medical_clinic', label: 'Medical', tier: 'medium', icon: 'appointments' },
  { id: 'specialty_practice', label: 'Specialty', tier: 'dark', icon: 'specialties' },
  { id: 'bilingual_front_desk', label: 'Bilingual', tier: 'light', icon: 'multilingual' },
  { id: 'after_hours', label: 'After-hours', tier: 'medium', icon: 'after_hours' },
  { id: 'patient_billing', label: 'Billing', tier: 'dark', icon: 'rcm' }
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

/** Same-origin signup wizard — never the login page. */
export function signupUrl(tier) {
  const params = new URLSearchParams({ utm_source: 'somo' });
  if (tier) params.set('tier', tier);
  return `/signup?${params.toString()}`;
}

/** Provider login for returning customers. */
export function loginUrl() {
  return '/login?utm_source=somo';
}
