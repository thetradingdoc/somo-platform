const PREFIX = 'hv_';
const TERMS_VERSION = '2026-06-25';

export function getStoredSession() {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}session`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(data) {
  sessionStorage.setItem(`${PREFIX}session`, JSON.stringify(data));
}

export function clearSession() {
  sessionStorage.removeItem(`${PREFIX}session`);
  sessionStorage.removeItem(`${PREFIX}report`);
  sessionStorage.removeItem(`${PREFIX}consent`);
  sessionStorage.removeItem(`${PREFIX}journey`);
  sessionStorage.removeItem(`${PREFIX}photo_consent`);
}

export function getJourney() {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}journey`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveJourney(data) {
  sessionStorage.setItem(`${PREFIX}journey`, JSON.stringify(data));
}

export function updateJourney(patch) {
  const current = getJourney() || {};
  saveJourney({ ...current, ...patch });
}

export function hasJourneyStarted() {
  const j = getJourney();
  return !!(j?.locale && j?.terms_accepted);
}

export function getConsent() {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}consent`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveConsent(data) {
  sessionStorage.setItem(`${PREFIX}consent`, JSON.stringify(data));
}

export function saveReport(report) {
  sessionStorage.setItem(`${PREFIX}report`, JSON.stringify(report));
}

export function getReport() {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}report`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setPhotoAnalysisConsent(version = TERMS_VERSION) {
  sessionStorage.setItem(`${PREFIX}photo_consent`, version);
}

export function hasPhotoAnalysisConsent() {
  return !!sessionStorage.getItem(`${PREFIX}photo_consent`);
}

export { TERMS_VERSION };
