import { API_BASE_URL } from '@/config';
import { getPatientSessionId } from '@/lib/patient-session';

const API_HEADERS: HeadersInit = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
};

async function withSessionHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const sid = await getPatientSessionId();
  if (!sid) throw new Error('Sign in required.');
  return { ...API_HEADERS, ...extra, 'x-session-id': sid };
}

async function parseJson(res: Response) {
  return res.json().catch(() => ({}));
}

export async function patientGet(path: string) {
  const headers = await withSessionHeaders();
  const res = await fetch(`${API_BASE_URL}${path}`, { headers });
  const data = await parseJson(res);
  if (!res.ok || !data?.success) throw new Error(data?.error || 'Request failed');
  return data;
}

export async function patientPost(path: string, body: unknown) {
  const headers = await withSessionHeaders();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const data = await parseJson(res);
  if (!res.ok || !data?.success) throw new Error(data?.error || 'Request failed');
  return data;
}
