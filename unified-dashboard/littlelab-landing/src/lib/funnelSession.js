const PREFIX = 'sc_';

export function getApiBase() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('api');
  const stored = sessionStorage.getItem(`${PREFIX}api_base`);
  const origin = window.location.origin;
  try {
    const u = new URL(origin);
    const local =
      u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    const resolved =
      local && u.port === '4000'
        ? origin.replace(/\/$/, '')
        : local
          ? `${u.protocol}//${u.hostname}:4000`.replace(/\/$/, '')
          : origin;
    if (!fromQuery && stored && stored !== resolved) sessionStorage.removeItem(`${PREFIX}api_base`);
    const base = (fromQuery || sessionStorage.getItem(`${PREFIX}api_base`) || resolved).replace(/\/$/, '');
    if (fromQuery) sessionStorage.setItem(`${PREFIX}api_base`, base);
    return base;
  } catch (_) {
    return origin.replace(/\/$/, '');
  }
}

export function getConfirmedAge() {
  const raw = sessionStorage.getItem(`${PREFIX}confirmed_age`);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function setConfirmedAge(n) {
  sessionStorage.setItem(`${PREFIX}confirmed_age`, String(n));
}

export function setFaceRead(payload) {
  sessionStorage.setItem(`${PREFIX}face_read`, JSON.stringify(payload || null));
}

export function getFaceRead() {
  const raw = sessionStorage.getItem(`${PREFIX}face_read`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function getZip() {
  return sessionStorage.getItem(`${PREFIX}zip`) || '';
}

export function setZip(zip) {
  const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
  if (z) sessionStorage.setItem(`${PREFIX}zip`, z);
  else sessionStorage.removeItem(`${PREFIX}zip`);
}

export function clearZip() {
  sessionStorage.removeItem(`${PREFIX}zip`);
}

export function getMatchResult() {
  const raw = sessionStorage.getItem(`${PREFIX}match_json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function setMatchResult(match) {
  if (match) sessionStorage.setItem(`${PREFIX}match_json`, JSON.stringify(match));
  else sessionStorage.removeItem(`${PREFIX}match_json`);
}

export function getInquiry() {
  return sessionStorage.getItem(`${PREFIX}inquiry`) || '';
}

export function setInquiry(text) {
  const t = String(text || '').trim();
  if (t) sessionStorage.setItem(`${PREFIX}inquiry`, t);
  else sessionStorage.removeItem(`${PREFIX}inquiry`);
}

export function hasCompletedAgeFlow() {
  return getConfirmedAge() != null;
}

export function getConcernId() {
  return sessionStorage.getItem(`${PREFIX}concern_id`) || '';
}

export function setConcernId(id) {
  if (id) sessionStorage.setItem(`${PREFIX}concern_id`, String(id));
  else sessionStorage.removeItem(`${PREFIX}concern_id`);
}

export function getPreviewCache() {
  const raw = sessionStorage.getItem(`${PREFIX}preview_json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function setPreviewCache(preview) {
  if (preview) sessionStorage.setItem(`${PREFIX}preview_json`, JSON.stringify(preview));
  else sessionStorage.removeItem(`${PREFIX}preview_json`);
}

export function getPatientSessionId() {
  return sessionStorage.getItem(`${PREFIX}patient_session_id`) || '';
}

export function setPatientSessionId(sessionId) {
  if (sessionId) sessionStorage.setItem(`${PREFIX}patient_session_id`, String(sessionId));
  else sessionStorage.removeItem(`${PREFIX}patient_session_id`);
}

/** Mirror patient-login localStorage for web surfaces after funnel signup */
export function syncPatientSessionToLocalStorage(sessionId) {
  if (sessionId) {
    try {
      localStorage.setItem('patient_session_id', String(sessionId));
    } catch (_) {}
  }
}

/** Goals used in match API (intent: track + find specialist; upsell adds both). */
const MATCH_USER_GOALS = new Set(['track_program', 'find_specialist', 'both']);

export function getUserGoal() {
  const g = sessionStorage.getItem(`${PREFIX}user_goal`) || '';
  if (g === 'anti_aging') return 'track_program';
  if (MATCH_USER_GOALS.has(g)) return g;
  return 'track_program';
}

export function setUserGoal(goal) {
  let g = String(goal || '').trim();
  if (g === 'anti_aging') g = 'track_program';
  if (MATCH_USER_GOALS.has(g)) sessionStorage.setItem(`${PREFIX}user_goal`, g);
  else sessionStorage.removeItem(`${PREFIX}user_goal`);
}

export function getSpecialistUpsell() {
  return sessionStorage.getItem(`${PREFIX}specialist_upsell`) === '1';
}

export function setSpecialistUpsell(on) {
  if (on) sessionStorage.setItem(`${PREFIX}specialist_upsell`, '1');
  else sessionStorage.removeItem(`${PREFIX}specialist_upsell`);
}

export function getClarifyAnswers() {
  const raw = sessionStorage.getItem(`${PREFIX}clarify_answers`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function setClarifyAnswers(answers) {
  if (answers && typeof answers === 'object') {
    sessionStorage.setItem(`${PREFIX}clarify_answers`, JSON.stringify(answers));
  } else {
    sessionStorage.removeItem(`${PREFIX}clarify_answers`);
  }
}

/** Clear match/clarify/plan draft when user goes back to change goal or concern. */
export function clearMatchDraftState() {
  sessionStorage.removeItem(`${PREFIX}match_json`);
  sessionStorage.removeItem(`${PREFIX}concern_id`);
  sessionStorage.removeItem(`${PREFIX}clarify_answers`);
  sessionStorage.removeItem(`${PREFIX}preview_json`);
  sessionStorage.removeItem(`${PREFIX}concern_chips`);
  sessionStorage.removeItem(`${PREFIX}kelly_session_id`);
  sessionStorage.removeItem(`${PREFIX}intake_proposal`);
}

export function getConcernChips() {
  const raw = sessionStorage.getItem(`${PREFIX}concern_chips`);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((id) => typeof id === 'string' && id) : [];
  } catch (_) {
    return [];
  }
}

export function setConcernChips(ids) {
  const list = Array.isArray(ids) ? ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (list.length) sessionStorage.setItem(`${PREFIX}concern_chips`, JSON.stringify(list));
  else sessionStorage.removeItem(`${PREFIX}concern_chips`);
}

export function getKellySessionId() {
  return sessionStorage.getItem(`${PREFIX}kelly_session_id`) || '';
}

export function setKellySessionId(id) {
  if (id) sessionStorage.setItem(`${PREFIX}kelly_session_id`, String(id));
  else sessionStorage.removeItem(`${PREFIX}kelly_session_id`);
}

export function getFunnelIntakeProposal() {
  const raw = sessionStorage.getItem(`${PREFIX}intake_proposal`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function setFunnelIntakeProposal(proposal) {
  if (proposal && typeof proposal === 'object') {
    sessionStorage.setItem(`${PREFIX}intake_proposal`, JSON.stringify(proposal));
  } else {
    sessionStorage.removeItem(`${PREFIX}intake_proposal`);
  }
}
