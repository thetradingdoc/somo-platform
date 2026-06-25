'use strict';

/**
 * Single admission SSOT for voice calls — unifies L1 (routing_world / customer_id)
 * with L1.5 (CallSiteContext / site_context_status).
 */

const {
  SiteContextStatus,
  resolveClinicFromDid
} = require('./call-site-context');

/** Retell / voice metadata call_type for SomoPay consumer navigation (P1-S1). */
const CALL_TYPE_CONSUMER_NAVIGATION = 'consumer_navigation';

function buildVoiceCallContext(opts = {}) {
  const site = opts.siteContext || opts.site_context || {};
  const status = String(
    opts.site_context_status ||
      site.site_context_status ||
      SiteContextStatus.MISSING
  ).toLowerCase();
  const clinicId = opts.clinic_id || opts.clinicId || site.clinic_id || null;
  const clinicIdSource = opts.clinic_id_source || opts.clinicIdSource || site.clinic_id_source || null;
  const customerId = opts.customer_id || opts.customerId || site.customer_id || null;
  const merchantId = opts.merchant_id || opts.merchantId || site.merchant_id || null;
  const routingWorld = opts.routing_world || opts.routingWorld || null;
  const callType = opts.call_type || opts.callType || null;
  const direction = opts.direction || null;

  return Object.freeze({
    site_context_status: status,
    clinic_id: clinicId,
    clinic_id_source: clinicIdSource,
    customer_id: customerId,
    merchant_id: merchantId,
    routing_world: routingWorld,
    call_type: callType,
    direction
  });
}

function canUseClinicId(ctx) {
  if (!ctx) return false;
  const status = String(ctx.site_context_status || '').toLowerCase();
  return status === SiteContextStatus.VERIFIED && !!ctx.clinic_id;
}

function effectiveClinicId(ctx) {
  return canUseClinicId(ctx) ? ctx.clinic_id : null;
}

/** Clinic id safe for runtime settings lookup (verified or not_required with id). */
function runtimeClinicId(ctx) {
  if (canUseClinicId(ctx)) return ctx.clinic_id;
  const status = String(ctx?.site_context_status || '').toLowerCase();
  if (status === 'not_required' && ctx?.clinic_id) return ctx.clinic_id;
  return null;
}

function canPrepopulatePatient(ctx) {
  return canUseClinicId(ctx);
}

function canRunKelly(ctx) {
  if (!ctx) return false;
  const status = String(ctx.site_context_status || '').toLowerCase();
  if (status === SiteContextStatus.NOT_REQUIRED) return true;
  if (status === SiteContextStatus.VERIFIED) return true;
  return false;
}

function toRetellMetadata(ctx) {
  if (!ctx) return {};
  const status = String(ctx.site_context_status || '').toLowerCase();
  const out = {
    site_context_status: status,
    clinic_id_source: ctx.clinic_id_source || ''
  };
  if (ctx.customer_id) out.customer_id = String(ctx.customer_id);
  if (canUseClinicId(ctx)) out.clinic_id = String(ctx.clinic_id);
  if (ctx.routing_world) out.routing_world = String(ctx.routing_world);
  if (ctx.call_type) out.call_type = String(ctx.call_type);
  return out;
}

/**
 * Resolve tenant clinic from call metadata — DID-first, no LIMIT 1 heuristic.
 */
function resolveTenantClinicFromCallMeta(db, callMeta = {}) {
  const toNumber = callMeta.to_number || callMeta.toNumber || null;
  const did = resolveClinicFromDid(db, toNumber);
  if (did?.clinic_id) {
    return {
      clinic_id: did.clinic_id,
      clinic_id_source: did.source,
      site_context_status: SiteContextStatus.VERIFIED
    };
  }
  const explicit = callMeta.clinic_id || callMeta.clinicId || null;
  const status = callMeta.site_context_status || callMeta.siteContextStatus || null;
  if (explicit && status === SiteContextStatus.VERIFIED) {
    return {
      clinic_id: explicit,
      clinic_id_source: callMeta.clinic_id_source || 'metadata',
      site_context_status: SiteContextStatus.VERIFIED
    };
  }
  return {
    clinic_id: null,
    clinic_id_source: null,
    site_context_status: SiteContextStatus.MISSING
  };
}

module.exports = {
  CALL_TYPE_CONSUMER_NAVIGATION,
  buildVoiceCallContext,
  canRunKelly,
  canPrepopulatePatient,
  canUseClinicId,
  effectiveClinicId,
  runtimeClinicId,
  toRetellMetadata,
  resolveTenantClinicFromCallMeta
};
