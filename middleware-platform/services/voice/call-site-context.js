'use strict';

/**
 * L1.5 — Resolve atomic site-of-care context for voice calls.
 * Separate from routing_world (demo / tenant / unidentified).
 */

const { normalizePhone, isDemoLineToNumber } = require('./voice-routing-world');

const SiteContextStatus = Object.freeze({
  VERIFIED: 'verified',
  AMBIGUOUS: 'ambiguous',
  MISSING: 'missing',
  NOT_REQUIRED: 'not_required'
});

const ClinicIdSource = Object.freeze({
  DID: 'did',
  METADATA: 'metadata',
  QUERY: 'query',
  AGENT_ID: 'agent_id',
  ENV_FALLBACK: 'env_fallback',
  MERCHANT_LIMIT1: 'merchant_limit1',
  UNRESOLVED: 'unresolved'
});

function isDevClinicFallbackAllowed() {
  return process.env.ALLOW_DEV_CLINIC_FALLBACK === '1' || process.env.ALLOW_DEV_CLINIC_FALLBACK === 'true';
}

function isOutboundCallType(callType) {
  const ct = String(callType || '').toLowerCase();
  return ct === 'operator_outbound' || ct === 'sales_outbound' || ct === 'outbound';
}

function siteContextNotRequired(opts = {}) {
  if (opts.isSomoDemoDemo || opts.call_type === 'somo_demo') return true;
  if (isDemoLineToNumber(normalizePhone(opts.to_number))) return true;
  const callType = String(opts.call_type || '').toLowerCase();
  const direction = String(opts.direction || '').toLowerCase();
  if (direction === 'outbound' || isOutboundCallType(callType)) {
    if (callType === 'operator_outbound') return true;
    return false;
  }
  return false;
}

/**
 * Resolve clinic from DID (authoritative for inbound tenant).
 */
function resolveClinicFromDid(db, toNumber) {
  if (!db || !toNumber) return null;
  const normalized = normalizePhone(toNumber);
  if (!normalized) return null;
  try {
    const row = db.getClinicPhoneNumber?.(normalized);
    if (row?.clinic_id) {
      return { clinic_id: String(row.clinic_id), source: ClinicIdSource.DID };
    }
  } catch (_) {}
  return null;
}

function customerMatchesClinic(db, customerId, clinicId) {
  if (!db || !customerId || !clinicId) return false;
  try {
    const mapped = db.getCustomerIdForClinic?.(clinicId);
    if (mapped && String(mapped) === String(customerId)) return true;
    const clinic = db.getClinicById?.(clinicId) || db.getClinic?.(clinicId);
    const customer = db.getCustomer?.(customerId);
    if (clinic?.merchant_id && customer?.merchant_id && String(clinic.merchant_id) === String(customer.merchant_id)) {
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * @returns {object} CallSiteContext
 */
function resolveCallSiteContext(opts = {}) {
  const db = opts.db;
  const toNumber = normalizePhone(opts.to_number || opts.toNumber);
  let clinicId = opts.clinic_id || opts.clinicId || null;
  let clinicIdSource = opts.clinic_id_source || opts.clinicIdSource || null;
  const customerId = opts.customer_id || opts.customerId || null;
  const callType = opts.call_type || opts.callType || null;
  const direction = opts.direction || null;

  // Inbound tenant: authoritative DID wins over stale Retell/metadata clinic hints (LX-12).
  if (toNumber && direction === 'inbound' && !isOutboundCallType(callType)) {
    const fromDid = resolveClinicFromDid(db, toNumber);
    if (fromDid?.clinic_id) {
      clinicId = fromDid.clinic_id;
      clinicIdSource = fromDid.source;
    }
  }

  if (siteContextNotRequired({ ...opts, to_number: toNumber, call_type: callType, direction })) {
    return {
      to_number: toNumber,
      customer_id: customerId,
      clinic_id: clinicId,
      merchant_id: opts.merchant_id || null,
      location_id: opts.location_id || null,
      clinic_id_source: clinicIdSource || ClinicIdSource.METADATA,
      site_context_status: SiteContextStatus.NOT_REQUIRED,
      routing_world_hint: opts.routing_world || null
    };
  }

  if (!clinicId && toNumber) {
    const fromDid = resolveClinicFromDid(db, toNumber);
    if (fromDid) {
      clinicId = fromDid.clinic_id;
      clinicIdSource = fromDid.source;
    }
  }

  if (!clinicId && opts.allow_heuristic !== true) {
    // Heuristics disabled in prod path — mark missing
  } else if (!clinicId && opts.allow_heuristic === true) {
    if (customerId && db?.db) {
      try {
        const row = db.db
          .prepare(
            'SELECT clinic_id FROM clinics WHERE merchant_id = (SELECT merchant_id FROM customers WHERE id = ? LIMIT 1) LIMIT 1'
          )
          .get(customerId);
        if (row?.clinic_id) {
          clinicId = row.clinic_id;
          clinicIdSource = ClinicIdSource.MERCHANT_LIMIT1;
        }
      } catch (_) {}
    }
    if (!clinicId && customerId && isDevClinicFallbackAllowed()) {
      const fallback = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID;
      if (fallback) {
        clinicId = String(fallback);
        clinicIdSource = ClinicIdSource.ENV_FALLBACK;
      }
    }
  }

  if (!clinicId) {
    return {
      to_number: toNumber,
      customer_id: customerId,
      clinic_id: null,
      merchant_id: opts.merchant_id || null,
      location_id: opts.location_id || null,
      clinic_id_source: ClinicIdSource.UNRESOLVED,
      site_context_status: SiteContextStatus.MISSING,
      routing_world_hint: opts.routing_world || null
    };
  }

  const ambiguousSource =
    clinicIdSource === ClinicIdSource.MERCHANT_LIMIT1 ||
    clinicIdSource === ClinicIdSource.ENV_FALLBACK;

  if (ambiguousSource) {
    return {
      to_number: toNumber,
      customer_id: customerId,
      clinic_id: clinicId,
      merchant_id: opts.merchant_id || null,
      location_id: opts.location_id || null,
      clinic_id_source: clinicIdSource,
      site_context_status: SiteContextStatus.AMBIGUOUS,
      routing_world_hint: opts.routing_world || null
    };
  }

  if (customerId && !customerMatchesClinic(db, customerId, clinicId)) {
    return {
      to_number: toNumber,
      customer_id: customerId,
      clinic_id: clinicId,
      merchant_id: opts.merchant_id || null,
      location_id: opts.location_id || null,
      clinic_id_source: clinicIdSource || ClinicIdSource.METADATA,
      site_context_status: SiteContextStatus.AMBIGUOUS,
      routing_world_hint: opts.routing_world || null
    };
  }

  return {
    to_number: toNumber,
    customer_id: customerId,
    clinic_id: clinicId,
    merchant_id: opts.merchant_id || null,
    location_id: opts.location_id || null,
    clinic_id_source: clinicIdSource || ClinicIdSource.METADATA,
    site_context_status: SiteContextStatus.VERIFIED,
    routing_world_hint: opts.routing_world || null
  };
}

function isSiteContextVerified(ctx) {
  if (!ctx) return false;
  if (ctx.site_context_status === SiteContextStatus.NOT_REQUIRED) return true;
  return ctx.site_context_status === SiteContextStatus.VERIFIED;
}

function toolsRequireVerifiedSite(ctx) {
  return ctx?.site_context_status !== SiteContextStatus.NOT_REQUIRED;
}

/**
 * Apply resolved site context to a Retell connection. clinic_id is set only when verified or not_required.
 */
function applySiteContextToConnection(connection, siteCtx, voiceHelpers = {}) {
  if (!connection || !siteCtx) return siteCtx;
  const { buildVoiceCallContext, runtimeClinicId, canRunKelly } = voiceHelpers;
  connection.site_context = siteCtx;
  connection.site_context_status = siteCtx.site_context_status;
  connection.clinic_id_source = siteCtx.clinic_id_source;

  if (siteCtx.customer_id && !connection.customer_id) {
    connection.customer_id = siteCtx.customer_id;
  }

  const verified =
    siteCtx.site_context_status === SiteContextStatus.VERIFIED ||
    siteCtx.site_context_status === SiteContextStatus.NOT_REQUIRED;

  if (buildVoiceCallContext && canRunKelly) {
    try {
      connection.voiceContext = buildVoiceCallContext({
        siteContext: siteCtx,
        routing_world: connection.routing_world || null,
        call_type: connection.call_type || null,
        direction: connection.direction || null
      });
      connection.kelly_admission_blocked = !canRunKelly(connection.voiceContext);
      const trustedClinic = runtimeClinicId ? runtimeClinicId(connection.voiceContext) : null;
      if (trustedClinic) {
        connection.clinic_id = trustedClinic;
      } else if (verified && siteCtx.clinic_id) {
        connection.clinic_id = siteCtx.clinic_id;
      } else if (!verified) {
        connection.clinic_id = null;
      }
    } catch (_) {}
  } else if (verified && siteCtx.clinic_id) {
    connection.clinic_id = siteCtx.clinic_id;
  } else if (!verified) {
    connection.clinic_id = null;
  }

  return siteCtx;
}

/**
 * Re-resolve site context after agent_id / DV metadata backfill (prevents clinic bleed).
 */
function reconcileSiteContextAfterMetadata(opts = {}) {
  const { db, connection, callMeta = {}, allowReconnectPromotion = false } = opts;
  if (!db || !connection) return null;

  const dv =
    callMeta.dynamic_variables ||
    callMeta.retell_llm_dynamic_variables ||
    (callMeta.metadata && callMeta.metadata.dynamic_variables) ||
    {};

  const siteCtx = resolveCallSiteContext({
    db,
    to_number: connection.to_number || callMeta.to_number || dv.to_number,
    customer_id: connection.customer_id,
    clinic_id: connection.clinic_id,
    clinic_id_source: connection.clinic_id_source,
    merchant_id: dv.merchant_id || callMeta.metadata?.merchant_id || null,
    call_type: connection.call_type || dv.call_type || callMeta.metadata?.call_type,
    direction: connection.direction || dv.direction || callMeta.metadata?.direction,
    routing_world: connection.routing_world || null,
    isSomoDemoDemo: opts.isSomoDemoDemo,
    allow_heuristic: isDevClinicFallbackAllowed()
  });

  const metaSiteVerified =
    allowReconnectPromotion &&
    String(dv.site_context_status || callMeta.metadata?.site_context_status || '').toLowerCase() ===
      'verified' &&
    connection.customer_id &&
    connection.clinic_id &&
    siteCtx.site_context_status !== SiteContextStatus.VERIFIED &&
    siteCtx.site_context_status !== SiteContextStatus.NOT_REQUIRED;

  if (metaSiteVerified) {
    siteCtx.site_context_status = SiteContextStatus.VERIFIED;
    if (!siteCtx.clinic_id) siteCtx.clinic_id = connection.clinic_id;
  }

  let voiceHelpers = {};
  try {
    voiceHelpers = require('./voice-call-context');
  } catch (_) {}

  return applySiteContextToConnection(connection, siteCtx, voiceHelpers);
}

module.exports = {
  SiteContextStatus,
  ClinicIdSource,
  resolveCallSiteContext,
  resolveClinicFromDid,
  isSiteContextVerified,
  toolsRequireVerifiedSite,
  siteContextNotRequired,
  isDevClinicFallbackAllowed,
  applySiteContextToConnection,
  reconcileSiteContextAfterMetadata
};
