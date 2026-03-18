/**
 * Telemedicine JWT issuer endpoints.
 * Issues short-lived JWTs for patients and clinicians so they can call FHIR/DiagnosticReport APIs.
 *
 * POST /api/auth/patient-token
 * Body: { email, code? , patient_id? }
 * - Intended to be called after /api/patient/verify/confirm has succeeded.
 *
 * POST /api/auth/clinician-token
 * Body: { email, password }
 * - Wraps existing admin/clinician login to return a JWT with scope=clinician.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const db = require('../database');
const PatientPortalService = require('../services/patient-portal-service');

// Reuse the same JWT secret and semantics as jwt-fhir-auth
const { JWT_SECRET } = require('../middleware/jwt-fhir-auth');

function ensureJwtSecret(res) {
  if (!JWT_SECRET) {
    res.status(500).json({ success: false, error: 'JWT not configured on server' });
    return false;
  }
  return true;
}

// Patient token: email + code OR patient_id (when already verified via session)
router.post('/patient-token', async (req, res) => {
  try {
    if (!ensureJwtSecret(res)) return;
    const { email, code, patient_id } = req.body || {};

    let patientId = patient_id || null;

    // If email+code provided, verify using existing PatientPortalService
    if (!patientId && email && code) {
      const verification = PatientPortalService.verifyCode(email, code);
      if (!verification || !verification.success || !verification.patient_id) {
        return res.status(401).json({ success: false, error: 'Invalid or expired verification code' });
      }
      patientId = verification.patient_id;
    }

    // Fallback: resolve by email if already verified upstream
    if (!patientId && email) {
      const patient = db.getFHIRPatientByEmail && db.getFHIRPatientByEmail(email.trim());
      if (patient) {
        patientId = patient.resource_id;
      }
    }

    if (!patientId) {
      return res.status(400).json({ success: false, error: 'Unable to resolve patient_id' });
    }

    const token = jwt.sign(
      {
        sub: patientId,
        scope: 'patient',
        scopes: [
          'openid',
          'fhirUser',
          'patient/Patient.read',
          'patient/Appointment.read',
          'patient/Encounter.read',
          'patient/DocumentReference.read',
          'patient/DiagnosticReport.read',
          'patient/Binary.read',
          'patient/Provenance.read',
          'patient/Consent.read'
        ]
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.json({
      success: true,
      token,
      patient_id: patientId,
      expires_in: 3600
    });
  } catch (error) {
    console.error('[auth-tokens] patient-token error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Clinician token: wrap existing user login
router.post('/clinician-token', async (req, res) => {
  try {
    if (!ensureJwtSecret(res)) return;
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const user = db.getUserByEmail && db.getUserByEmail(email.trim());
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Password check: reuse bcrypt if available
    let bcrypt;
    try {
      bcrypt = require('bcryptjs');
    } catch (_) {
      bcrypt = null;
    }

    if (bcrypt && user.password_hash) {
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      }
    } else if (user.password && password !== user.password) {
      // Legacy/demo fallback: plain-text password (should not be used in production)
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const clinicId = user.clinic_id || null;
    const token = jwt.sign(
      {
        sub: user.id,
        scope: 'clinician',
        clinic_id: clinicId,
        scopes: [
          'openid',
          'fhirUser',
          'user/*.*',
          'patient/Patient.read',
          'patient/Encounter.read',
          'patient/DocumentReference.read',
          'patient/DiagnosticReport.read',
          'patient/Binary.read',
          'patient/Provenance.read',
          'patient/Consent.read'
        ]
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      success: true,
      token,
      user_id: user.id,
      clinic_id: clinicId,
      expires_in: 8 * 60 * 60
    });
  } catch (error) {
    console.error('[auth-tokens] clinician-token error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

