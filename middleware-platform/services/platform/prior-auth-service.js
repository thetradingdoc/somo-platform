'use strict';

const { v4: uuidv4 } = require('uuid');
const PriorAuthDetectionService = require('./prior-auth-detection-service');

/**
 * Prior Auth Service (RCM-PA v1)
 *
 * Phase 1 responsibilities:
 * - Evaluate whether PA is required (rules + 271 hint)
 * - Create a `prior_auth_requests` row (case tracking)
 * - Surface “Stedi 278 unsupported” clearly on submit
 *
 * Phase 2 responsibilities (explicitly not implemented here):
 * - Submit PA via payer portal / partner platform / payer FHIR write
 * - Poll/webhook decision updates
 */
class PriorAuthService {
  /**
   * Evaluate PA requirement for a CPT in context.
   */
  static evaluateRequirement(db, { patientId = null, memberId = null, payerId = null, cptCode, dateOfService = null } = {}) {
    return PriorAuthDetectionService.evaluatePriorAuthRequirement(db, {
      patientId,
      memberId,
      payerId,
      cptCode,
      dateOfService
    });
  }

  /**
   * Open a PA case record (even if submission is manual).
   * This is what links appointment → PA lifecycle.
   */
  static openCase(db, {
    appointmentId = null,
    claimId = null,
    patientId = null,
    memberId = null,
    payerId = null,
    cptCode = null,
    icd10Code = null,
    placeOfService = null,
    dateOfService = null,
    status = 'pending',
    submissionRail = 'manual'
  } = {}) {
    const id = `pa_${uuidv4()}`;
    const row = {
      id,
      appointment_id: appointmentId,
      claim_id: claimId,
      patient_id: patientId,
      payer_id: payerId,
      member_id: memberId,
      cpt_code: cptCode,
      icd10_code: icd10Code,
      place_of_service: placeOfService,
      date_of_service: dateOfService,
      submission_rail: submissionRail,
      status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    db.createPriorAuthRequest(row);

    if (appointmentId && db.updateAppointment) {
      try {
        db.updateAppointment(appointmentId, {
          requires_prior_auth: status !== 'not_required' && status !== 'unknown',
          auth_status: status,
          prior_auth_request_id: id
        });
      } catch (_) {}
    }

    return row;
  }

  /**
   * Submit a PA request.
   *
   * In Phase 1 this returns STEDI_278_UNSUPPORTED (Stedi cannot submit 278 today).
   * Use this method to keep a consistent interface while routing to Phase 2 rails later.
   */
  static submitPriorAuth(_db, _requestId) {
    return {
      success: false,
      code: 'STEDI_278_UNSUPPORTED',
      manualReview: true,
      error: 'Stedi does not currently support X12 278 prior authorization submission. Use UHC FHIR write or a PA partner platform (Phase 2).'
    };
  }

  /**
   * Read current status from DB (Phase 1).
   * Rails can later extend this to poll/check live status.
   */
  static getRequest(db, requestId) {
    const req = db.getPriorAuthRequest(requestId);
    if (!req) return { success: false, error: 'Prior auth request not found' };
    return { success: true, request: req };
  }

  /**
   * Phase-1 manual approval:
   * - Mark the PA request as `approved`
   * - Store `auth_number` (+ optional `expiry_date`)
   * - Sync the linked appointment so claim submission can pass the PA gate
   */
  static manualApproveRequest(db, requestId, { authNumber = null, expiryDate = null } = {}) {
    const existing = db.getPriorAuthRequest(requestId);
    if (!existing) return { success: false, error: 'Prior auth request not found' };

    const normalizedAuthNumber = authNumber != null ? String(authNumber).trim() : '';
    if (!normalizedAuthNumber) {
      return { success: false, error: 'auth_number is required for approval' };
    }

    db.updatePriorAuthRequest(requestId, {
      status: 'approved',
      auth_number: normalizedAuthNumber,
      expiry_date: expiryDate || existing.expiry_date || null,
      denial_reason: null
    });

    const updated = db.getPriorAuthRequest(requestId);

    if (existing.appointment_id && db.updateAppointment) {
      db.updateAppointment(existing.appointment_id, {
        requires_prior_auth: true,
        auth_status: 'approved',
        prior_auth_request_id: requestId
      });
    }

    return { success: true, request: updated };
  }

  /**
   * Phase-1 manual denial:
   * - Mark the PA request as `denied` (auth gate will fail due to lack of approved auth_number)
   * - Sync the linked appointment
   */
  static manualDenyRequest(db, requestId, { denialReason = null } = {}) {
    const existing = db.getPriorAuthRequest(requestId);
    if (!existing) return { success: false, error: 'Prior auth request not found' };

    db.updatePriorAuthRequest(requestId, {
      status: 'denied',
      auth_number: null,
      expiry_date: null,
      denial_reason: denialReason || existing.denial_reason || null
    });

    const updated = db.getPriorAuthRequest(requestId);

    if (existing.appointment_id && db.updateAppointment) {
      db.updateAppointment(existing.appointment_id, {
        requires_prior_auth: true,
        auth_status: 'denied',
        prior_auth_request_id: requestId
      });
    }

    return { success: true, request: updated };
  }

  /**
   * Phase-1 manual update for already-approved requests.
   * Useful when you need to correct expiry_date/auth_number without re-running PA evaluation.
   */
  static manualUpdateApprovedRequest(db, requestId, { authNumber = null, expiryDate = null } = {}) {
    const existing = db.getPriorAuthRequest(requestId);
    if (!existing) return { success: false, error: 'Prior auth request not found' };

    const status = String(existing.status || '').toLowerCase().trim();
    if (status !== 'approved') {
      return { success: false, error: 'Can only update an approved prior auth request', code: 'NOT_APPROVED' };
    }

    const patch = {
      auth_number: authNumber != null ? String(authNumber).trim() : existing.auth_number,
      expiry_date: expiryDate != null ? expiryDate : existing.expiry_date
    };

    if (!patch.auth_number) {
      return { success: false, error: 'auth_number is required when updating an approved request' };
    }

    db.updatePriorAuthRequest(requestId, patch);
    const updated = db.getPriorAuthRequest(requestId);

    if (existing.appointment_id && db.updateAppointment) {
      db.updateAppointment(existing.appointment_id, {
        requires_prior_auth: true,
        auth_status: 'approved',
        prior_auth_request_id: requestId
      });
    }

    return { success: true, request: updated };
  }

  static listByClinic(db, clinicId, { status = null, limit = 100 } = {}) {
    if (!clinicId) return { success: false, error: 'clinic_id is required', requests: [] };
    const rows = db.getPriorAuthRequestsByClinic
      ? db.getPriorAuthRequestsByClinic(String(clinicId), { status, limit })
      : [];
    const requests = (rows || []).map((r) => ({
      id: r.id,
      appointment_id: r.appointment_id,
      claim_id: r.claim_id,
      patient_id: r.patient_id,
      payer_id: r.payer_id,
      member_id: r.member_id,
      cpt_code: r.cpt_code,
      icd10_code: r.icd10_code,
      status: r.status,
      auth_number: r.auth_number,
      date_of_service: r.date_of_service,
      appointment_date: r.appointment_date,
      appointment_time: r.appointment_time,
      patient_name: r.appointment_patient_name || null,
      created_at: r.created_at,
      updated_at: r.updated_at
    }));
    return { success: true, requests, count: requests.length };
  }
}

module.exports = PriorAuthService;

