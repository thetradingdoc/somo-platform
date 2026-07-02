'use strict';

const db = require('../database');
const { requireCustomerAuth } = require('./customer-auth');
const { resolveClinicForCustomer } = require('../services/tenant-voice-config');

function internalJobToken() {
  return process.env.INTERNAL_JOB_TOKEN || null;
}

function clinicIdFromRequest(req) {
  return req.body?.clinic_id || req.query?.clinic_id || req.query?.clinicId || null;
}

function resolvePmsClinicForCustomer(req) {
  const customerId = req.customer?.id;
  if (!customerId) return null;
  const hint = clinicIdFromRequest(req);
  return resolveClinicForCustomer(db, customerId, hint);
}

/**
 * Require authenticated tenant with resolved clinic for PMS routes.
 * Attaches req.pmsClinicId and req.pmsClinic.
 */
function requireCustomerPmsAuth(req, res, next) {
  requireCustomerAuth(req, res, (err) => {
    if (err) return next(err);
    if (res.headersSent) return;

    const clinic = resolvePmsClinicForCustomer(req);
    if (!clinic) {
      return res.status(403).json({
        success: false,
        error: 'clinic_not_found',
        message: 'No clinic associated with your account.'
      });
    }

    const requestedId = clinicIdFromRequest(req);
    if (requestedId && requestedId !== clinic.clinic_id) {
      return res.status(403).json({
        success: false,
        error: 'clinic_mismatch',
        message: 'You do not have access to the requested clinic.'
      });
    }

    req.pmsClinic = clinic;
    req.pmsClinicId = clinic.clinic_id;
    next();
  });
}

function isInternalJobRequest(req) {
  const tok = internalJobToken();
  return tok && req.headers['x-internal-job-token'] === tok;
}

/**
 * Agent patient-context: internal job token OR authenticated tenant with clinic_id.
 */
function requireAgentPmsAuth(req, res, next) {
  if (isInternalJobRequest(req)) {
    const clinicId = clinicIdFromRequest(req);
    if (clinicId) {
      req.pmsClinicId = clinicId;
    }
    return next();
  }

  return requireCustomerPmsAuth(req, res, next);
}

module.exports = {
  requireCustomerPmsAuth,
  requireAgentPmsAuth,
  isInternalJobRequest
};
