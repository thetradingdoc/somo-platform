const db = require('../database');
const PatientPortalService = require('../services/patient-portal-service');

describe('PatientPortalService.verifyCode', () => {
  test('verifies code and creates patient_session mapping', () => {
    const email = 'test@example.com';
    const normalized = email.toLowerCase();
    const code = '123456';

    db.db.prepare(`DELETE FROM patient_portal_sessions WHERE email = ?`).run(normalized);
    db.db.prepare(`DELETE FROM patient_sessions WHERE email = ?`).run(normalized);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const sessionId = 'portal-session-1';
    db.db.prepare(`
      INSERT INTO patient_portal_sessions (id, email, verification_code, expires_at, verified)
      VALUES (?, ?, ?, ?, 0)
    `).run(sessionId, normalized, code, expiresAt);

    const result = PatientPortalService.verifyCode(email, code);
    expect(result.success).toBe(true);
    expect(result.session_id).toBe(sessionId);

    const ps = db.getPatientSession && db.getPatientSession(sessionId);
    expect(ps).not.toBeNull();
    expect(ps.email).toBe(normalized);
  });
});


