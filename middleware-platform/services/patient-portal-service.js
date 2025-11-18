/**
 * Patient Portal Service
 * 
 * Handles patient self-service functionality:
 * - Email verification for login
 * - Session management
 * - Patient appointment management
 */

const db = require('../database');
const { v4: uuidv4 } = require('uuid');
const EmailService = require('./email-service');

class PatientPortalService {
  /**
   * Send verification code to patient email
   * @param {string} email - Patient email address
   * @returns {Object} Session ID and success status
   */
  async sendVerificationCode(email) {
    if (!email) {
      return { success: false, error: 'Email address required' };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: 'Invalid email format' };
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Create or update session
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    try {
      // Check if session exists for this email
      const existing = db.db.prepare(`
        SELECT id FROM patient_portal_sessions 
        WHERE email = ? AND verified = 0 AND datetime(expires_at) > datetime('now')
      `).get(normalizedEmail);

      if (existing) {
        // Update existing session
        db.db.prepare(`
          UPDATE patient_portal_sessions 
          SET verification_code = ?, expires_at = ?, created_at = datetime('now')
          WHERE id = ?
        `).run(verificationCode, expiresAt.toISOString(), existing.id);

        // Send email
        await this._sendEmail(normalizedEmail, verificationCode);

        return {
          success: true,
          session_id: existing.id,
          message: 'Verification code sent to your email'
        };
      } else {
        // Create new session
        db.db.prepare(`
          INSERT INTO patient_portal_sessions 
          (id, email, verification_code, expires_at, verified)
          VALUES (?, ?, ?, ?, 0)
        `).run(sessionId, normalizedEmail, verificationCode, expiresAt.toISOString());

        // Send email
        await this._sendEmail(normalizedEmail, verificationCode);

        return {
          success: true,
          session_id: sessionId,
          message: 'Verification code sent to your email'
        };
      }
    } catch (error) {
      console.error('Error sending verification code:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify code and create authenticated session
   * @param {string} email - Patient email address
   * @param {string} code - Verification code
   * @returns {Object} Session info and patient data
   */
  verifyCode(email, code) {
    if (!email || !code) {
      return { success: false, error: 'Email and code required' };
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return { success: false, error: 'Invalid email format' };
    }

    try {
      // Find valid session
      const session = db.db.prepare(`
        SELECT * FROM patient_portal_sessions 
        WHERE email = ? 
          AND verification_code = ? 
          AND verified = 0 
          AND datetime(expires_at) > datetime('now')
      `).get(normalizedEmail, code);

      if (!session) {
        return { success: false, error: 'Invalid or expired verification code' };
      }

      // Mark session as verified
      db.db.prepare(`
        UPDATE patient_portal_sessions 
        SET verified = 1, verified_at = datetime('now')
        WHERE id = ?
      `).run(session.id);

      // Find patient by email
      const patient = db.getFHIRPatientByEmail(normalizedEmail);

      return {
        success: true,
        session_id: session.id,
        patient_id: patient ? patient.resource_id : null,
        email: normalizedEmail
      };
    } catch (error) {
      console.error('Error verifying code:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get patient appointments
   * @param {string} sessionId - Valid session ID
   * @returns {Array} Patient appointments
   */
  getPatientAppointments(sessionId) {
    try {
      const session = db.db.prepare(`
        SELECT * FROM patient_portal_sessions 
        WHERE id = ? AND verified = 1
      `).get(sessionId);

      if (!session) {
        return { success: false, error: 'Invalid or expired session' };
      }

      // Get appointments by email or phone
      let appointments = [];
      if (session.email) {
        // Try to find patient by email first
        const patient = db.getFHIRPatientByEmail(session.email);
        if (patient) {
          const patientId = patient.resource_id;
          appointments = db.db.prepare(`
            SELECT * FROM appointments 
            WHERE patient_id = ? 
            ORDER BY date DESC, time DESC
            LIMIT 50
          `).all(patientId);
        }
      }

      // Fallback to phone if no appointments found
      if (appointments.length === 0 && session.phone) {
        appointments = db.db.prepare(`
          SELECT * FROM appointments 
          WHERE patient_phone = ? 
          ORDER BY date DESC, time DESC
          LIMIT 50
        `).all(session.phone);
      }

      return {
        success: true,
        appointments: appointments.map(apt => ({
          id: apt.id,
          patient_name: apt.patient_name,
          appointment_type: apt.appointment_type,
          date: apt.date,
          time: apt.time,
          status: apt.status,
          datetime_display: this._formatDateTime(apt.date, apt.time),
          can_reschedule: ['scheduled', 'confirmed'].includes(apt.status),
          can_cancel: ['scheduled', 'confirmed'].includes(apt.status)
        }))
      };
    } catch (error) {
      console.error('Error getting patient appointments:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Validate session
   * @param {string} sessionId - Session ID
   * @returns {Object} Session validity and patient info
   */
  validateSession(sessionId) {
    try {
      const session = db.db.prepare(`
        SELECT * FROM patient_portal_sessions 
        WHERE id = ? AND verified = 1
      `).get(sessionId);

      if (!session) {
        return { success: false, valid: false, error: 'Invalid session' };
      }

      // Check if session is still valid (24 hours)
      const sessionAge = new Date() - new Date(session.verified_at);
      if (sessionAge > 24 * 60 * 60 * 1000) {
        return { success: false, valid: false, error: 'Session expired' };
      }

      return {
        success: true,
        valid: true,
        email: session.email,
        phone: session.phone,
        patient_id: session.patient_id
      };
    } catch (error) {
      return { success: false, valid: false, error: error.message };
    }
  }

  /**
   * Get patient profile
   * @param {string} sessionId - Valid session ID
   * @returns {Object} Patient profile data
   */
  getPatientProfile(sessionId) {
    try {
      const session = this.validateSession(sessionId);
      if (!session.valid) {
        return { success: false, error: 'Invalid session' };
      }

      // Get patient from FHIR (by email or phone)
      let patient = null;
      if (session.email) {
        patient = db.getFHIRPatientByEmail(session.email);
      }
      if (!patient && session.phone) {
        patient = db.getFHIRPatientByPhone(session.phone);
      }
      if (!patient) {
        return { success: false, error: 'Patient not found' };
      }

      const patientData = JSON.parse(patient.resource_data);
      const nameObj = (patientData.name && patientData.name[0]) || {};
      const telecom = patientData.telecom || [];
      const phone = (telecom.find(t => t.system === 'phone') || {}).value || '';
      const email = (telecom.find(t => t.system === 'email') || {}).value || '';
      const addr = (patientData.address && patientData.address[0]) || {};

      return {
        success: true,
        profile: {
          name: `${(nameObj.given || [''])[0]} ${nameObj.family || ''}`.trim(),
          phone: phone,
          email: email,
          birth_date: patientData.birthDate || null,
          address: {
            line: addr.line && addr.line[0] || '',
            city: addr.city || '',
            state: addr.state || '',
            postal_code: addr.postalCode || ''
          }
        }
      };
    } catch (error) {
      console.error('Error getting patient profile:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email with verification code
   * @private
   */
  async _sendEmail(email, code) {
    try {
      await EmailService.sendPatientVerificationCode(email, code);
      console.log(`📧 Verification code sent to ${email}: ${code}`);
    } catch (error) {
      console.warn('⚠️  Could not send email, code is:', code);
      // Still return success - code is logged in console for development
    }
  }

  /**
   * Format date and time for display
   * @private
   */
  _formatDateTime(date, time) {
    try {
      const dateObj = new Date(`${date}T${time}`);
      return dateObj.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return `${date} at ${time}`;
    }
  }
}

module.exports = new PatientPortalService();

