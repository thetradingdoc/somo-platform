'use strict';

const IDENTITY_HANDOFF_COPY = {
  en: 'I am having trouble identifying your clinic account. I will connect you with support to help you. One moment please.',
  es: 'Tengo problemas para identificar su cuenta de la clínica. Lo conectaré con soporte para ayudarle. Un momento por favor.',
  zh: '我无法识别您的诊所账户。我将为您转接人工支持，请稍候。'
};

function resolveLocaleHint(opts = {}) {
  const raw = opts.preferredLanguage || opts.locale || opts.detectedLocale || 'en';
  return String(raw).slice(0, 2) || 'en';
}

function handoffCopy(locale) {
  const loc = String(locale || 'en').slice(0, 2);
  return IDENTITY_HANDOFF_COPY[loc] || IDENTITY_HANDOFF_COPY.en;
}

/**
 * Inbound tenant resolved when customer_id is known or clinic maps to a tenant row.
 */
function isTenantIdentityResolved(opts = {}) {
  const customerId = opts.customerId || opts.customer_id || null;
  if (customerId && String(customerId).trim()) return true;

  const clinicId = opts.clinicId || opts.clinic_id || null;
  if (!clinicId) return false;

  const db = opts.db;
  if (db?.getCustomerIdForClinic) {
    try {
      const mapped = db.getCustomerIdForClinic(clinicId);
      if (mapped) return true;
    } catch (_) {}
  }
  if (db?.getClinic) {
    try {
      const clinic = db.getClinic(clinicId);
      if (clinic?.clinic_id) return true;
    } catch (_) {}
  }
  return false;
}

/**
 * @returns {{ admitted: boolean, reason?: string, reply?: string, locale?: string }}
 */
function evaluateIdentityAdmission(opts = {}) {
  const callType = String(opts.call_type || opts.callType || '').trim();
  const direction = String(opts.direction || '').trim();
  const clinicId = opts.clinicId || opts.clinic_id || null;
  const customerId = opts.customerId || opts.customer_id || null;
  const locale = resolveLocaleHint(opts);

  const tenantResolved =
    opts.tenantResolved === true ||
    (opts.tenantResolved !== false && isTenantIdentityResolved({ ...opts, clinicId, customerId }));

  const isOutbound =
    callType === 'sales_outbound' ||
    callType === 'operator_outbound' ||
    direction === 'outbound';
  const isNavigation = callType === 'consumer_navigation';

  if (isNavigation) {
    return { admitted: true, locale };
  }

  if (isOutbound && (customerId || clinicId)) {
    const siteStatus = String(opts.site_context_status || opts.siteContextStatus || '').toLowerCase();
    if (siteStatus && siteStatus !== 'verified' && siteStatus !== 'not_required') {
      return {
        admitted: false,
        reason: 'site_context_not_verified',
        reply: handoffCopy(locale),
        locale
      };
    }
    return { admitted: true, locale };
  }

  const siteStatus = String(opts.site_context_status || opts.siteContextStatus || '').toLowerCase();
  if (siteStatus && siteStatus !== 'verified' && siteStatus !== 'not_required') {
    return {
      admitted: false,
      reason: 'site_context_not_verified',
      reply: handoffCopy(locale),
      locale
    };
  }

  if (!tenantResolved || (!clinicId && !customerId)) {
    return {
      admitted: false,
      reason: 'tenant_identity_unresolved',
      reply: handoffCopy(locale),
      locale
    };
  }

  if (!callType && direction !== 'inbound' && direction !== 'outbound') {
    return {
      admitted: false,
      reason: 'call_context_incomplete',
      reply: handoffCopy(locale),
      locale
    };
  }

  return { admitted: true, locale };
}

function emitIdentityInvalid(db, payload = {}) {
  try {
    db?.insertKellyCallEvent?.({
      session_id: payload.sessionId || payload.session_id || null,
      call_id: payload.callId || payload.call_id || null,
      event_type: 'identity_invalid',
      payload_json: {
        reason: payload.reason || 'tenant_identity_unresolved',
        clinic_id: payload.clinicId || null,
        customer_id: payload.customerId || null,
        call_type: payload.call_type || null,
        direction: payload.direction || null
      }
    });
  } catch (_) {}
}

module.exports = {
  evaluateIdentityAdmission,
  emitIdentityInvalid,
  handoffCopy,
  isTenantIdentityResolved,
  IDENTITY_HANDOFF_COPY
};
