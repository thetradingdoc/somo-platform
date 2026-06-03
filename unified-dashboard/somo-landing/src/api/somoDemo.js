const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export const USE_CASES = [
  { id: 'dental_front_desk', label: 'Dental', tier: 'light', icon: 'specialties' },
  { id: 'medical_clinic', label: 'Medical', tier: 'medium', icon: 'appointments' },
  { id: 'specialty_practice', label: 'Specialty', tier: 'dark', icon: 'specialties' }
];

export async function requestDemoCall({
  name,
  phone,
  use_case,
  consent,
  practice_specialty,
  questions_asked
}) {
  const base = API_BASE || '';
  const body = { name, phone, consent };
  if (use_case) body.use_case = use_case;
  if (practice_specialty) body.practice_specialty = practice_specialty;
  if (questions_asked) body.questions_asked = questions_asked;

  const res = await fetch(`${base}/api/public/somo-demo/request-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

const SIGNUP_PREFILL_KEY = 'somo_signup_prefill';

/** Persist demo fields for signup wizard prefill (same origin as /signup). */
export function saveSignupPrefill({ name, phone, use_case, practice_specialty }) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(
      SIGNUP_PREFILL_KEY,
      JSON.stringify({
        name: name || '',
        phone: phone || '',
        use_case: use_case || '',
        practice_specialty: practice_specialty || ''
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
