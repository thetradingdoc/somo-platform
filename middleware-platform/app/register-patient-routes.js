'use strict';

/**
 * Patient portal route registration (RS-2-04).
 * Extracted from server.js — funnel, booking, profile, wallet, RCM.
 */

const { validateRequired, validateDate, combineValidators } = require('../middleware/input-validator');

function parseIsoDateFromText(text) {
  const t = (text || '').toString();
  const m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return m[0];
  const lower = t.toLowerCase();
  if (lower.includes('tomorrow')) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (lower.includes('today')) return new Date().toISOString().slice(0, 10);
  return null;
}

function parseTimeFromText(text) {
  const t = (text || '').toString().toLowerCase();
  const m24 = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m24) return `${m24[1].padStart(2, '0')}:${m24[2]}`;
  const m12 = t.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2] ? parseInt(m12[2], 10) : 0;
    const ampm = m12[3];
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  return null;
}

function isValidIanaTimezone(value) {
  const tz = (value || '').toString().trim();
  if (!tz) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch (_) {
    return false;
  }
}

const validatePatientBookingScheduleBody = combineValidators(
  validateRequired(['date', 'time']),
  validateDate('date')
);
const validatePatientTriageBody = validateRequired(['message']);

function validatePatientCheckoutChatBody(req, res, next) {
  const b = req.body || {};
  const msg = (b.message || '').toString().trim();
  if (!msg) {
    return res.status(400).json({ success: false, error: 'message is required', request_id: req.id });
  }
  if (msg.length > 4000) {
    return res.status(400).json({ success: false, error: 'message too long (max 4000 characters)', request_id: req.id });
  }
  const pid = (b.product_id || '').toString().trim();
  const provid = (b.provider_id || '').toString().trim();
  if (!pid) {
    return res.status(400).json({ success: false, error: 'product_id is required', request_id: req.id });
  }
  if (!provid) {
    return res.status(400).json({ success: false, error: 'provider_id is required', request_id: req.id });
  }
  return next();
}

function validatePatientAvailableSlotsQuery(req, res, next) {
  const date = (req.query?.date || '').toString().trim();
  if (!date) {
    return res.status(400).json({ success: false, error: 'date query parameter is required', request_id: req.id });
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD.', request_id: req.id });
  }
  return next();
}

function registerPatientPortalRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requirePatientSession,
    recordPatientPortalEvent,
    ensureBillingTables,
    resolvePatientIdFromSession,
    resolveBillingSubscription,
    billingOk,
    billingErr,
    patientRouteDeps: basePatientRouteDeps,
    requireCsrfForCookieAuth,
    rotatePatientSessionIfNeeded,
    blockChatWhenDisabled,
    upsertCustomerProductScan,
    antiSybilGuard,
    requireAdminAuth,
    sendUploadLinkHandler,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
  } = deps;

  const { registerPatientFunnelBridgeRoutes } = require('../routes/patient/patient-funnel-bridge');
  registerPatientFunnelBridgeRoutes(app, { apiLimiter, requirePatientSession, recordPatientPortalEvent });

  const { registerPatientCareProgramBillingRoutes } = require('../routes/patient/patient-care-program-billing');
  registerPatientCareProgramBillingRoutes(app, {
    apiLimiter,
    express,
    requirePatientSession,
    ensureBillingTables,
    resolvePatientIdFromSession,
    resolveBillingSubscription,
    billingOk,
    billingErr,
    db,
  });

  const { registerPatientRoutineRoutes } = require('../routes/patient/patient-routine');
  const { registerPatientShelfRoutes } = require('../routes/patient/patient-shelf');
  const { registerPatientProductsRoutes } = require('../routes/patient/patient-products');
  const { registerPatientBillingPortalRoutes } = require('../routes/patient/patient-billing-portal');
  const { registerPatientBookingRoutes } = require('../routes/patient/patient-booking');
  const { registerPatientCheckoutChatRoutes } = require('../routes/patient/patient-checkout-chat');
  const { registerPatientProfileRoutes } = require('../routes/patient/patient-profile');
  const { registerPatientAuthRoutes } = require('../routes/patient/patient-auth');
  const { registerPatientDocumentsRoutes } = require('../routes/patient/patient-documents');
  const { registerPatientWalletRoutes } = require('../routes/patient/patient-wallet');
  const { registerPatientRcmRoutes } = require('../routes/patient/patient-rcm');
  const { registerPatientInsuranceRoutes } = require('../routes/patient/patient-insurance');
  const { registerPriorAuthRoutes } = require('../routes/prior-auth');
  const { registerPublicLandingAssistantRoutes } = require('../routes/public/public-landing-assistant');

  function auditBookingEvent(req, action, resourceType, resourceId, result = 'success') {
    try {
      if (db.auditLog) {
        db.auditLog(
          'patient',
          req?.patientSession?.patient_id || req?.patientSessionId || 'unknown',
          action,
          resourceType,
          resourceId,
          req.ip,
          req.get('User-Agent') || '',
          result
        );
      }
    } catch (_) {}
  }

  const patientRouteDeps = {
    ...basePatientRouteDeps,
    validatePatientAvailableSlotsQuery,
    validatePatientBookingScheduleBody,
    validatePatientTriageBody,
    auditBookingEvent,
    otpSendLimiter,
    otpConfirmLimiter,
    parseIsoDateFromText,
    parseTimeFromText,
    isValidIanaTimezone,
  };

  registerPatientCheckoutChatRoutes(app, {
    apiLimiter,
    express,
    requirePatientSession,
    requireCsrfForCookieAuth,
    validatePatientCheckoutChatBody,
    rotatePatientSessionIfNeeded,
    blockChatWhenDisabled,
    db,
  });

  registerPatientRoutineRoutes(app, patientRouteDeps);
  registerPatientShelfRoutes(app, patientRouteDeps);
  registerPatientProductsRoutes(app, patientRouteDeps);
  registerPatientBillingPortalRoutes(app, patientRouteDeps);
  registerPatientBookingRoutes(app, patientRouteDeps);

  registerPublicLandingAssistantRoutes(app, {
    apiLimiter,
    express,
    validatePatientTriageBody,
    db,
    upsertCustomerProductScan,
    antiSybilGuard,
    requireAdminAuth,
  });

  const patientPortalDeps = {
    ...patientRouteDeps,
    requireAdminAuth,
    sendUploadLinkHandler,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
  };

  registerPatientProfileRoutes(app, patientPortalDeps);
  registerPatientAuthRoutes(app, patientPortalDeps);
  registerPatientDocumentsRoutes(app, patientPortalDeps);
  registerPatientWalletRoutes(app, patientPortalDeps);
  registerPatientRcmRoutes(app, patientPortalDeps);
  registerPatientInsuranceRoutes(app, patientPortalDeps);
  registerPriorAuthRoutes(app, { apiLimiter, express, db });
}

module.exports = {
  registerPatientPortalRoutes,
  validatePatientCheckoutChatBody,
  validatePatientAvailableSlotsQuery,
  validatePatientBookingScheduleBody,
  validatePatientTriageBody,
};
