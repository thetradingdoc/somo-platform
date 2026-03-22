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
  async sendVerificationCode(email, reqMeta = {}) {
    if (!email) {
      return { success: false, error: 'Email address required' };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: 'Invalid email format' };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const ip = (reqMeta.ip || '').toString();
    const ua = (reqMeta.userAgent || '').toString();
    const existingPatient = (() => {
      try { return db.getFHIRPatientByEmail(normalizedEmail); } catch (_) { return null; }
    })();

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
          SET verification_code = ?, expires_at = ?, created_at = datetime('now'),
              ip_address = ?, user_agent = ?, failed_attempts = 0, locked_until = NULL
          WHERE id = ?
        `).run(verificationCode, expiresAt.toISOString(), ip || null, ua || null, existing.id);

        // Send email
        await this._sendEmail(normalizedEmail, verificationCode);

        return {
          success: true,
          session_id: existing.id,
          message: 'Verification code sent to your email',
          existing_patient: !!existingPatient
        };
      } else {
        // Create new session
        db.db.prepare(`
          INSERT INTO patient_portal_sessions 
          (id, email, verification_code, expires_at, verified, ip_address, user_agent, failed_attempts, locked_until)
          VALUES (?, ?, ?, ?, 0, ?, ?, 0, NULL)
        `).run(sessionId, normalizedEmail, verificationCode, expiresAt.toISOString(), ip || null, ua || null);

        // Send email
        await this._sendEmail(normalizedEmail, verificationCode);

        return {
          success: true,
          session_id: sessionId,
          message: 'Verification code sent to your email',
          existing_patient: !!existingPatient
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
   * @param {string} merchantId - Optional merchant_id for tenant-scoped login
   * @returns {Object} Session info and patient data
   */
  verifyCode(email, code, merchantId = null) {
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
      // Soft lock: check for locked sessions for this email
      const lockRow = db.db.prepare(`
        SELECT locked_until FROM patient_portal_sessions
        WHERE email = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(normalizedEmail);
      if (lockRow && lockRow.locked_until && new Date(lockRow.locked_until) > new Date()) {
        console.log('[PatientPortal] 🔒 Soft lock active for email', { email: normalizedEmail });
        return { success: false, error: 'Too many invalid codes. Please wait a few minutes before trying again.' };
      }

      // Find valid session for this email + code
      const session = db.db.prepare(`
        SELECT * FROM patient_portal_sessions 
        WHERE email = ? 
          AND verified = 0 
          AND datetime(expires_at) > datetime('now')
        ORDER BY created_at DESC
        LIMIT 1
      `).get(normalizedEmail);

      if (!session || session.verification_code !== code) {
        // Increment failed_attempts and possibly set locked_until
        if (session) {
          const now = new Date();
          const tooMany = (session.failed_attempts || 0) + 1 >= 5;
          const lockedUntil = tooMany
            ? new Date(now.getTime() + 5 * 60 * 1000).toISOString() // 5 minutes lock
            : session.locked_until;
          db.db.prepare(`
            UPDATE patient_portal_sessions
            SET failed_attempts = failed_attempts + 1,
                locked_until = COALESCE(?, locked_until)
            WHERE id = ?
          `).run(lockedUntil || null, session.id);
        }
        console.log('[PatientPortal] ❌ Invalid or expired verification code', {
          email: normalizedEmail,
          merchant_id: merchantId || null
        });
        return { success: false, error: 'Invalid or expired verification code' };
      }

      // Mark session as verified
      db.db.prepare(`
        UPDATE patient_portal_sessions 
        SET verified = 1, verified_at = datetime('now')
        WHERE id = ?
      `).run(session.id);

      // Find patient by email (filter by merchant_id if provided)
      let patient = db.getFHIRPatientByEmail(normalizedEmail);
      let created_patient = false;

      // If no patient exists yet, treat this as "Create account" and create a minimal FHIR Patient.
      if (!patient && db.createFHIRPatient) {
        try {
          const id = uuidv4();
          const patientResource = {
            resourceType: 'Patient',
            id,
            active: true,
            telecom: [
              { system: 'email', value: normalizedEmail, use: 'home' }
            ],
            meta: {
              lastUpdated: new Date().toISOString()
            },
            merchant_id: merchantId || null
          };
          db.createFHIRPatient(patientResource);
          patient = db.getFHIRPatientByEmail(normalizedEmail);
          created_patient = !!patient;
        } catch (e) {
          console.warn('[PatientPortal] ⚠️  Failed to auto-create patient:', e.message);
        }
      }

      // If merchantId provided, ensure patient belongs to that tenant
      if (patient && merchantId && patient.merchant_id && patient.merchant_id !== merchantId) {
        // Patient exists but belongs to different tenant
        // For multi-tenant, we might want to create a new patient record
        // For now, return error
        return {
          success: false,
          error: 'Patient not found for this tenant. Please contact support.'
        };
      }

      const patientId = patient ? patient.resource_id : null;

      // Canonical identity mapping (mvp-49): persist resolved patient_id onto the session row.
      try {
        if (patientId) {
          db.db.prepare(`
            UPDATE patient_portal_sessions
            SET patient_id = COALESCE(patient_id, ?)
            WHERE id = ?
          `).run(patientId, session.id);
        }
      } catch (_) {}

      // Create or update persistent patient_sessions mapping (email → patient_id)
      try {
        const longLivedExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        const existingPatientSession = db.getPatientSession && db.getPatientSession(session.id);
        if (!existingPatientSession) {
          if (db.createPatientSession) {
            db.createPatientSession({
              session_id: session.id,
              email: normalizedEmail,
              patient_id: patientId,
              expires_at: longLivedExpires.toISOString()
            });
          }
        } else if (db.updatePatientSession) {
          db.updatePatientSession(session.id, {
            email: normalizedEmail,
            patient_id: patientId,
            expires_at: existingPatientSession.expires_at || longLivedExpires.toISOString()
          });
        }
        console.log('[PatientPortal] 🪪 Session verified + mapped', {
          session_id: session.id,
          email: normalizedEmail,
          patient_id: patientId || null
        });
      } catch (e) {
        console.warn('⚠️  Failed to upsert patient_sessions mapping:', e.message);
      }

      return {
        success: true,
        session_id: session.id,
        patient_id: patientId,
        email: normalizedEmail,
        merchant_id: merchantId || (patient ? patient.merchant_id : null),
        created_patient
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
      const normEmail = (session.email || '').toLowerCase().trim();

      if (normEmail) {
        // 1) FHIR patient_id (appointments linked to longitudinal patient record)
        const patient = db.getFHIRPatientByEmail(normEmail);
        if (patient) {
          const patientId = patient.resource_id;
          const byPatientId = db.db.prepare(`
            SELECT * FROM appointments WHERE patient_id = ?
          `).all(patientId);
          const byEmail = db.db.prepare(`
            SELECT * FROM appointments WHERE LOWER(TRIM(patient_email)) = ?
          `).all(normEmail);
          const seen = new Set();
          for (const a of [...byPatientId, ...byEmail]) {
            if (!seen.has(a.id)) {
              seen.add(a.id);
              appointments.push(a);
            }
          }
          appointments.sort((a, b) => {
            const da = `${a.date || ''} ${a.time || ''}`;
            const dbVal = `${b.date || ''} ${b.time || ''}`;
            return dbVal.localeCompare(da);
          });
          appointments = appointments.slice(0, 50);
        } else {
          // 2) No FHIR patient: use patient_email only
          appointments = db.db.prepare(`
            SELECT * FROM appointments 
            WHERE LOWER(TRIM(patient_email)) = ? 
            ORDER BY date DESC, time DESC
            LIMIT 50
          `).all(normEmail);
        }
      }

      // 3) Fallback to phone if session has phone (e.g. future session enhancements)
      if (appointments.length === 0 && session.phone) {
        appointments = db.db.prepare(`
          SELECT * FROM appointments 
          WHERE patient_phone = ? 
          ORDER BY date DESC, time DESC
          LIMIT 50
        `).all(session.phone);
      }

      const pendingByAppt = {};
      for (const apt of appointments) {
        // Prefer explicit helper for pending/paid checkout with payment link
        const pending = db.getPendingCheckoutForAppointment && db.getPendingCheckoutForAppointment(apt.id);
        if (pending) {
          pendingByAppt[apt.id] = {
            payment_status: pending.payment_status,
            payment_link: pending.payment_link
          };
          continue;
        }
        // Fallback: check latest checkout-only to infer payment_state if needed
        const latest = db.getLatestCheckoutForAppointment && db.getLatestCheckoutForAppointment(apt.id);
        if (latest && latest.status === 'completed') {
          pendingByAppt[apt.id] = {
            payment_status: 'paid',
            payment_link: null
          };
        }
      }

      return {
        success: true,
        appointments: appointments.map(apt => {
          const video_room = apt.video_room_name || apt.id;
          const payInfo = pendingByAppt[apt.id] || {};
          return {
            id: apt.id,
            patient_name: apt.patient_name,
            appointment_type: apt.appointment_type,
            date: apt.date,
            time: apt.time,
            start_time: apt.start_time || null,
            end_time: apt.end_time || null,
            status: apt.status,
            datetime_display: this._formatDateTime(apt.date, apt.time),
            can_reschedule: ['scheduled', 'confirmed'].includes(apt.status),
            can_cancel: ['scheduled', 'confirmed'].includes(apt.status),
            video_room,
            payment_status: payInfo.payment_status || apt.payment_status || null,
            payment_link: payInfo.payment_link || null
          };
        })
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
      if (session.revoked_at) {
        return { success: false, valid: false, error: 'Session expired' };
      }

      // Emergency flag expiry (Phase 1 safety): clear after 24 hours
      try {
        if (session.emergency_flag && session.emergency_flag_at) {
          const flagMs = new Date(session.emergency_flag_at).getTime();
          const ttlMs = 24 * 60 * 60 * 1000;
          if (Number.isFinite(flagMs) && Date.now() - flagMs > ttlMs) {
            db.db.prepare(`
              UPDATE patient_portal_sessions
              SET emergency_flag = 0, emergency_flag_at = NULL
              WHERE id = ?
            `).run(sessionId);
            session.emergency_flag = 0;
            session.emergency_flag_at = null;
          }
        }
      } catch (_) {}

      const now = Date.now();
      const verifiedAtMs = session.verified_at ? new Date(session.verified_at).getTime() : NaN;
      const lastSeenMs = session.last_seen_at
        ? new Date(session.last_seen_at).getTime()
        : (Number.isNaN(verifiedAtMs) ? NaN : verifiedAtMs);

      const absoluteHours = parseInt(process.env.PATIENT_SESSION_ABSOLUTE_TTL_HOURS || '24', 10);
      const inactivityMinutes = parseInt(process.env.PATIENT_SESSION_INACTIVITY_TTL_MINUTES || '60', 10);

      if (!Number.isNaN(verifiedAtMs)) {
        const absoluteTtlMs = Math.max(1, absoluteHours) * 60 * 60 * 1000;
        if (now - verifiedAtMs > absoluteTtlMs) {
          return { success: false, valid: false, error: 'Session expired' };
        }
      }

      if (!Number.isNaN(lastSeenMs)) {
        const inactivityTtlMs = Math.max(1, inactivityMinutes) * 60 * 1000;
        if (now - lastSeenMs > inactivityTtlMs) {
          return { success: false, valid: false, error: 'Session expired' };
        }
      }

      // Update activity timestamp (inactivity TTL)
      try {
        db.db.prepare(`
          UPDATE patient_portal_sessions
          SET last_seen_at = datetime('now')
          WHERE id = ?
        `).run(sessionId);
      } catch (_) {}

      // Cross-channel emergency flag (voice/web) - read-through
      let crossChannelEmergency = null;
      try {
        const mappedPatientId =
          session.patient_id ||
          (db.getPatientSession && (db.getPatientSession(sessionId) || {}).patient_id) ||
          null;
        crossChannelEmergency = db.getActivePatientEmergencyFlag
          ? db.getActivePatientEmergencyFlag({ patient_id: mappedPatientId, email: session.email, phone: session.phone })
          : null;
      } catch (_) {}

      return {
        success: true,
        valid: true,
        email: session.email,
        phone: session.phone,
        patient_id: session.patient_id || (db.getPatientSession && (db.getPatientSession(sessionId) || {}).patient_id) || null,
        emergency_flag: !!session.emergency_flag,
        emergency_flag_at: session.emergency_flag_at || null,
        cross_channel_emergency: crossChannelEmergency ? {
          id: crossChannelEmergency.id,
          source: crossChannelEmergency.source,
          flagged_at: crossChannelEmergency.flagged_at,
          expires_at: crossChannelEmergency.expires_at
        } : null
      };
    } catch (error) {
      return { success: false, valid: false, error: error.message };
    }
  }

  /**
   * Get patient profile + flags, insurance and basic eligibility
   * @param {string} sessionId - Valid session ID
   * @returns {Object} Patient profile data
   */
  getPatientProfile(sessionId) {
    try {
      const sessionValidation = this.validateSession(sessionId);
      if (!sessionValidation.valid) {
        return { success: false, error: 'Invalid session' };
      }

      const session = sessionValidation;

      // Resolve FHIR patient by email or phone
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

      const patientData = typeof patient.resource_data === 'string'
        ? JSON.parse(patient.resource_data)
        : patient.resource_data;
      const nameObj = (patientData.name && patientData.name[0]) || {};
      const telecom = patientData.telecom || [];
      const phone = (telecom.find(t => t.system === 'phone') || {}).value || '';
      const email = (telecom.find(t => t.system === 'email') || {}).value || '';
      const addr = (patientData.address && patientData.address[0]) || {};
      const first_name = (nameObj.given && nameObj.given[0]) ? String(nameObj.given[0]) : '';
      const last_name = nameObj.family ? String(nameObj.family) : '';

      // Insurance + eligibility summary for onboarding
      const insurance = db.getPrimaryPatientInsurance
        ? db.getPrimaryPatientInsurance(patient.resource_id)
        : null;
      const eligibilityRow = db.getLatestEligibilityForPatient
        ? db.getLatestEligibilityForPatient(patient.resource_id)
        : null;

      const flags = {
        profile_verified: !!patient.profile_verified,
        insurance_verified: !!patient.insurance_verified
      };

      return {
        success: true,
        patient: {
          name: `${(nameObj.given || [''])[0]} ${nameObj.family || ''}`.trim(),
          first_name,
          last_name,
          phone,
          email,
          dob: patientData.birthDate || null,
          address: {
            line: (addr.line && addr.line[0]) || '',
            city: addr.city || '',
            country: addr.country || '',
            state: addr.state || '',
            postal_code: addr.postalCode || ''
          }
        },
        insurance: insurance || null,
        eligibility: eligibilityRow || null,
        flags
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

