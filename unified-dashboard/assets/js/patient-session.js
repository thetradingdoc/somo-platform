export const patientSession = {
  getSessionId() {
    return localStorage.getItem('patient_session_id') || '';
  },
  getJourneyId() {
    let jid = sessionStorage.getItem('patient_journey_id') || '';
    if (!jid) {
      jid = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
      sessionStorage.setItem('patient_journey_id', jid);
    }
    return jid;
  },
  requireSessionOrRedirect() {
    const sid = this.getSessionId();
    if (!sid) {
      window.location.href = 'patient-login.html';
      return '';
    }
    return sid;
  },
  clear() {
    localStorage.removeItem('patient_session_id');
    // Legacy cleanup (mvp-37): patient_email/patient_phone should not be stored in the browser.
    localStorage.removeItem('patient_email');
    localStorage.removeItem('patient_phone');
    sessionStorage.removeItem('patient_journey_id');
  }
};

