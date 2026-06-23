/**
 * KellyToolExecutor
 *
 * Shared function executor for KellyAgentService.
 * Routes tool_call names to existing backend logic.
 *
 * This is K-2 from the migration plan.
 * It reuses the existing HTTP endpoints rather than duplicating logic,
 * so all business rules (fraud detection, duplicate patient checks, etc.)
 * remain in one place.
 */

const axios = require('axios');
const { randomUUID } = require('crypto');
const db = require('../../database');
const PaymentOrchestrator = require('../commerce/payment-orchestrator');
const CheckoutPaymentStatusService = require('../commerce/checkout-payment-status-service');
const CheckoutWorkflowService = require('../commerce/checkout-workflow-service');
const TriageRAGService = require('../clinical/triage-rag-service');
const TriageRAGServiceV2 = require('../clinical/triage-rag-service-v2');
const SpecialistResolverService = require('../patient/specialist-resolver-service');
const MedicalLiteratureSearchService = require('../platform/medical-literature-search-service');
const QueryPlanner = require('../shared/query-planner');
const ProductIngredientResolver = require('../catalog/product-ingredient-resolver');
const { resolverMapToProviderCards } = require('../patient/provider-card-normalizer');
const { getAvailableSlotsWithSpecialist, isSpecialtyType } = require('../patient/specialist-slot-service');
const { getClinicBusinessHours, isBusinessDay, getNextBusinessDay, normalizeDateStr } = require('../../config/clinic-business-hours');
const { isConfidenceNearThreshold } = require('../../config/coding-thresholds');

const BASE_URL = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';

/** Per-turn executor tool log — source of truth for toolsUsed (not subrail metadata). */
const _turnToolLog = new Map();

function _toolSuccess(result) {
  if (!result || typeof result !== 'object') return false;
  if (result.success === false) return false;
  if (result.error) return false;
  return true;
}

function _emitToolTelemetry(sessionId, eventType, payload = {}) {
  if (!sessionId) return;
  try {
    db.insertKellyCallEvent?.({
      session_id: sessionId,
      event_type: eventType,
      payload_json: payload
    });
  } catch (_) {}
}
const REQUIRE_COMMERCE_EMAIL_VERIFICATION =
  String(process.env.REQUIRE_COMMERCE_EMAIL_VERIFICATION || 'true').toLowerCase() !== 'false';
const STRICT_CHECKOUT_STAGE_GATE =
  String(process.env.STRICT_CHECKOUT_STAGE_GATE || 'true').toLowerCase() !== 'false';
const CHECKOUT_RAIL_GUARDS_ENABLED =
  String(process.env.CHECKOUT_RAIL_GUARDS_ENABLED || 'true').toLowerCase() !== 'false';
const COMMERCE_EMAIL_VERIFY_TTL_MS = Math.max(
  60000,
  parseInt(process.env.COMMERCE_EMAIL_VERIFY_TTL_MS || '900000', 10) || 900000
);
const COMMERCE_SHIPPING_TTL_MS = Math.max(
  60000,
  parseInt(process.env.COMMERCE_SHIPPING_TTL_MS || '1800000', 10) || 1800000
);

/** Verbose tool/checkout/SLOTS traces — same flag as kelly-agent-service (`KELLY_DEBUG=1`). */
function _kellyToolDebug() {
  return process.env.KELLY_DEBUG === '1' || process.env.KELLY_DEBUG === 'true';
}

function _resolveCustomerType(clinicId, customerId) {
  try {
    if (customerId) {
      const c = db.getCustomer?.(customerId);
      if (c?.customer_type) return c.customer_type;
    }
    if (clinicId && db.getCustomerIdForClinic) {
      const cid = db.getCustomerIdForClinic(clinicId);
      if (cid) return db.getCustomer?.(cid)?.customer_type || 'saas';
    }
  } catch (_) {}
  return 'saas';
}

function _emitKellyActivityEvent({ sessionId, clinicId, patientId, eventType, payload = {} }) {
  try {
    db.insertKellyCallEvent?.({
      session_id: sessionId || null,
      event_type: eventType,
      clinic_id: clinicId || null,
      payload_json: {
        clinic_id: clinicId || null,
        patient_id: patientId || null,
        ...payload,
      },
    });
  } catch (_) {}
}

function _emitAppointmentBooked(ctx, appointment, extra = {}) {
  if (!appointment?.id) return;
  _emitKellyActivityEvent({
    sessionId: ctx.sessionId,
    clinicId: ctx.clinicId,
    patientId: ctx.patientId || appointment.patient_id || null,
    eventType: 'appointment_booked',
    payload: {
      appointment_id: appointment.id,
      appointment_type: appointment.appointment_type || appointment.specialty || extra.appointment_type,
      patient_name: appointment.patient_name || extra.patient_name,
      ...extra,
    },
  });
  try {
    const { sendPostCallOwnerEmail } = require('../shared/post-call-owner-email');
    sendPostCallOwnerEmail({
      eventType: 'appointment_booked',
      sessionId: ctx.sessionId,
      clinicId: ctx.clinicId,
      customerId: ctx.customerId,
      patientId: ctx.patientId || appointment.patient_id,
      patientName: appointment.patient_name || extra.patient_name,
      payload: {
        appointment_id: appointment.id,
        appointment_type: appointment.appointment_type || appointment.specialty
      }
    }).catch(() => {});
  } catch (_) {}
}

function _emitAppointmentCancelled(ctx, result, args = {}) {
  const appointmentId = result?.appointment_id || result?.appointment?.id || args.appointment_id || null;
  const patientName = args.patient_name || result?.patient_name || result?.appointment?.patient_name || null;
  _emitKellyActivityEvent({
    sessionId: ctx.sessionId,
    clinicId: ctx.clinicId,
    patientId: ctx.patientId || result?.patient_id || args.patient_id || null,
    eventType: 'appointment_cancelled',
    payload: {
      appointment_id: appointmentId,
      patient_name: patientName,
      appointment_type: result?.appointment_type || args.appointment_type || null,
      reason: args.reason || result?.reason || null
    }
  });
  try {
    const { sendPostCallOwnerEmail } = require('../shared/post-call-owner-email');
    sendPostCallOwnerEmail({
      eventType: 'appointment_cancelled',
      sessionId: ctx.sessionId,
      clinicId: ctx.clinicId,
      customerId: ctx.customerId,
      patientId: ctx.patientId || result?.patient_id,
      patientName,
      payload: { appointment_id: appointmentId }
    }).catch(() => {});
  } catch (_) {}
}

function _emitAppointmentRescheduled(ctx, result, args = {}) {
  const appointmentId = result?.appointment_id || result?.appointment?.id || args.appointment_id || null;
  const patientName = args.patient_name || result?.patient_name || result?.appointment?.patient_name || null;
  const when = [args.new_date || result?.new_date, args.new_time || result?.new_time].filter(Boolean).join(' ');
  _emitKellyActivityEvent({
    sessionId: ctx.sessionId,
    clinicId: ctx.clinicId,
    patientId: ctx.patientId || result?.patient_id || args.patient_id || null,
    eventType: 'appointment_rescheduled',
    payload: {
      appointment_id: appointmentId,
      patient_name: patientName,
      when: when || null,
      appointment_type: result?.appointment_type || args.appointment_type || null
    }
  });
}

function _emitAfterToolSuccess(toolName, result, context, args = {}) {
  if (!_toolSuccess(result)) return;
  const ctx = {
    sessionId: context.sessionId,
    clinicId: context.clinicId,
    patientId: context.patientId,
    customerId: context.customerId
  };
  if (toolName === 'cancel_appointment') {
    _emitAppointmentCancelled(ctx, result, args);
  } else if (toolName === 'reschedule_appointment') {
    _emitAppointmentRescheduled(ctx, result, args);
  }
}

function _emitNotificationFailed(ctx, channel, error, extra = {}) {
  try {
    db.insertKellyCallEvent?.({
      session_id: ctx.sessionId || null,
      event_type: 'notification_failed',
      payload_json: {
        channel: channel || 'unknown',
        error: String(error?.message || error || 'unknown'),
        clinic_id: ctx.clinicId || null,
        patient_id: ctx.patientId || null,
        ...extra
      }
    });
  } catch (_) {}
  _emitKellyActivityEvent({
    sessionId: ctx.sessionId,
    clinicId: ctx.clinicId,
    patientId: ctx.patientId,
    eventType: 'notification_failed',
    payload: {
      channel: channel || 'unknown',
      error: String(error?.message || error || 'unknown'),
      ...extra
    }
  });
}

const CHECKOUT_STAGES = require('../kelly-tool-executor/checkout-context').CHECKOUT_STAGES;

/** DB + tool keys for Skin & Care assessment (migration 021). */
const SKINCARE_ASSESSMENT_DB_KEYS = [
  'skin_type',
  'skin_concerns_json',
  'pregnancy_status',
  'prior_dermatologist_json',
  'functional_impact',
  'ingredient_reactions',
  'what_has_worked',
  'hormonal_context',
  'lifestyle_notes',
  'environment_notes',
  'triggers_json'
];

class KellyToolExecutor {
  // ── kelly_session_meta (payment_token persistence) ──────────────────────
  // Used to recover checkout/payment tokens across turns when the LLM
  // drops them from the tool-call args.
  static _ensureSessionMetaTable() {
    try {
      db.db.prepare(`
        CREATE TABLE IF NOT EXISTS kelly_session_meta_kv (
          session_id  TEXT NOT NULL,
          meta_key    TEXT NOT NULL,
          value       TEXT NOT NULL,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, meta_key)
        )
      `).run();
    } catch (_) {}
  }

  static _setSessionMeta(sessionId, key, value, opts = {}) {
    try {
      if (!sessionId || !key) return;
      const { assertMetaKvWriteAllowed } = require('../kelly/rails/meta-kv-policy');
      if (!assertMetaKvWriteAllowed(key, { fromMirror: !!opts.fromMirror, sessionId })) {
        return;
      }
      KellyToolExecutor._ensureSessionMetaTable();
      db.db.prepare(`
        INSERT OR REPLACE INTO kelly_session_meta_kv (session_id, meta_key, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(sessionId, key, String(value));
    } catch (_) {}
  }

  static _getSessionMeta(sessionId, key) {
    try {
      if (!sessionId || !key) return null;
      KellyToolExecutor._ensureSessionMetaTable();
      const row = db.db.prepare(`
        SELECT value
        FROM kelly_session_meta_kv
        WHERE session_id = ? AND meta_key = ?
        LIMIT 1
      `).get(sessionId, key);
      return row?.value ?? null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Read and clear last-turn UI attachments (provider cards, literature) for HTTP responses.
   * @returns {{ provider_cards: object[], literature_snippets: object[] }}
   */
  static consumeUiAttachments(sessionId) {
    const out = { provider_cards: [], literature_snippets: [] };
    if (!sessionId) return out;
    try {
      const pcRaw = KellyToolExecutor._getSessionMeta(sessionId, 'kelly_last_provider_cards_json');
      if (pcRaw) {
        const parsed = JSON.parse(pcRaw);
        if (Array.isArray(parsed)) out.provider_cards = parsed;
        KellyToolExecutor._setSessionMeta(sessionId, 'kelly_last_provider_cards_json', '');
      }
      const litRaw = KellyToolExecutor._getSessionMeta(sessionId, 'kelly_last_literature_snippets_json');
      if (litRaw) {
        const parsed = JSON.parse(litRaw);
        if (Array.isArray(parsed)) out.literature_snippets = parsed;
        KellyToolExecutor._setSessionMeta(sessionId, 'kelly_last_literature_snippets_json', '');
      }
    } catch (_) {}
    return out;
  }

  static _normalizeEmail(v) {
    return String(v || '').trim().toLowerCase();
  }

  static _normalizeE164Phone(v) {
    const raw = String(v || '').trim();
    if (!raw) return '';
    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    let normalized = '';
    if (hasPlus) normalized = '+' + digits;
    else if (digits.length === 10) normalized = '+1' + digits;
    else if (digits.length === 11 && digits.startsWith('1')) normalized = '+' + digits;
    else normalized = '+' + digits;
    return /^\+\d{8,15}$/.test(normalized) ? normalized : '';
  }

  static _setCheckoutStage(sessionId, stage, extra = null) {
    if (!sessionId || !stage) return false;
    const prevStage = KellyToolExecutor._getSessionMeta(sessionId, 'checkout_stage') || CHECKOUT_STAGES.COLLECTING_DETAILS;
    const transitionMeta = extra && typeof extra === 'object' ? { ...extra } : {};
    if (!Object.prototype.hasOwnProperty.call(transitionMeta, 'source')) transitionMeta.source = 'kelly_tool_executor';
    const applied = CheckoutWorkflowService.transitionStage(sessionId, String(stage), transitionMeta);
    if (!applied) {
      try {
        console.warn('[checkout-stage] transition_blocked', {
          session_id: String(sessionId),
          from: String(prevStage || ''),
          to: String(stage || ''),
          meta: transitionMeta
        });
      } catch (_) {}
      return false;
    }
    try {
      console.info('[checkout-stage] transition', {
        session_id: String(sessionId),
        from: String(prevStage || CHECKOUT_STAGES.COLLECTING_DETAILS),
        to: String(stage),
        meta: transitionMeta
      });
      db.incrementOpsCounter && db.incrementOpsCounter(`checkout_stage_transition_${String(stage)}`);
    } catch (_) {}
    return true;
  }

  static _getCheckoutStage(sessionId) {
    const raw = KellyToolExecutor._getSessionMeta(sessionId, 'checkout_stage');
    return String(raw || CHECKOUT_STAGES.COLLECTING_DETAILS);
  }

  static _getCheckoutContextVersion(sessionId) {
    const raw = parseInt(String(KellyToolExecutor._getSessionMeta(sessionId, 'checkout_context_version') || '1'), 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }

  static _bumpCheckoutContextVersion(sessionId, reason = 'context_bump') {
    if (!sessionId) return 1;
    const next = KellyToolExecutor._getCheckoutContextVersion(sessionId) + 1;
    KellyToolExecutor._setSessionMeta(sessionId, 'checkout_context_version', String(next));
    KellyToolExecutor._setSessionMeta(sessionId, 'checkout_context_version_updated_at_ms', String(Date.now()));
    KellyToolExecutor._setSessionMeta(sessionId, 'checkout_context_version_reason', String(reason || 'context_bump'));
    return next;
  }

  static _invalidateCheckoutReadiness(sessionId, reason = 'checkout_invalidation') {
    if (!sessionId) return true;
    const now = Date.now();
    const currentStage = KellyToolExecutor._getCheckoutStage(sessionId);
    const preserveEmailVerification = new Set([
      CHECKOUT_STAGES.CODE_VERIFIED,
      CHECKOUT_STAGES.CHECKOUT_PREPARED,
      CHECKOUT_STAGES.PAYMENT_CONFIRMED
    ]).has(currentStage);
    const preserveShipping = new Set([
      CHECKOUT_STAGES.CHECKOUT_PREPARED,
      CHECKOUT_STAGES.PAYMENT_CONFIRMED
    ]).has(currentStage);

    if (!preserveEmailVerification) {
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_pending', '');
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_pending_nonce', '');
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified', '');
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified_nonce', '');
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified_at_ms', '0');
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified_context_version', '0');
    }
    KellyToolExecutor._setSessionMeta(sessionId, 'commerce_verified_cart_fingerprint', '');
    if (!preserveShipping) {
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_complete', '0');
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_context_version', '0');
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_cart_fingerprint', '');
    }
    KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_id', '');
    KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_ts', '0');
    KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_inflight', '0');
    KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_consumed', '0');
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_token', '');
    KellyToolExecutor._setSessionMeta(sessionId, 'checkout_id', '');
    KellyToolExecutor._setSessionMeta(sessionId, 'checkout_stage_meta_payment_intent_id', '');
    KellyToolExecutor._setSessionMeta(sessionId, 'checkout_stage_meta_checkout_id', '');
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_confirm_attempted', '0');
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_outcome_status', '');
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_source', String(reason || 'checkout_invalidation'));
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_last_checked_at', String(now));
    let stageResetOk = true;
    if (!preserveEmailVerification) {
      const applied = KellyToolExecutor._setCheckoutStage(sessionId, CHECKOUT_STAGES.COLLECTING_DETAILS, {
        reason: String(reason || 'checkout_invalidation'),
        source: 'checkout_state_reset',
        force_hard_reset: String(reason || '').includes('explicit_checkout_reset')
      });
      stageResetOk = applied !== false;
    } else if (currentStage === CHECKOUT_STAGES.CODE_VERIFIED && !preserveShipping) {
      KellyToolExecutor._setSessionMeta(sessionId, 'cart_mutated_after_verify', '1');
    }
    return stageResetOk;
  }

  static hardResetCheckoutContext(sessionId, reason = 'explicit_checkout_reset') {
    if (!sessionId) return { success: false, error: 'session_id_required' };
    const version = KellyToolExecutor._bumpCheckoutContextVersion(sessionId, reason);
    const resetOk = KellyToolExecutor._invalidateCheckoutReadiness(sessionId, reason);
    KellyToolExecutor._setSessionMeta(sessionId, 'checkout_context_reset_at_ms', String(Date.now()));
    return {
      success: resetOk,
      checkout_context_version: version,
      error: resetOk ? undefined : 'checkout_stage_transition_blocked'
    };
  }

  static _isCommerceEmailVerificationValid(sessionId, email) {
    const normalizedEmail = KellyToolExecutor._normalizeEmail(email);
    if (!normalizedEmail) return false;
    const verifiedEmail = KellyToolExecutor._normalizeEmail(
      KellyToolExecutor._getSessionMeta(sessionId, 'commerce_email_verified')
    );
    if (!verifiedEmail || verifiedEmail !== normalizedEmail) return false;
    const verifiedAtRaw = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_email_verified_at_ms');
    const verifiedAt = parseInt(String(verifiedAtRaw || '0'), 10);
    if (!Number.isFinite(verifiedAt) || verifiedAt <= 0) return false;
    if (Date.now() - verifiedAt > COMMERCE_EMAIL_VERIFY_TTL_MS) return false;
    const pendingNonce = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_email_pending_nonce') || '';
    const verifiedNonce = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_email_verified_nonce') || '';
    if (!pendingNonce || !verifiedNonce || pendingNonce !== verifiedNonce) return false;
    const currentVersion = KellyToolExecutor._getCheckoutContextVersion(sessionId);
    const verifiedVersion = parseInt(
      String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_email_verified_context_version') || '0'),
      10
    );
    if (!Number.isFinite(verifiedVersion) || verifiedVersion !== currentVersion) return false;
    return true;
  }

  static _isShippingReadyForCurrentContext(sessionId) {
    const complete = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_complete') || '') === '1';
    if (!complete) return false;
    const line1 = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_line1') || '').trim();
    const city = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_city') || '').trim();
    const state = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_state') || '').trim();
    const postal = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_postal_code') || '').trim();
    if (!line1 || !city || !state || !postal) return false;
    const updatedAtRaw = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_updated_at_ms');
    const updatedAt = parseInt(String(updatedAtRaw || '0'), 10);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
    if (Date.now() - updatedAt > COMMERCE_SHIPPING_TTL_MS) return false;
    const currentVersion = KellyToolExecutor._getCheckoutContextVersion(sessionId);
    const shippingVersion = parseInt(
      String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_context_version') || '0'),
      10
    );
    if (!Number.isFinite(shippingVersion) || shippingVersion !== currentVersion) return false;
    return true;
  }

  /** Build structured shipping payload from session meta for PaymentOrchestrator / voice_checkouts. */
  static _buildShippingAddressFromMeta(sessionId) {
    const line1 = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_line1') || '').trim();
    const line2 = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_line2') || '').trim();
    const city = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_city') || '').trim();
    const state = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_state') || '').trim();
    const postal = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_postal_code') || '').trim();
    const country = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_country') || 'US').trim();
    if (line1 && city && state && postal) {
      return JSON.stringify({ line1, line2, city, state, postal_code: postal, country });
    }
    const full = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_address') || '').trim();
    return full || null;
  }

  /**
   * Refresh shipping TTL when fields/version are aligned but timestamp expired (Step10 bug 2).
   */
  static _refreshStaleShippingTtlIfEligible(sessionId) {
    try {
      if (KellyToolExecutor._isShippingReadyForCurrentContext(sessionId)) return;
      const complete = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_complete') || '') === '1';
      if (!complete) return;
      const line1 = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_line1') || '').trim();
      const city = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_city') || '').trim();
      const state = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_state') || '').trim();
      const postal = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_postal_code') || '').trim();
      if (!line1 || !city || !state || !postal) return;
      const cv = KellyToolExecutor._getCheckoutContextVersion(sessionId);
      const sv = parseInt(String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_context_version') || '0'), 10);
      if (!Number.isFinite(sv) || sv !== cv) return;
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_updated_at_ms', String(Date.now()));
    } catch (_) {}
  }

  static _computeCartFingerprint(sessionId, merchantId) {
    try {
      if (!sessionId || !merchantId) return '';
      const cart = db.getCommerceCart(sessionId, merchantId);
      const items = Array.isArray(cart?.items) ? [...cart.items] : [];
      items.sort((a, b) => String(a.product_id || '').localeCompare(String(b.product_id || '')));
      const normalized = items.map((it) => ({
        product_id: String(it.product_id || ''),
        quantity: Number(it.quantity || 0),
        unit_price: Number(it.unit_price || 0)
      }));
      return JSON.stringify(normalized);
    } catch (_) {
      return '';
    }
  }

  /**
   * Stable chat contract for prepare_commerce_checkout: cart summary, missing fields, payment action.
   * Called for both cart-based orchestrator path and HTTP /api/public/checkout/start path.
   */
  static _normalizePrepareCommerceCheckoutForChat(toolResult) {
    const base = toolResult && typeof toolResult === 'object' ? { ...toolResult } : { success: false };
    const checkout = base.checkout || {};
    const cart = base.cart || null;
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const cart_summary = {
      items: items.map((it) => ({
        product_id: it.product_id,
        name: it.name,
        quantity: it.quantity != null ? Number(it.quantity) : null,
        line_total: it.total != null ? Number(it.total) : null
      })),
      subtotal: cart != null && cart.subtotal != null ? Number(cart.subtotal) : null,
      item_count:
        cart != null && cart.item_count != null
          ? Number(cart.item_count)
          : items.length
    };
    if (!items.length && base.success && checkout.payment) {
      const pay = checkout.payment || {};
      const amt = pay.amount != null ? Number(pay.amount) : null;
      if (amt != null && Number.isFinite(amt)) {
        cart_summary.subtotal = amt;
        cart_summary.item_count = 1;
        cart_summary.source = 'single_checkout';
      }
    }
    const next_required_fields = [];
    if (base.success === false) {
      const err = String(base.error || '');
      if (err === 'email_required') next_required_fields.push('customer_email');
      if (err === 'cart_empty') next_required_fields.push('cart_items');
      if (err === 'merchant_required') next_required_fields.push('provider_id');
    }
    let payment_action = null;
    if (base.success) {
      const cs = checkout.client_secret || base.client_secret;
      const pi = checkout.payment_intent_id || base.payment_intent_id;
      const link = checkout.payment_link || base.payment_link;
      if (cs && pi) {
        payment_action = {
          type: 'stripe_payment_intent',
          client_secret: cs,
          payment_intent_id: pi,
          requires_action: !!checkout.requires_action
        };
      } else if (link) {
        payment_action = { type: 'payment_link', url: link };
      } else {
        payment_action = {
          type: 'pending',
          message: checkout.message || base.message || null
        };
      }
    }
    return {
      ...base,
      cart_summary,
      next_required_fields,
      payment_action,
      commerce_checkout: {
        cart_summary,
        next_required_fields,
        payment_action,
        success: !!base.success,
        error: base.success ? null : base.error || null,
        message: base.message || null
      }
    };
  }

  // ── Date helpers ───────────────────────────────────────────────────────
  static _normalizeToBusinessDate(dateStr, clinicId) {
    const normalized = normalizeDateStr(dateStr);
    if (!normalized) return dateStr;
    const clinicHours = getClinicBusinessHours(clinicId);
    if (isBusinessDay(normalized, clinicHours)) return normalized;
    const next = getNextBusinessDay(normalized, clinicHours) || normalized;
    if (next !== normalized && _kellyToolDebug()) {
      console.log(`[KellyToolExecutor] Non-business date ${normalized} → ${next}`);
    }
    return next;
  }

  static _httpTimeoutMs() {
    // Integrations/tests may need a longer server timeout; keep default unchanged.
    const v = parseInt(process.env.KELLY_TOOL_HTTP_TIMEOUT_MS || '15000', 10);
    return Number.isFinite(v) && v > 0 ? v : 15000;
  }

  // Shared truthiness helpers for triage/session gates.
  static _isCompleteFlag(value) {
    return value === 1 || value === true;
  }

  /**
   * Kelly executor wrapper for voice-triage-guards (SSOT for session gates).
   * Returns error response object or null when allowed.
   */
  static _enforceKellyTriageGuardrails(sessionId, args, bumpOp) {
    const { evaluateTriageGuardrailsForSession } = require('../voice/voice-triage-guards');
    const ev = evaluateTriageGuardrailsForSession(sessionId, args, bumpOp);
    if (ev.ok) return null;
    const prefix =
      bumpOp === 'insurance'
        ? 'voice_agent_misuse_collect_insurance'
        : bumpOp === 'slots'
          ? 'voice_agent_misuse_get_available_slots'
          : 'voice_agent_misuse_schedule_appointment';
    let bumpSuffix = ev.bump;
    if (ev.bump === 'triage_not_started') {
      bumpSuffix =
        bumpOp === 'insurance'
          ? 'no_session_row'
          : bumpOp === 'slots'
            ? 'no_rag_result'
            : 'no_triage_session_row';
    } else if (ev.bump === 'low_confidence' && bumpOp === 'schedule') {
      bumpSuffix = 'low_confidence';
    }
    KellyToolExecutor._bumpOpsCounter(`${prefix}_${bumpSuffix}`);
    return {
      success: false,
      error: ev.body.error,
      error_code: ev.body.error_code,
      message: ev.body.message
    };
  }

  static _hasText(value) {
    return !!String(value || '').trim();
  }

  /**
   * E1: Stored chief concern (quality) or onset on triage_sessions contradicts "no symptoms" routine bypass.
   */
  static _triageRowHasConcernOrOnsetStored(sessionId) {
    try {
      if (!sessionId || !db.getTriageSession) return false;
      const row = db.getTriageSession(sessionId);
      if (!row) return false;
      return KellyToolExecutor._hasText(row.quality) || KellyToolExecutor._hasText(row.onset);
    } catch (_) {
      return false;
    }
  }

  /**
   * E1: Session meta routine_no_symptoms only counts if triage row does not already record a concern/onset.
   */
  static _routineNoSymptomsEffective(sessionId) {
    try {
      const v = KellyToolExecutor._getSessionMeta(sessionId, 'routine_no_symptoms');
      const meta = String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true';
      if (!meta) return false;
      if (KellyToolExecutor._triageRowHasConcernOrOnsetStored(sessionId)) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  static _ragConfidenceThreshold() {
    const { CODING_CONFIDENCE_THRESHOLD } = require('../../config/coding-thresholds');
    return CODING_CONFIDENCE_THRESHOLD;
  }

  static _logGateBypass(sessionId, bypass, detail = {}) {
    try {
      db.insertKellyCallEvent?.({
        session_id: sessionId || null,
        event_type: 'gate_bypass',
        payload_json: JSON.stringify({ bypass, at: new Date().toISOString(), ...detail })
      });
    } catch (_) {}
  }

  static _logCodingProvenance(sessionId, payload = {}) {
    try {
      db.insertKellyCallEvent?.({
        session_id: sessionId || null,
        event_type: 'coding_provenance',
        payload_json: JSON.stringify({ at: new Date().toISOString(), ...payload })
      });
    } catch (_) {}
  }

  /** KELLY_E2E_SKIP_TRIAGE=1 + session meta — relaxes RAG confidence/differential gates in E2E only. */
  static _kellyE2eSkipTriageForSession(sessionId) {
    if (String(process.env.KELLY_E2E_SKIP_TRIAGE || '').trim() !== '1') return false;
    try {
      const v = KellyToolExecutor._getSessionMeta(sessionId, 'kelly_e2e_skip_triage');
      return String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true';
    } catch (_) {
      return false;
    }
  }

  /** True when triage is complete and not reopened — block re-run_triage_rag. */
  static _triageLockedForRerag(sessionId) {
    if (!sessionId || !db.getTriageSession) return false;
    const sessionRow = db.getTriageSession(sessionId);
    if (!sessionRow) return false;
    const triageComplete = KellyToolExecutor._isCompleteFlag(sessionRow.triage_complete);
    if (!triageComplete) return false;
    try {
      const v = KellyToolExecutor._getSessionMeta(sessionId, 'kelly_triage_reopen');
      const reopen = String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true';
      return !reopen;
    } catch (_) {
      return true;
    }
  }

  /** Missing/invalid DB rag_confidence → 0 for gating (do not default to threshold). */
  static _confidenceFromTriageRow(triageResult) {
    if (!triageResult || triageResult.rag_confidence == null || triageResult.rag_confidence === '') return 0;
    const n = parseFloat(triageResult.rag_confidence);
    return Number.isFinite(n) ? n : 0;
  }

  static _bumpOpsCounter(name) {
    try {
      if (db.incrementOpsCounter) db.incrementOpsCounter(name);
      console.warn('[KellyToolExecutor] misuse counter bumped:', name);
    } catch (_) {}
  }

  /** Merchant id for public commerce quote/checkout (Kelly HTTP calls to this server). */
  static _resolveMerchantIdForCommerce(args, clinicId) {
    const fromArgs = args && (args.provider_id || args.merchant_id);
    if (fromArgs) return String(fromArgs).trim();
    if (!clinicId) return null;
    try {
      const c = db.getClinic ? db.getClinic(clinicId) : null;
      return c?.merchant_id ? String(c.merchant_id).trim() : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Execute a named tool with args and session context.
   *
   * @param {string} toolName
   * @param {Object} args           - Arguments from LLM tool_call
   * @param {Object} context        - { sessionId, clinicId, patientId, callerPhone, channel }
   * @returns {Promise<Object>}     - Tool result (always an object, never throws to LLM)
   */
  static async execute(toolName, args, context) {
    const { sessionId, clinicId, patientId, callerPhone, channel } = context;
    const t0 = Date.now();

    if (_kellyToolDebug()) {
      console.log(`[KellyToolExecutor] ${toolName}`, { sessionId, clinicId });
    }

    _emitToolTelemetry(sessionId, 'tool_invoked', {
      tool_name: toolName,
      clinic_id: clinicId || null,
      patient_id: patientId || null,
      channel: channel || null
    });

    try {
      const result = await KellyToolExecutor._executeToolCore(toolName, args, context);
      const success = _toolSuccess(result);
      const latencyMs = Date.now() - t0;
      _emitToolTelemetry(sessionId, 'tool_completed', {
        tool_name: toolName,
        success,
        latency_ms: latencyMs,
        error: success ? null : result?.error || 'tool_failed',
        clinic_id: clinicId || null,
        patient_id: patientId || args?.patient_id || result?.patient_id || null,
        patient_name: args?.patient_name || result?.patient_name || result?.appointment?.patient_name || null,
        appointment_id: result?.appointment?.id || args?.appointment_id || result?.appointment_id || null,
        appointment_type: result?.appointment?.appointment_type || args?.appointment_type || null
      });
      if (sessionId && success) {
        const list = _turnToolLog.get(sessionId) || [];
        if (!list.includes(toolName)) list.push(toolName);
        _turnToolLog.set(sessionId, list);
        _emitAfterToolSuccess(toolName, result, context, args);
      }
      return result;
    } catch (err) {
      const latencyMs = Date.now() - t0;
      _emitToolTelemetry(sessionId, 'tool_completed', {
        tool_name: toolName,
        success: false,
        latency_ms: latencyMs,
        error: err.message,
        clinic_id: clinicId || null
      });
      if (toolName === 'prepare_commerce_checkout') {
        try {
          KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_inflight', '0');
        } catch (_) {}
      }
      console.error(`[KellyToolExecutor] ${toolName} error:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /** Tools successfully executed this turn (cleared at turn start). */
  static beginTurnToolLog(sessionId) {
    const sid = String(sessionId || '').trim();
    if (sid) _turnToolLog.set(sid, []);
  }

  static getTurnToolsUsed(sessionId) {
    const sid = String(sessionId || '').trim();
    return [...(_turnToolLog.get(sid) || [])];
  }

  static clearTurnToolLog(sessionId) {
    const sid = String(sessionId || '').trim();
    if (sid) _turnToolLog.delete(sid);
  }

  static async _executeToolCore(toolName, args, context) {
    const { sessionId, clinicId, patientId, callerPhone, channel } = context;

    try {
      switch (toolName) {

        case 'collect_insurance':
          return await this._collectInsurance(args, { sessionId, patientId, callerPhone });

        case 'compute_visit_quote': {
          const { computeVisitQuote } = require('../payor/payer-quote-service');
          const { resolveInsuranceCodes } = require('../shared/resolve-insurance-codes');
          const codingReviewSvc = require('../clinical/coding-review-service');
          const resolved = resolveInsuranceCodes(sessionId, {
            service_code: args.primary_cpt || args.service_code || null,
            force_after_clarified: args.force_after_clarified === true || args.force_after_clarified === 'true',
            clinicId: args.clinic_id || clinicId || null,
            patientId: args.patient_id || patientId || null,
            flagHitl: (p) => codingReviewSvc.flagForReview(p)
          });
          if (!resolved.ok) {
            return {
              success: false,
              error: resolved.error_code || resolved.status,
              error_code: resolved.error_code || resolved.status,
              message: resolved.message
            };
          }
          const quote = await computeVisitQuote({
            primary_icd10: resolved.primary_icd10,
            primary_cpt: resolved.primary_cpt,
            payer_id: args.payer_id,
            plan_id: args.plan_id,
            call_id: sessionId,
            session_id: sessionId
          });
          if (quote.status === 'hard_number' && sessionId) {
            KellyToolExecutor._setSessionMeta(sessionId, 'last_quote_status', quote.status);
            KellyToolExecutor._setSessionMeta(sessionId, 'last_copay_due', String(quote.copay_due_now));
            if (args.deliver_quote === true || args.deliver_quote === 'true') {
              KellyToolExecutor._setSessionMeta(sessionId, 'quote_delivered', '1');
            }
          }
          KellyToolExecutor._logCodingProvenance(sessionId, {
            tool: 'compute_visit_quote',
            primary_icd10: resolved.primary_icd10,
            primary_cpt: resolved.primary_cpt,
            quote_status: quote.status,
            copay_due_now: quote.copay_due_now,
            rule_id: quote.rule_id || null,
            code_pair_valid: resolved.code_pair_valid
          });
          return { success: true, quote };
        }

        case 'suggest_codes_from_symptoms': {
          const visitCodes = require('../clinical/visit-codes-service');
          const text = args.clinical_text || args.symptoms || '';
          const codes = await visitCodes.getVisitCodes(text, {
            clinicId,
            callId: sessionId,
            maxIcd10: args.max_icd10 || 5,
            maxCpt: args.max_cpt || 3,
            useSemantic: args.use_semantic !== false
          });
          return { success: true, ...codes };
        }

        case 'get_available_slots':
          return await this._getAvailableSlots(args, { sessionId, clinicId, patientId, channel });

        case 'schedule_appointment': {
          const THRESHOLD = KellyToolExecutor._ragConfidenceThreshold();
          const bump = (n) => KellyToolExecutor._bumpOpsCounter(n);

          const routineNoSymptoms = KellyToolExecutor._routineNoSymptomsEffective(sessionId);
          const triageReopenSchedule = (() => {
            try {
              const v = KellyToolExecutor._getSessionMeta ? KellyToolExecutor._getSessionMeta(sessionId, 'kelly_triage_reopen') : null;
              return String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true';
            } catch (_) {
              return false;
            }
          })();

          const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;

          // Routine/no-symptoms path: bypass full triage stack when session has routine_no_symptoms flag.
          // Voice HTTP guardrails (allowRoutineBypass) already permit schedule; executor must not block.
          if (routineNoSymptoms && !triageReopenSchedule) {
            const { ensurePreventiveSpine } = require('../clinical/preventive-visit-spine');
            const preventive = await ensurePreventiveSpine({
              sessionId,
              patientId,
              clinicId,
              isNewPatient: args.is_new_patient !== false
            });
            if (preventive.hitl_required) {
              try {
                const codingReview = require('../clinical/coding-review-service');
                codingReview.flagForReview({
                  sessionId,
                  clinicId,
                  patientId,
                  proposed_icd10: preventive.proposed_icd10 || '',
                  proposed_cpt: preventive.proposed_cpt || '',
                  confidence: preventive.confidence || 0,
                  reason: preventive.reason || 'preventive_spine_hitl'
                });
              } catch (_) {}
              return {
                success: false,
                error: 'CODING_REVIEW_REQUIRED',
                error_code: 'CODING_REVIEW_REQUIRED',
                message: 'A clinical reviewer must confirm preventive visit codes before scheduling.'
              };
            }
            const syntheticTriage = {
              target_specialty: 'Primary Care',
              urgency: 'routine',
              primary_icd10: preventive.primary_icd10,
              primary_cpt: preventive.primary_cpt,
              soap_note: 'Routine wellness visit — preventive care'
            };
            const primaryCptRoutine = preventive.primary_cpt;
            const normalizedArgsRoutine = { ...args };
            if (normalizedArgsRoutine.date) {
              normalizedArgsRoutine.date = KellyToolExecutor._normalizeToBusinessDate(normalizedArgsRoutine.date, clinicId);
            }
            const rawTime = String(args.time || '').trim();
            const rawLane = String(args.lane || '').trim();
            const isAsyncSlot = rawTime.toUpperCase().includes('ASYNC') || rawLane.toLowerCase().includes('async');
            const normalizedTime = rawTime && !rawTime.toUpperCase().includes('ASYNC') ? rawTime : '11:30 AM';
            normalizedArgsRoutine.time = normalizedTime;
            const visitMode = isAsyncSlot ? 'sync_video' : (String(rawLane || '').toLowerCase() === 'async' ? 'async_review' : 'sync_video');
            const scheduleEndpoint = channel === 'chat' ? '/api/appointments/schedule' : '/voice/appointments/schedule';
            const scheduleResultRoutine = await this._post(scheduleEndpoint, {
              ...normalizedArgsRoutine,
              appointment_type: normalizedArgsRoutine.appointment_type || 'Primary Care',
              clinic_id: clinicId,
              visit_mode: visitMode,
              notes: normalizedArgsRoutine.notes || syntheticTriage.soap_note,
              primary_icd10: preventive.primary_icd10,
              primary_cpt: primaryCptRoutine || null,
              metadata: { session_id: sessionId },
              session_id: sessionId
            });
            if (scheduleResultRoutine?.success && scheduleResultRoutine?.appointment?.id) {
              _emitAppointmentBooked(
                { sessionId, clinicId, patientId },
                scheduleResultRoutine.appointment,
                { patient_name: normalizedArgsRoutine.patient_name }
              );
              try {
                const { persistCaseSummaryForAppointment } = require('../clinical/case-summary-service');
                persistCaseSummaryForAppointment({
                  appointmentId: scheduleResultRoutine.appointment.id,
                  sessionId,
                  practitionerId: scheduleResultRoutine.appointment.practitioner_id || null
                });
              } catch (csErr) {
                console.warn('[KellyToolExecutor] case summary persist failed (non-fatal):', csErr.message);
              }
              if (channel === 'voice' && sessionId && db.setVoiceCallOutcome) {
                try {
                  const VoiceAgentRuntime = require('../voice/voice-agent-runtime');
                  const oc = VoiceAgentRuntime.outcomeForScheduledAppointment(
                    scheduleResultRoutine.appointment
                  );
                  db.setVoiceCallOutcome(sessionId, oc);
                } catch (_) {}
              }
              try {
                const { autoCheckoutAfterSchedule } = require('../platform/auto-checkout-after-schedule');
                const base = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
                const checkoutResult = await autoCheckoutAfterSchedule({
                  base,
                  appointmentId: scheduleResultRoutine.appointment.id,
                  patient_phone: normalizedArgsRoutine.patient_phone || callerPhone,
                  patient_email: normalizedArgsRoutine.patient_email,
                  patient_name: normalizedArgsRoutine.patient_name || 'Patient',
                  clinic_id: clinicId,
                  appointment_type: 'Primary Care',
                  triage_session_id: sessionId,
                  customer_type: _resolveCustomerType(clinicId, null),
                  timeoutMs: KellyToolExecutor._httpTimeoutMs()
                });
                if (_kellyToolDebug()) {
                  console.log('[DEBUG-CHECKOUT] autoCheckoutAfterSchedule result (routine):', JSON.stringify({
                    success: !!checkoutResult,
                    payment_token: checkoutResult?.payment_token ? checkoutResult.payment_token.slice(0, 12) + '…' : null,
                    checkout_id: checkoutResult?.checkout_id || null,
                    requires_verification: checkoutResult?.requires_verification,
                    error: checkoutResult?.error || null
                  }));
                }
                if (checkoutResult?.payment_token) {
                  KellyToolExecutor._setSessionMeta(sessionId, 'payment_token', checkoutResult.payment_token);
                  KellyToolExecutor._setSessionMeta(sessionId, 'checkout_id', checkoutResult.checkout_id || '');
                }
                return {
                  ...scheduleResultRoutine,
                  checkout: checkoutResult,
                  payment_token: checkoutResult?.payment_token || null,
                  checkout_id: checkoutResult?.checkout_id || null,
                  requires_verification: !!checkoutResult?.requires_verification,
                  say_to_patient: checkoutResult?.requires_verification
                    ? `Your appointment is confirmed. A verification code was sent to ${normalizedArgsRoutine.patient_email}. Enter the 6-digit code to complete payment.`
                    : 'Your appointment is confirmed.'
                };
              } catch (checkoutErr) {
                console.warn('[KellyToolExecutor] Routine schedule checkout failed:', checkoutErr?.message);
                _emitNotificationFailed(
                  { sessionId, clinicId, patientId },
                  'checkout',
                  checkoutErr,
                  { appointment_id: scheduleResultRoutine?.appointment?.id || null }
                );
                return scheduleResultRoutine;
              }
            }
            if (scheduleResultRoutine?.requiresPhone) {
              return {
                ...scheduleResultRoutine,
                next_step:
                  'Ask the patient for their phone number. When they provide it, call schedule_appointment again with the SAME patient_name and patient_email you already have, plus patient_phone. Do NOT ask for name or email again.'
              };
            }
            return scheduleResultRoutine || { success: false, error: 'Schedule failed' };
          }

          if (triageReopenSchedule) {
            bump('voice_agent_misuse_schedule_appointment_triage_reopen');
            return {
              success: false,
              error: 'TRIAGE_REOPEN',
              error_code: 'TRIAGE_REOPEN',
              message:
                'New or changed symptoms were flagged. Complete OPQRST and run_triage_rag again before scheduling.'
            };
          }

          const triageForNotes = TriageRAGService.getAuthoritativeForSession(sessionId);
          if (!triageForNotes) {
            bump('voice_agent_misuse_schedule_appointment_no_rag_result');
            return {
              success: false,
              error: 'TRIAGE_REQUIRED',
              error_code: 'TRIAGE_REQUIRED',
              message: 'Please complete triage first (run_triage_rag) before scheduling.'
            };
          }

          const confidence = KellyToolExecutor._confidenceFromTriageRow(triageForNotes);
          const forceAfterClarified = args.force_after_clarified === true || args.force_after_clarified === 'true';
          const confidenceNearThreshold = isConfidenceNearThreshold(confidence, THRESHOLD);
          const sessionRowForBorderline = db.getTriageSession ? db.getTriageSession(sessionId) : null;
          const allowBorderlineProgress = !!(
            forceAfterClarified &&
            sessionRowForBorderline &&
            KellyToolExecutor._isCompleteFlag(sessionRowForBorderline.opqrst_complete) &&
            !!sessionRowForBorderline.intake_complete_at &&
            confidenceNearThreshold
          );

          const scheduleGuard = KellyToolExecutor._enforceKellyTriageGuardrails(sessionId, args, 'schedule');
          if (scheduleGuard) {
            if (!(scheduleGuard.error_code === 'LOW_CONFIDENCE' && allowBorderlineProgress)) {
              return scheduleGuard;
            }
          }

          const journeyGates = require('../platform/journey-gates-service');
          const codingGate = journeyGates.checkCodingGate({ sessionId, triageRow: sessionRowForBorderline, db });
          if (!codingGate.allowed && !allowBorderlineProgress) {
            bump('voice_agent_misuse_schedule_appointment_low_confidence');
            return {
              success: false,
              error: 'LOW_CONFIDENCE',
              error_code: 'LOW_CONFIDENCE',
              message: codingGate.holding_utterance
            };
          }

          const journeyGatesBooking = require('../platform/journey-gates-service');
          const quoteDelivered = KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered');
          const bookingQuoteGate = journeyGatesBooking.checkBookingAfterQuoteGate({
            sessionFlags: { quote_delivered: quoteDelivered }
          });
          if (!bookingQuoteGate.allowed && !routineNoSymptoms) {
            bump('voice_agent_misuse_schedule_appointment_quote_not_delivered');
            return {
              success: false,
              error: 'QUOTE_REQUIRED',
              error_code: 'QUOTE_REQUIRED',
              message: bookingQuoteGate.holding_utterance
            };
          }
          if (!bookingQuoteGate.allowed && routineNoSymptoms) {
            KellyToolExecutor._logGateBypass(sessionId, 'routine_no_symptoms_booking_quote', {
              quote_delivered: quoteDelivered
            });
          }

          // W4-S6.5: Surface soap_note for specialist at appointment creation
          const soapNote = triageForNotes?.soap_note || null;
          const notes = args.notes
            ? (soapNote ? `${soapNote}\n\n---\n${args.notes}` : args.notes)
            : soapNote;
          // W3-S4.2: Pass resolved ICD/CPT from triage spine for billing (same resolver as collect)
          const { resolveInsuranceCodes } = require('../shared/resolve-insurance-codes');
          const scheduleResolved = resolveInsuranceCodes(sessionId, {
            service_code: args.service_code,
            adminOverride: args.admin_coding_override === true || args.admin_coding_override === 'true',
            force_after_clarified: forceAfterClarified,
            clinicId,
            patientId,
            isNewPatient: args.is_new_patient !== false
          });
          if (!scheduleResolved.ok) {
            bump('voice_agent_misuse_schedule_appointment_invalid_codes');
            return {
              success: false,
              error: scheduleResolved.error_code || scheduleResolved.status,
              error_code: scheduleResolved.error_code || scheduleResolved.status,
              message: scheduleResolved.message,
              invalid_codes: scheduleResolved.invalid_codes
            };
          }
          const primaryCpt = scheduleResolved.primary_cpt;

          // The async slot provider can return `time: "ASYNC"`.
          // Some downstream booking/check-out paths require a concrete time and/or a
          // "sync" scheduling mode so the backend produces an `appointment.id`.
          const rawTime = String(args.time || '').trim();
          const rawLane = String(args.lane || '').trim();
          const isAsyncSlot = rawTime.toUpperCase().includes('ASYNC') || rawLane.toLowerCase().includes('async');

          if (args.date) {
            args = { ...args, date: KellyToolExecutor._normalizeToBusinessDate(args.date, clinicId) };
          }

          const normalizedTime = (() => {
            const t = String(args.time || '').trim();
            if (!t) return args.time;
            const up = t.toUpperCase();
            if (up === 'ASYNC' || up.includes('ASYNC')) return '11:30 AM';
            return args.time;
          })();
          const normalizedArgs = { ...args, time: normalizedTime };
          const visitMode = (() => {
            // If we detected an async slot, schedule as a sync visit mode to ensure
            // the appointment_id + checkout pipeline is available.
            if (isAsyncSlot) return 'sync_video';
            const v = String(normalizedArgs.lane || '').trim() || 'sync_video';
            if (v.toLowerCase() === 'sync') return 'sync_video';
            return v || 'sync_video';
          })();

          const scheduleEndpoint = channel === 'chat' ? '/api/appointments/schedule' : '/voice/appointments/schedule';
          const scheduleResult = await this._post(scheduleEndpoint, {
            ...normalizedArgs,
            clinic_id: clinicId,
            visit_mode: visitMode,
            notes: notes || args.notes,
            primary_icd10: scheduleResolved.primary_icd10 || triageForNotes?.primary_icd10 || null,
            primary_cpt: primaryCpt || null,
            // Ensure backend guardrails can reliably associate this tool call
            // with the triage session.
            metadata: { session_id: sessionId },
            session_id: sessionId
          });

          // Auto-chain schedule -> checkout through shared helper so all entry points
          // use one deduped checkout path (A2).
          if (scheduleResult?.success && scheduleResult?.appointment?.id) {
            _emitAppointmentBooked(
              { sessionId, clinicId, patientId },
              scheduleResult.appointment,
              { patient_name: normalizedArgs.patient_name }
            );
            try {
              const { persistCaseSummaryForAppointment } = require('../clinical/case-summary-service');
              persistCaseSummaryForAppointment({
                appointmentId: scheduleResult.appointment.id,
                sessionId,
                practitionerId: scheduleResult.appointment.practitioner_id || null
              });
            } catch (csErr) {
              console.warn('[KellyToolExecutor] case summary persist failed (non-fatal):', csErr.message);
            }
            if (channel === 'voice' && sessionId && db.setVoiceCallOutcome) {
              try {
                const VoiceAgentRuntime = require('../voice/voice-agent-runtime');
                const oc = VoiceAgentRuntime.outcomeForScheduledAppointment(
                  scheduleResult.appointment
                );
                db.setVoiceCallOutcome(sessionId, oc);
              } catch (_) {}
            }
            try {
              const appointmentId = scheduleResult.appointment.id;
              const patientEmail =
                normalizedArgs.patient_email ||
                scheduleResult.appointment.patient_email ||
                null;
              const patientName =
                normalizedArgs.patient_name ||
                scheduleResult.appointment.patient_name ||
                'Patient';
              const patientPhone =
                normalizedArgs.patient_phone ||
                scheduleResult.appointment.patient_phone ||
                callerPhone ||
                null;

              const { autoCheckoutAfterSchedule } = require('../platform/auto-checkout-after-schedule');
              const base = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
              const checkoutResult = await autoCheckoutAfterSchedule({
                base,
                appointmentId,
                patient_phone: patientPhone,
                patient_email: patientEmail,
                patient_name: patientName,
                clinic_id: clinicId,
                appointment_type:
                  normalizedArgs.appointment_type ||
                  triageForNotes?.target_specialty ||
                  scheduleResult.appointment.appointment_type,
                triage_session_id: sessionId || null,
                customer_type: _resolveCustomerType(clinicId, null),
                timeoutMs: KellyToolExecutor._httpTimeoutMs()
              });
              if (_kellyToolDebug()) {
                console.log('[DEBUG-CHECKOUT] autoCheckoutAfterSchedule result:', JSON.stringify({
                  success: !!checkoutResult,
                  payment_token: checkoutResult?.payment_token ? checkoutResult.payment_token.slice(0, 12) + '…' : null,
                  checkout_id: checkoutResult?.checkout_id || null,
                  requires_verification: checkoutResult?.requires_verification,
                  error: checkoutResult?.error || null
                }));
              }
              if (checkoutResult?.payment_token) {
                KellyToolExecutor._setSessionMeta(sessionId, 'payment_token', checkoutResult.payment_token);
                KellyToolExecutor._setSessionMeta(sessionId, 'checkout_id', checkoutResult.checkout_id || '');
              }

              return {
                ...scheduleResult,
                checkout: checkoutResult,
                payment_token: checkoutResult?.payment_token || null,
                checkout_id: checkoutResult?.checkout_id || null,
                requires_verification: !!checkoutResult?.requires_verification,
                email_sent: !!checkoutResult?.email_sent,
                message:
                  checkoutResult?.message ||
                  (checkoutResult?.email_sent ? 'Verification code emailed' : undefined),
                next_step:
                  'The appointment is booked. A verification code has been sent to your email. Please provide the 6-digit code to complete checkout.'
              };
            } catch (checkoutErr) {
              console.warn('[KellyToolExecutor] auto checkout chain failed (non-fatal):', checkoutErr.message);
              _emitNotificationFailed(
                { sessionId, clinicId, patientId },
                'checkout',
                checkoutErr,
                { appointment_id: scheduleResult?.appointment?.id || null }
              );
              // Fall back to schedule result only; LLM can call create_appointment_checkout itself.
            }
          }

          // When phone is required, tell the LLM to ask for it then retry with SAME name/email—do NOT re-ask for name
          if (scheduleResult?.requiresPhone) {
            return {
              ...scheduleResult,
              next_step:
                'Ask the patient for their phone number. When they provide it, call schedule_appointment again with the SAME patient_name and patient_email you already have, plus patient_phone. Do NOT ask for name or email again.'
            };
          }

          return scheduleResult;
        }

        case 'search_appointments':
          return await this._post('/voice/appointments/search', {
            search_term: args.search_term,
            clinic_id: clinicId
          });

        case 'confirm_appointment':
          return await this._post('/voice/appointments/confirm', {
            appointment_id: args.appointment_id,
            clinic_id: clinicId
          });

        case 'cancel_appointment':
          return await this._post('/voice/appointments/cancel', {
            appointment_id: args.appointment_id,
            reason: args.reason || null,
            clinic_id: clinicId
          });

        case 'reschedule_appointment':
          return await this._post('/voice/appointments/reschedule', {
            appointment_id: args.appointment_id,
            new_date: args.new_date,
            new_time: args.new_time,
            reason: args.reason || null,
            timezone: args.timezone || null,
            clinic_id: clinicId
          });

        case 'create_appointment_checkout': {
          const checkoutResult = await this._post('/voice/appointments/checkout', {
            ...args,
            clinic_id: clinicId
          });
          if (checkoutResult?.payment_token) {
            KellyToolExecutor._setSessionMeta(sessionId, 'payment_token', checkoutResult.payment_token);
            KellyToolExecutor._setSessionMeta(sessionId, 'checkout_id', checkoutResult.checkout_id || '');
          }
          return {
            ...checkoutResult,
            message:
              checkoutResult?.message ||
              (checkoutResult?.email_sent ? 'Verification code emailed' : undefined)
          };
        }

        case 'verify_checkout_code':
          {
            // If the model dropped payment_token from its tool args, recover it from session meta.
            let paymentToken = args.payment_token;
            if (!paymentToken) {
              paymentToken = KellyToolExecutor._getSessionMeta(sessionId, 'payment_token');
            }
            // Recovery: attempt DB lookup by triage session when token is still missing.
            if (!paymentToken) {
              try {
                const row = db.db?.prepare(`
                  SELECT pt.token AS payment_token
                  FROM voice_checkouts vc
                  INNER JOIN payment_tokens pt ON pt.checkout_id = vc.id
                  WHERE vc.triage_session_id = ?
                    AND (vc.status IS NULL OR vc.status != 'completed')
                    AND (pt.status IS NULL OR pt.status != 'completed')
                  ORDER BY vc.created_at DESC, pt.created_at DESC
                  LIMIT 1
                `).get(sessionId);
                if (row?.payment_token) {
                  paymentToken = row.payment_token;
                  KellyToolExecutor._setSessionMeta(sessionId, 'payment_token', paymentToken);
                  if (_kellyToolDebug()) {
                    console.log('[TOKEN-RECOVERY] Recovered payment_token from DB for session:', String(sessionId || '').slice(0, 8));
                  }
                }
              } catch (_) {}
            }
            if (!paymentToken) {
              return {
                success: false,
                error: 'MISSING_TOKEN',
                message:
                  "I couldn't find your payment session. Let me resend the verification code - what's your email address?"
              };
            }
            return await this._post('/voice/checkout/verify', {
              payment_token: paymentToken,
              verification_code: args.verification_code,
              clinic_id: clinicId
            });
          }

        case 'request_patient_payment': {
          const journeyGates = require('../platform/journey-gates-service');
          const quoteDelivered = KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered');
          const paymentGate = journeyGates.checkPaymentGate({
            sessionFlags: { quote_delivered: quoteDelivered }
          });
          if (!paymentGate.allowed) {
            return {
              success: false,
              error: 'QUOTE_REQUIRED',
              error_code: 'QUOTE_REQUIRED',
              message: paymentGate.holding_utterance
            };
          }
          const paymentRequestService = require('../rcm/rcm-payment-request-service');
          const resolvedPatientId = args.patient_id || patientId || null;
          const result = paymentRequestService.createRcmPaymentRequest({
            clinicId,
            amount: args.amount,
            journeyId: args.journey_id || null,
            patientId: resolvedPatientId,
            method: 'kelly_request',
          });
          if (!result.success) return result;

          let patientEmail = args.patient_email || args.customer_email || null;
          let patientPhone = args.patient_phone || callerPhone || null;
          if (resolvedPatientId && (!patientEmail || !patientPhone)) {
            try {
              const fhir = db.getFHIRPatient(resolvedPatientId);
              if (fhir) {
                patientEmail = patientEmail || fhir.email || null;
                patientPhone = patientPhone || fhir.phone || null;
              }
            } catch (_) {}
          }

          const delivery = args.delivery || 'both';
          const notify = await paymentRequestService.notifyPatientPaymentLink({
            payUrl: result.pay_url,
            amount: result.amount,
            patientEmail,
            patientPhone,
            delivery,
            clinicId,
          });

          if (sessionId) {
            KellyToolExecutor._setSessionMeta(sessionId, 'rcm_pay_token', result.pay_token);
            KellyToolExecutor._setSessionMeta(sessionId, 'rcm_payment_id', result.payment_id);
          }

          _emitKellyActivityEvent({
            sessionId,
            clinicId,
            patientId: resolvedPatientId,
            eventType: 'payment_link_sent',
            payload: {
              payment_id: result.payment_id,
              pay_token: result.pay_token,
              amount: result.amount,
              patient_name: args.patient_name || null,
            },
          });
          try {
            const { sendPostCallOwnerEmail } = require('../shared/post-call-owner-email');
            sendPostCallOwnerEmail({
              eventType: 'payment_link_sent',
              sessionId,
              clinicId,
              patientId: resolvedPatientId,
              patientName: args.patient_name,
              payload: { amount: result.amount, payment_id: result.payment_id }
            }).catch(() => {});
          } catch (_) {}

          const journeyId = args.journey_id || null;
          if (result.success && journeyId && clinicId) {
            try {
              const orchestrator = require('../rcm/rcm-journey-orchestrator');
              orchestrator.advanceStage({
                journeyId,
                clinicId,
                stageTo: 'patient_collection',
                eventType: 'payment_link_sent',
                payload: { payment_id: result.payment_id, pay_token: result.pay_token, amount: result.amount },
                options: { skipGates: true },
              });
            } catch (advErr) {
              console.warn('[request_patient_payment] journey advance:', advErr.message);
            }
          }

          const sentParts = [];
          if (patientEmail && (delivery === 'email' || delivery === 'both')) sentParts.push('email');
          if (patientPhone && (delivery === 'sms' || delivery === 'both')) sentParts.push('text');

          return {
            ...result,
            email_sent: sentParts.includes('email'),
            sms_sent: sentParts.includes('text'),
            message:
              `Secure payment link for $${Number(result.amount).toFixed(2)}` +
              (sentParts.length ? ` sent via ${sentParts.join(' and ')}` : '') +
              '. Ask the patient to open the link to pay with card or USDC wallet. Do not collect card numbers on the call.',
          };
        }

        case 'get_patient_claims':
          return await this._getPatientClaims(args, sessionId);

        case 'get_triage_session':
          return this._getTriageSession(sessionId);

        case 'store_triage_opqrst':
          return this._storeTriageOpqrst(args, sessionId, patientId, context);

        case 'store_triage_rich_intake':
          return this._storeTriageRichIntake(args, sessionId, patientId);

        case 'run_triage_rag':
          return await this._runTriageRAG(args, sessionId, patientId, clinicId);

        case 'request_document_upload':
          return await this._requestDocumentUpload(args, sessionId, patientId, callerPhone, channel);

        case 'query_patient_records':
          return await this._queryPatientRecords(args, patientId);

        case 'resolve_product_ingredients':
          return await this._resolveProductIngredients(args);

        case 'lookup_ingredient_functions':
          return await this._lookupIngredientFunctions(args);

        case 'evaluate_skincare_routine':
          return await KellyToolExecutor._evaluateSkincareRoutine(args, sessionId);

        case 'retrieve_ingredient_monographs':
          return KellyToolExecutor._retrieveIngredientMonographs(args);

        case 'get_ingredient_resolution_metrics':
          return KellyToolExecutor._getIngredientResolutionMetrics();

        case 'get_catalog_coverage_metrics':
          return KellyToolExecutor._getCatalogCoverageMetrics();

        case 'run_derm_patient_qa':
          return await KellyToolExecutor._runDermPatientQA(args, patientId);

        case 'end_call':
          return { success: true, end_call: true };

        case 'transfer_call': {
          const { attemptEscalation } = require('../platform/escalation-service');
          const esc = attemptEscalation(db, {
            sessionId,
            clinicId,
            customerId: context.customerId || context.customer_id || null,
            reason: args.reason || 'tool_transfer_call',
            locale: context.locale || args.locale || 'en',
            callId: context.callId || context.call_id || null
          });
          return {
            success: true,
            transfer_number: esc.transfer_number || null,
            reply: esc.reply || null,
            outcome: esc.outcome,
            end_call: esc.end_call || false
          };
        }

        case 'return_to_triage': {
          if (KellyToolExecutor._triageLockedForRerag(sessionId)) {
            return {
              success: true,
              skipped_reopen: true,
              message:
                'Clinical triage is already complete for this visit. Continue with booking, or describe new or changed symptoms if something has changed since triage.'
            };
          }
          try {
            KellyToolExecutor._setSessionMeta(sessionId, 'kelly_triage_reopen', '1');
            KellyToolExecutor._setSessionMeta(sessionId, 'skincare_post_intake', '0');
          } catch (_) {}
          return {
            success: true,
            phase_escalation: true,
            message:
              'Triage is re-opened. Collect OPQRST and call run_triage_rag before get_available_slots or schedule_appointment.'
          };
        }

        case 'get_product_quote': {
          const merchantId = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
          if (!merchantId) {
            return {
              success: false,
              error: 'merchant_required',
              message: 'Could not resolve merchant/provider for this clinic. Pass provider_id or configure clinic merchant_id.'
            };
          }
          const productId = args.product_id || args.prescription_id;
          if (!productId) {
            return { success: false, error: 'product_id_required' };
          }
          const quoteResult = await this._post('/api/public/commerce/quote', {
            product_id: productId,
            prescription_id: productId,
            provider_id: merchantId,
            quantity: args.quantity
          });
          if (!quoteResult || quoteResult.success === false) return quoteResult;
          const amount = Number.isFinite(Number(quoteResult.amount)) ? Number(quoteResult.amount) : null;
          const subtotal =
            Number.isFinite(Number(quoteResult.subtotal)) ? Number(quoteResult.subtotal) : amount;
          const taxAmount =
            Number.isFinite(Number(quoteResult.tax_amount)) ? Number(quoteResult.tax_amount) : 0;
          const taxRate =
            Number.isFinite(Number(quoteResult.tax_rate)) ? Number(quoteResult.tax_rate) : 0;
          const taxIncluded = quoteResult.tax_included === true;
          const quoteId = quoteResult.quote_id || quoteResult.checkout_session_id || null;
          return {
            ...quoteResult,
            quote_id: quoteId,
            checkout_session_id: quoteId,
            amount,
            subtotal,
            tax_amount: taxAmount,
            tax_rate: taxRate,
            tax_included: taxIncluded,
            price_note: quoteResult.price_note || 'See checkout for any applicable taxes.',
            currency: quoteResult.currency || 'USD',
            expires_at: quoteResult.expires_at || null
          };
        }

        case 'get_cart': {
          const merchantId = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
          if (!merchantId) return { success: false, error: 'merchant_required' };
          const cart = db.getCommerceCart(sessionId, merchantId) || {
            id: sessionId,
            merchant_id: merchantId,
            items: [],
            subtotal: 0,
            item_count: 0
          };
          return { success: true, cart };
        }

        case 'add_to_cart': {
          const merchantId = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
          const productId = args.product_id || args.prescription_id;
          const quantity = Math.max(1, Number(args.quantity) || 1);
          if (!merchantId) return { success: false, error: 'merchant_required' };
          if (!productId) return { success: false, error: 'product_id_required' };
          if (await db.isCommerceCartLocked(sessionId, merchantId)) {
            return {
              success: false,
              error: 'cart_locked',
              message: 'Cart is locked while checkout is in progress.'
            };
          }
          const product = db.getProduct(productId);
          if (!product) return { success: false, error: 'product_not_found' };
          if (product.merchant_id && product.merchant_id !== merchantId) {
            return { success: false, error: 'product_merchant_mismatch' };
          }
          const existing = db.getCommerceCart(sessionId, merchantId);
          const items = Array.isArray(existing?.items) ? [...existing.items] : [];
          const idx = items.findIndex((it) => it.product_id === productId);
          const nextQty = (idx >= 0 ? Number(items[idx].quantity || 0) : 0) + quantity;
          const unit = Number(product.price || 0);
          const item = {
            product_id: product.id,
            name: product.name,
            unit_price: unit,
            quantity: nextQty,
            total: Number((unit * nextQty).toFixed(2))
          };
          if (idx >= 0) items[idx] = item;
          else items.push(item);
          db.upsertCommerceCart({ session_id: sessionId, merchant_id: merchantId, items });
          KellyToolExecutor._setSessionMeta(sessionId, 'checkout_stage_meta_merchant_id', String(merchantId));
          KellyToolExecutor._bumpCheckoutContextVersion(sessionId, 'cart_add');
          KellyToolExecutor._invalidateCheckoutReadiness(sessionId, 'cart_mutation');
          return { success: true, cart: db.getCommerceCart(sessionId, merchantId), message: 'Added to cart.' };
        }

        case 'update_cart_item': {
          const merchantId = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
          const productId = args.product_id || args.prescription_id;
          const quantity = Number(args.quantity);
          if (!merchantId) return { success: false, error: 'merchant_required' };
          if (!productId) return { success: false, error: 'product_id_required' };
          if (!Number.isFinite(quantity)) return { success: false, error: 'quantity_required' };
          const existing = db.getCommerceCart(sessionId, merchantId);
          const items = Array.isArray(existing?.items) ? [...existing.items] : [];
          const idx = items.findIndex((it) => it.product_id === productId);
          if (quantity <= 0) {
            const filtered = items.filter((it) => it.product_id !== productId);
            db.upsertCommerceCart({ session_id: sessionId, merchant_id: merchantId, items: filtered });
            KellyToolExecutor._setSessionMeta(sessionId, 'checkout_stage_meta_merchant_id', String(merchantId));
            KellyToolExecutor._bumpCheckoutContextVersion(sessionId, 'cart_update_remove');
            KellyToolExecutor._invalidateCheckoutReadiness(sessionId, 'cart_mutation');
            return { success: true, cart: db.getCommerceCart(sessionId, merchantId), message: 'Item removed.' };
          }
          const product = db.getProduct(productId);
          if (!product) return { success: false, error: 'product_not_found' };
          const unit = Number(product.price || 0);
          const updated = {
            product_id: product.id,
            name: product.name,
            unit_price: unit,
            quantity: Math.max(1, quantity),
            total: Number((unit * Math.max(1, quantity)).toFixed(2))
          };
          if (idx >= 0) items[idx] = updated;
          else items.push(updated);
          db.upsertCommerceCart({ session_id: sessionId, merchant_id: merchantId, items });
          KellyToolExecutor._setSessionMeta(sessionId, 'checkout_stage_meta_merchant_id', String(merchantId));
          KellyToolExecutor._bumpCheckoutContextVersion(sessionId, 'cart_update');
          KellyToolExecutor._invalidateCheckoutReadiness(sessionId, 'cart_mutation');
          return { success: true, cart: db.getCommerceCart(sessionId, merchantId), message: 'Cart updated.' };
        }

        case 'remove_cart_item': {
          const merchantId = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
          const productId = args.product_id || args.prescription_id;
          if (!merchantId) return { success: false, error: 'merchant_required' };
          if (!productId) return { success: false, error: 'product_id_required' };
          if (await db.isCommerceCartLocked(sessionId, merchantId)) {
            return {
              success: false,
              error: 'cart_locked',
              message: 'Cart is locked while checkout is in progress.'
            };
          }
          const existing = db.getCommerceCart(sessionId, merchantId);
          const items = (existing?.items || []).filter((it) => it.product_id !== productId);
          db.upsertCommerceCart({ session_id: sessionId, merchant_id: merchantId, items });
          KellyToolExecutor._setSessionMeta(sessionId, 'checkout_stage_meta_merchant_id', String(merchantId));
          KellyToolExecutor._bumpCheckoutContextVersion(sessionId, 'cart_remove');
          KellyToolExecutor._invalidateCheckoutReadiness(sessionId, 'cart_mutation');
          return { success: true, cart: db.getCommerceCart(sessionId, merchantId), message: 'Item removed.' };
        }

        case 'clear_cart': {
          const merchantId = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
          if (!merchantId) return { success: false, error: 'merchant_required' };
          db.clearCommerceCart(sessionId, merchantId);
          KellyToolExecutor._setSessionMeta(sessionId, 'checkout_stage_meta_merchant_id', String(merchantId));
          KellyToolExecutor._bumpCheckoutContextVersion(sessionId, 'cart_clear');
          KellyToolExecutor._invalidateCheckoutReadiness(sessionId, 'cart_mutation');
          return { success: true, cart: { id: sessionId, merchant_id: merchantId, items: [], subtotal: 0, item_count: 0 } };
        }

        case 'save_shipping_address': {
          const merchantId = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
          const confirmCandidate = args && args.confirm_candidate === true;
          let line1 = String(args.line1 || args.street || '').trim();
          let city = String(args.city || '').trim();
          let state = String(args.state || '').trim().toUpperCase();
          let postal = String(args.postal_code || args.zip || '').trim();
          let parsedZipCorrected = false;
          const line2 = String(args.line2 || args.apt || '').trim();
          const country = String(args.country || 'US').trim().toUpperCase();
          const stateMap = {
            'new york': 'NY',
            'california': 'CA',
            'texas': 'TX',
            'florida': 'FL',
            'new jersey': 'NJ',
            'pennsylvania': 'PA',
            'massachusetts': 'MA',
            'maryland': 'MD',
            'virginia': 'VA',
            'washington': 'WA'
          };
          const validStateCodes = new Set([
            'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
            'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
            'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
          ]);
          /** Full state names map to 2-letter codes; otherwise expect a 2-letter code (any case) → uppercase + validStateCodes. */
          const normalizeState = (raw) => {
            const inRaw = String(raw || '').trim();
            if (!inRaw) return '';
            const mapped = stateMap[inRaw.toLowerCase()] || inRaw;
            return String(mapped).replace(/\./g, '').trim().toUpperCase();
          };
          const normalizeNoisyZip = (rawZip) => {
            const raw = String(rawZip || '').trim();
            if (!raw) return { value: '', corrected: false };
            const replaced = raw
              .replace(/[!|Il]/g, '1')
              .replace(/[Oo]/g, '0')
              .replace(/[^0-9-]/g, '');
            return { value: replaced, corrected: replaced !== raw };
          };
          const parseAddressString = (rawInput) => {
            const raw = String(rawInput || '').trim();
            if (!raw) return null;
            const sanitized = raw
              .replace(/\s+/g, ' ')
              .replace(/\s*,\s*/g, ', ')
              .replace(/\s+[–—-]\s+/g, ', ')
              .replace(/[|]/g, ', ')
              .replace(/[.]+$/g, '')
              .trim();
            const trimUnit = sanitized.replace(/\b(?:apt|apartment|unit|suite|ste)\b[\s#\-.:]*[A-Za-z0-9-]*\s*$/i, '').trim();
            const zipMatch = trimUnit.match(/(?:^|[\s,])#?([0-9!IlOo]{5}(?:-[0-9!IlOo]{4})?)\s*$/);
            const normZip = normalizeNoisyZip(zipMatch ? zipMatch[1] : '');
            const preZip = zipMatch ? trimUnit.slice(0, zipMatch.index).replace(/[, ]+$/, '') : trimUnit;
            if (!preZip) return null;
            const stateNameAlt = Object.keys(stateMap)
              .sort((a, b) => b.length - a.length)
              .map((k) => k.replace(/\s+/g, '\\s+'))
              .join('|');
            const stateMatch = preZip.match(new RegExp(`(?:,\\s*|\\s+)(${stateNameAlt}|[A-Za-z]{2})$`, 'i'));
            if (!stateMatch) return null;
            const rightState = normalizeState(stateMatch[1]);
            const beforeState = preZip.slice(0, stateMatch.index).replace(/[, ]+$/, '').trim();
            if (!beforeState || !validStateCodes.has(rightState)) return null;

            let cityOut = '';
            let line1Out = '';
            const commaParts = beforeState.split(',').map((p) => p.trim()).filter(Boolean);
            if (commaParts.length >= 2) {
              cityOut = commaParts[commaParts.length - 1];
              line1Out = commaParts.slice(0, -1).join(', ');
            } else {
              // Avoid guessing city from street suffixes (e.g., "Road" => city).
              return null;
            }
            if (!/^\d/.test(line1Out)) return null;
            return {
              line1: line1Out,
              city: cityOut,
              state: rightState,
              postal: normZip.value,
              zip_corrected: normZip.corrected
            };
          };

          if (!line1 && args.address_string) {
            const raw = String(args.address_string || '').trim();
            const parsed = parseAddressString(raw);
            if (parsed) {
              line1 = parsed.line1;
              city = parsed.city;
              state = parsed.state;
              postal = parsed.postal;
              parsedZipCorrected = !!parsed.zip_corrected;
            } else {
              KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_address', raw);
              return {
                success: false,
                error: 'address_parse_failed',
                message: 'Could not parse that address. Please provide street, city, state, and ZIP.'
              };
            }
          }
          state = normalizeState(state);
          const normalizedZip = normalizeNoisyZip(postal);
          postal = normalizedZip.value;
          const zipCorrected = parsedZipCorrected || normalizedZip.corrected;

          if (!line1 || !city || !state || !postal) {
            return {
              success: false,
              error: 'incomplete_address',
              message: 'Please provide full address: street, city, state, and ZIP code.',
              missing_fields: [
                !line1 && 'street_address',
                !city && 'city',
                !state && 'state',
                !postal && 'postal_code'
              ].filter(Boolean)
            };
          }
          if (!/^\d{5}(?:-\d{4})?$/.test(postal)) {
            return {
              success: false,
              error: 'invalid_postal_code',
              message: `"${postal}" is not a valid US ZIP code. Please provide a 5-digit ZIP.`
            };
          }

          if (zipCorrected && !confirmCandidate) {
            const candidate = {
              line1,
              line2: line2 || '',
              city,
              state,
              postal_code: postal,
              country
            };
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_candidate_json', JSON.stringify(candidate));
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_candidate_pending', '1');
            return {
              success: false,
              error: 'address_needs_confirmation',
              needs_confirmation: true,
              candidate_address: candidate,
              message: `I interpreted your ZIP as ${postal}. Reply "yes" to confirm this address, or send the corrected ZIP.`
            };
          }

          const full = [line1, line2, city, `${state} ${postal}`, country].filter(Boolean).join(', ');
          const now = Date.now();
          const version = KellyToolExecutor._getCheckoutContextVersion(sessionId);

          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_address', full);
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_line1', line1);
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_line2', line2);
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_city', city);
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_state', state);
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_postal_code', postal);
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_country', country);
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_complete', '1');
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_candidate_json', '');
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_candidate_pending', '0');
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_updated_at_ms', String(now));
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_context_version', String(version));
          if (merchantId) {
            const fp = KellyToolExecutor._computeCartFingerprint(sessionId, merchantId);
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_cart_fingerprint', fp);
          }

          return {
            success: true,
            needs_confirmation: false,
            shipping_address: {
              line1,
              line2: line2 || undefined,
              city,
              state,
              postal_code: postal,
              country,
              full_address: full
            },
            message: zipCorrected
              ? `I interpreted your ZIP as ${postal}. Shipping address saved: ${full}`
              : `Shipping address saved: ${full}`
          };
        }

        case 'send_commerce_verification_code': {
          const contextVersion = KellyToolExecutor._getCheckoutContextVersion(sessionId);
          KellyToolExecutor._setSessionMeta(sessionId, 'checkout_context_version', String(contextVersion));
          const stage = KellyToolExecutor._getCheckoutStage(sessionId);
          if (stage === CHECKOUT_STAGES.CHECKOUT_PREPARED || stage === CHECKOUT_STAGES.PAYMENT_CONFIRMED) {
            return {
              success: false,
              error: 'checkout_already_in_progress',
              message:
                stage === CHECKOUT_STAGES.PAYMENT_CONFIRMED
                  ? 'Payment is already confirmed for this session.'
                  : 'Secure checkout is already in progress for this session.'
            };
          }
          const email = KellyToolExecutor._normalizeEmail(args.email);
          if (!email) {
            return { success: false, error: 'email_required', message: 'Email is required to send verification code.' };
          }
          // Idempotency guard: if this exact email is already verified for the
          // current checkout context, do not resend/restart verification.
          if (KellyToolExecutor._isCommerceEmailVerificationValid(sessionId, email)) {
            return {
              success: true,
              already_verified: true,
              email_sent: false,
              message: 'Email already verified for this checkout session.'
            };
          }
          const result = await this._post('/api/public/commerce/email/send-code', { email });
          if (result?.success) {
            const nonce = `${email}:${Date.now()}`;
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_pending', email);
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_pending_nonce', nonce);
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified', '');
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified_nonce', '');
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified_at_ms', '0');
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified_context_version', '0');
            // Do not clear commerce_shipping_updated_at_ms here: wiping the shipping clock makes
            // _isShippingReadyForCurrentContext fail after code_sent and causes prepare loops when
            // the user already captured shipping (e.g. address before email in one flow).
            KellyToolExecutor._setCheckoutStage(sessionId, CHECKOUT_STAGES.CODE_SENT, {
              email,
              pending_nonce: nonce
            });
          }
          return result;
        }

        case 'verify_commerce_code': {
          const explicitEmail = KellyToolExecutor._normalizeEmail(args.email);
          const pendingEmail = KellyToolExecutor._normalizeEmail(
            KellyToolExecutor._getSessionMeta(sessionId, 'commerce_email_pending')
          );
          const email = explicitEmail || pendingEmail;
          const code = String(args.code || '').trim();
          if (!email) return { success: false, error: 'email_required' };
          if (!code) return { success: false, error: 'code_required' };
          const result = await this._post('/api/public/commerce/email/verify-code', { email, code });
          if (result?.success) {
            const transitionId = randomUUID();
            KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_id', transitionId);
            KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_ts', String(Date.now()));
            KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_inflight', '0');
            KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_consumed', '0');
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified', email);
            KellyToolExecutor._setSessionMeta(
              sessionId,
              'commerce_email_verified_nonce',
              KellyToolExecutor._getSessionMeta(sessionId, 'commerce_email_pending_nonce') || `${email}:${Date.now()}`
            );
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified_at_ms', String(Date.now()));
            KellyToolExecutor._setSessionMeta(
              sessionId,
              'commerce_email_verified_context_version',
              String(KellyToolExecutor._getCheckoutContextVersion(sessionId))
            );
            const merchantForFingerprint = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
            if (merchantForFingerprint) {
              const fp = KellyToolExecutor._computeCartFingerprint(sessionId, merchantForFingerprint);
              KellyToolExecutor._setSessionMeta(sessionId, 'commerce_verified_cart_fingerprint', fp);
            }
            KellyToolExecutor._setCheckoutStage(sessionId, CHECKOUT_STAGES.CODE_VERIFIED, {
              email,
              verified_transition_id: transitionId
            });
          } else {
            KellyToolExecutor._setCheckoutStage(sessionId, CHECKOUT_STAGES.FAILED, {
              reason: String(result?.error || 'verify_code_failed')
            });
          }
          return result;
        }

        case 'prepare_commerce_checkout': {
          const merchantId = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
          if (!merchantId) {
            return KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
              success: false,
              error: 'merchant_required',
              message: 'Could not resolve merchant/provider for this clinic. Pass provider_id or configure clinic merchant_id.'
            });
          }
          const quoteId = args.quote_id || args.checkout_session_id;
          const email = KellyToolExecutor._normalizeEmail(args.customer_email || args.email);
          const rawPhone = String(args.customer_phone || args.phone || '').trim();
          const normalizedPhone = KellyToolExecutor._normalizeE164Phone(rawPhone);
          if (!email) {
            return KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
              success: false,
              error: 'email_required',
              message: 'customer_email is required.'
            });
          }
          if (rawPhone && !normalizedPhone) {
            return KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
              success: false,
              error: 'invalid_phone',
              message: 'Please provide phone in E.164 format (for example +12125550123).'
            });
          }
          if (CHECKOUT_RAIL_GUARDS_ENABLED && STRICT_CHECKOUT_STAGE_GATE) {
            const stage = KellyToolExecutor._getCheckoutStage(sessionId);
            if (stage !== CHECKOUT_STAGES.CODE_VERIFIED) {
              try {
                console.warn('[checkout-stage] gate_blocked prepare_commerce_checkout', {
                  session_id: String(sessionId || ''),
                  stage: String(stage || ''),
                  required: CHECKOUT_STAGES.CODE_VERIFIED
                });
              } catch (_) {}
              return KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
                success: false,
                error: 'verification_required',
                message: 'Please verify your 6-digit email code before secure checkout.'
              });
            }
            const transitionId = String(KellyToolExecutor._getSessionMeta(sessionId, 'verified_transition_id') || '').trim();
            const transitionConsumed = String(
              KellyToolExecutor._getSessionMeta(sessionId, 'verified_transition_consumed') || '0'
            ).trim();
            const transitionInflight = String(
              KellyToolExecutor._getSessionMeta(sessionId, 'verified_transition_inflight') || '0'
            ).trim();
            if (!transitionId) {
              return KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
                success: false,
                error: 'verification_required',
                message: 'Email verification must complete before secure checkout.'
              });
            }
            if (transitionConsumed === '1') {
              const existingCheckoutId = String(
                KellyToolExecutor._getSessionMeta(sessionId, 'checkout_stage_meta_checkout_id') || ''
              ).trim();
              const existingPaymentIntentId = String(
                KellyToolExecutor._getSessionMeta(sessionId, 'checkout_stage_meta_payment_intent_id') || ''
              ).trim();
              return KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
                success: true,
                message: 'Checkout is already prepared. Complete payment in the secure checkout form.',
                checkout: {
                  checkout_id: existingCheckoutId || null,
                  payment_intent_id: existingPaymentIntentId || null,
                  message: 'Already prepared'
                }
              });
            }
            if (transitionInflight === '1') {
              const hasPreparedCheckout = String(
                KellyToolExecutor._getSessionMeta(sessionId, 'checkout_stage_meta_checkout_id') || ''
              ).trim();
              const cartLocked = await db.isCommerceCartLocked(sessionId, merchantId).catch(() => false);
              if (!hasPreparedCheckout && !cartLocked) {
                // Self-heal stale in-flight state left behind by an interrupted/failed prepare attempt.
                KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_inflight', '0');
              } else {
                return KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
                  success: false,
                  error: 'checkout_prepare_inflight',
                  message: 'Secure checkout is preparing. Please try again in a moment.'
                });
              }
            }
          }
          if (REQUIRE_COMMERCE_EMAIL_VERIFICATION) {
            if (!KellyToolExecutor._isCommerceEmailVerificationValid(sessionId, email)) {
              try {
                console.warn('[checkout-stage] gate_blocked prepare_commerce_checkout_email_verification', {
                  session_id: String(sessionId || ''),
                  email: String(email || '')
                });
              } catch (_) {}
              return KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
                success: false,
                error: 'email_not_verified',
                message: 'Verified email is missing or stale for this checkout. Please request and verify a new 6-digit code.'
              });
            }
          }
          if (!KellyToolExecutor._isShippingReadyForCurrentContext(sessionId)) {
            return KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
              success: false,
              error: 'shipping_required',
              message: 'Please provide your full shipping address (street, city, state, ZIP) for this checkout session.'
            });
          }
          const expectedVerifiedCartFp = String(
            KellyToolExecutor._getSessionMeta(sessionId, 'commerce_verified_cart_fingerprint') || ''
          );
          const expectedShippingCartFp = String(
            KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_cart_fingerprint') || ''
          );
          const currentCartFp = KellyToolExecutor._computeCartFingerprint(sessionId, merchantId);
          if (
            (expectedVerifiedCartFp && expectedVerifiedCartFp !== currentCartFp) ||
            (expectedShippingCartFp && expectedShippingCartFp !== currentCartFp)
          ) {
            return KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
              success: false,
              error: 'cart_changed',
              message: 'Your cart changed after verification. Please verify and confirm shipping again before checkout.'
            });
          }
          // Mark prepare as in-flight only after all hard preconditions pass.
          // Then ensure any return path clears it unless a successful transition
          // explicitly consumes the verification transition.
          let inflightMarked = false;
          const guardedReturn = (payload, opts = {}) => {
            const consumeTransition = !!opts.consumeTransition;
            if (CHECKOUT_RAIL_GUARDS_ENABLED && STRICT_CHECKOUT_STAGE_GATE && inflightMarked) {
              KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_inflight', '0');
              if (consumeTransition) KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_consumed', '1');
            }
            return payload;
          };
          if (CHECKOUT_RAIL_GUARDS_ENABLED && STRICT_CHECKOUT_STAGE_GATE) {
            KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_inflight', '1');
            inflightMarked = true;
          }
          const useCartPath = !quoteId || args.use_cart === true || args.cart_checkout === true;
          if (useCartPath) {
            if (await db.isCommerceCartLocked(sessionId, merchantId)) {
              return guardedReturn(KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
                success: false,
                error: 'checkout_already_in_progress',
                message: 'Checkout is already in progress for this session.'
              }));
            }
            const cart = db.getCommerceCart(sessionId, merchantId);
            if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
              return guardedReturn(KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
                success: false,
                error: 'cart_empty',
                message: 'Your cart is empty. Add items first.'
              }));
            }
            const shippingFromMeta = KellyToolExecutor._buildShippingAddressFromMeta(sessionId);
            const commerceQuoteId =
              String(KellyToolExecutor._getSessionMeta(sessionId, 'last_commerce_quote_id') || quoteId || '').trim() ||
              null;
            KellyToolExecutor._refreshStaleShippingTtlIfEligible(sessionId);
            const checkoutResult = await PaymentOrchestrator.createCheckout({
              merchant_id: merchantId,
              customer: {
                name: args.customer_name || args.name || String(email).split('@')[0] || 'Customer',
                phone: normalizedPhone || rawPhone || '',
                email: String(email).trim()
              },
              items: cart.items.map((it) => ({
                product_id: it.product_id,
                name: it.name,
                unit_price: Number(it.unit_price),
                quantity: Number(it.quantity),
                total: Number(it.total)
              })),
              payment: { method: args.payment_method || 'direct_stripe', currency: 'USD' },
              shipping_address: args.shipping_address || shippingFromMeta || undefined,
              metadata: {
                kelly_session_id: sessionId || undefined,
                cart_session_id: sessionId,
                commerce_quote_id: commerceQuoteId,
                shipping_address: shippingFromMeta || undefined
              }
            });
            if (!checkoutResult || checkoutResult.success === false) {
              return guardedReturn(KellyToolExecutor._normalizePrepareCommerceCheckoutForChat(
                checkoutResult && typeof checkoutResult === 'object'
                  ? checkoutResult
                  : { success: false, error: 'checkout_failed', message: 'Checkout could not be created.' }
              ));
            }
            try {
              if (checkoutResult.checkout_id) {
                db.setCommerceCartCheckoutLock(sessionId, merchantId, checkoutResult.checkout_id);
              }
              db.upsertCommerceCheckoutProgress({
                session_id: sessionId,
                merchant_id: merchantId,
                stage: 'checkout_prepared',
                quote_id: commerceQuoteId,
                checkout_id: checkoutResult.checkout_id || null
              });
              if (commerceQuoteId) {
                try {
                  db.db.prepare(
                    `UPDATE checkout_sessions SET kelly_session_id = ? WHERE id = ?`
                  ).run(sessionId, commerceQuoteId);
                } catch (_) {}
              }
            } catch (_) {}
            KellyToolExecutor._setCheckoutStage(sessionId, CHECKOUT_STAGES.CHECKOUT_PREPARED, {
              checkout_id: checkoutResult.checkout_id || '',
              payment_intent_id: checkoutResult.payment?.payment_intent_id || checkoutResult.payment_intent_id || '',
              merchant_id: merchantId
            });
            const merged = {
              success: true,
              checkout: {
                checkout_id: checkoutResult.checkout_id,
                payment_link: checkoutResult.payment_link || null,
                payment_token: checkoutResult.payment_token || null,
                payment_intent_id: checkoutResult.payment?.payment_intent_id || checkoutResult.payment_intent_id || null,
                client_secret: checkoutResult.payment?.client_secret || checkoutResult.client_secret || null,
                requires_action: !!checkoutResult.requires_action,
                payment: checkoutResult.payment || null,
                message: checkoutResult.message || 'Checkout prepared from cart'
              },
              cart
            };
            const norm = KellyToolExecutor._normalizePrepareCommerceCheckoutForChat(merged);
            try {
              KellyToolExecutor._setSessionMeta(
                sessionId,
                'last_commerce_checkout_chat',
                JSON.stringify(norm.commerce_checkout || {})
              );
            } catch (_) {}
            return guardedReturn(norm, { consumeTransition: true });
          }
            const commerceQuoteId =
              String(KellyToolExecutor._getSessionMeta(sessionId, 'last_commerce_quote_id') || quoteId || '').trim() ||
              null;
            const shippingFromMeta = KellyToolExecutor._buildShippingAddressFromMeta(sessionId);
            KellyToolExecutor._refreshStaleShippingTtlIfEligible(sessionId);
            const raw = await this._post('/api/public/checkout/start', {
              quote_id: quoteId,
              checkout_session_id: quoteId,
              provider_id: merchantId,
              email: String(email).trim(),
              phone: normalizedPhone || rawPhone || undefined,
              name: args.customer_name || args.name || undefined,
              shipping_address: args.shipping_address || shippingFromMeta || undefined,
              kelly_session_id: sessionId || undefined,
              commerce_quote_id: commerceQuoteId,
              payment_method: args.payment_method || 'direct_stripe'
            });
          const normHttp = KellyToolExecutor._normalizePrepareCommerceCheckoutForChat(raw);
          try {
            KellyToolExecutor._setSessionMeta(
              sessionId,
              'last_commerce_checkout_chat',
              JSON.stringify(normHttp?.commerce_checkout || {})
            );
          } catch (_) {}
          if (!normHttp?.success) {
            return guardedReturn(normHttp);
          } else {
            KellyToolExecutor._setCheckoutStage(sessionId, CHECKOUT_STAGES.CHECKOUT_PREPARED, {
              checkout_id: normHttp?.commerce_checkout?.checkout_id || normHttp?.checkout?.checkout_id || '',
              payment_intent_id:
                normHttp?.commerce_checkout?.payment_action?.payment_intent_id ||
                normHttp?.checkout?.payment_intent_id ||
                '',
              merchant_id: merchantId
            });
            return guardedReturn(normHttp, { consumeTransition: true });
          }
        }

        case 'get_checkout_payment_status': {
          const paymentIntentId =
            String(args.payment_intent_id || '').trim() ||
            String(KellyToolExecutor._getSessionMeta(sessionId, 'checkout_stage_meta_payment_intent_id') || '').trim();
          const result = await CheckoutPaymentStatusService.getCheckoutPaymentStatus({
            payment_intent_id: paymentIntentId
          });
          if (result?.success) {
            KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_last_checked_at', String(Date.now()));
            KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_source', String(result.source || 'tool'));
          }
          return result;
        }

        case 'search_medical_literature': {
          const q = String(args.query || args.topic || '').trim();
          const max_results = args.max_results != null ? Number(args.max_results) : undefined;
          const r = await QueryPlanner.runLiteratureRetrieval({ query: q, max_results, sessionId });
          if (r?.success && Array.isArray(r.articles) && r.articles.length) {
            try {
              const prevRaw = KellyToolExecutor._getSessionMeta(sessionId, 'kelly_last_literature_snippets_json');
              let prev = [];
              if (prevRaw) {
                try {
                  prev = JSON.parse(prevRaw);
                } catch (_) {
                  prev = [];
                }
              }
              const slice = r.articles.map((a) => ({
                pmid: a.pmid,
                title: a.title,
                url: a.url,
                journal: a.journal,
                year: a.year
              }));
              const merged = [...(Array.isArray(prev) ? prev : []), ...slice];
              const cap = Math.min(24, Math.max(4, parseInt(process.env.KELLY_LITERATURE_UI_CAP || '12', 10) || 12));
              KellyToolExecutor._setSessionMeta(
                sessionId,
                'kelly_last_literature_snippets_json',
                JSON.stringify(merged.slice(-cap))
              );
            } catch (_) {}
          }
          return r;
        }

        case 'find_clinic_specialists': {
          if (!clinicId) {
            return { success: false, error: 'clinic_id_required', provider_cards: [], message: 'clinic_id is required.' };
          }
          const specialty = String(args.specialty || '').trim();
          if (!specialty) {
            return { success: false, error: 'specialty_required', provider_cards: [], message: 'specialty is required.' };
          }
          const language = String(args.language || 'en').trim();
          const state = args.state ? String(args.state).trim().toUpperCase() : null;
          const lane = String(args.lane || 'sync').trim();
          const urgency = String(args.urgency || 'routine').trim();
          const patientTier = parseInt(String(args.patient_tier || '2'), 10) || 2;
          const date = String(args.date || new Date().toISOString().slice(0, 10)).trim();
          const resolverResult = await SpecialistResolverService.resolve({
            clinicId,
            specialty,
            language,
            state,
            lane,
            urgency,
            patientTier,
            date
          });
          const limit = Math.min(10, Math.max(1, parseInt(String(args.limit || '3'), 10) || 3));
          const cards = resolverMapToProviderCards(resolverResult.providers, { limit });
          for (const c of cards) {
            c.match_mode = resolverResult.matchMode;
          }
          if (cards.length) {
            try {
              KellyToolExecutor._setSessionMeta(sessionId, 'kelly_last_provider_cards_json', JSON.stringify(cards));
            } catch (_) {}
          }
          return {
            success: true,
            match_mode: resolverResult.matchMode,
            kelly_script: resolverResult.kellyScript || null,
            provider_cards: cards,
            count: cards.length,
            ui_hint:
              'If phone_trust is not verified_directory, do not read out a phone number; offer booking or "contact the clinic". Only verified_directory phones may be spoken or shown.'
          };
        }

        case 'check_product_layering': {
          const { runLayeringCheck } = require('../../lib/routine-layering-check');
          const names = Array.isArray(args.product_names)
            ? args.product_names.map((n) => String(n).trim()).filter(Boolean)
            : [];
          if (!names.length && args.product_a && args.product_b) {
            names.push(String(args.product_a).trim(), String(args.product_b).trim());
          }
          const steps = names.map((n) => ({ product_name: n }));
          const result = runLayeringCheck({ steps, db: db.db });
          return {
            success: true,
            overall: result.overall,
            conflicts: result.conflicts || [],
            actives_detected: result.actives_detected || [],
            disclaimer: 'Layering conflict guidance only — not an ingredient toxicity score.',
          };
        }

        default:
          console.warn(`[KellyToolExecutor] Unknown tool: ${toolName}`);
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      if (toolName === 'prepare_commerce_checkout') {
        try {
          KellyToolExecutor._setSessionMeta(sessionId, 'verified_transition_inflight', '0');
        } catch (_) {}
      }
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // gap1+2+4+5: get_available_slots — block until triage, use resolver
  // ─────────────────────────────────────────────────────────────
  static async _getAvailableSlots(args, { sessionId, clinicId, patientId, channel }) {
    const THRESHOLD = KellyToolExecutor._ragConfidenceThreshold();
    const bump = (n) => KellyToolExecutor._bumpOpsCounter(n);
    const routineNoSymptoms = KellyToolExecutor._routineNoSymptomsEffective(sessionId);
    const e2eSkipTriage = KellyToolExecutor._kellyE2eSkipTriageForSession(sessionId);
    const sessionRowEarly = db.getTriageSession ? db.getTriageSession(sessionId) : null;

    // gap1: block slots until run_triage_rag has completed
    const sessionRow = sessionRowEarly;
    const isSafetyRed =
      sessionRow &&
      ((sessionRow.safety_level === 'red') ||
        (sessionRow.referred_to_911 === 1) ||
        (sessionRow.referred_to_911 === true));

    if (isSafetyRed) {
      bump('voice_agent_misuse_get_available_slots_safety_blocked');
      return {
        success: false,
        error: 'SAFETY_BLOCKED',
        error_code: 'SAFETY_BLOCKED',
        message: 'Scheduling is blocked because this session was flagged as emergency/red safety.'
      };
    }

    const triageReopenSlots = (() => {
      try {
        const v = KellyToolExecutor._getSessionMeta(sessionId, 'kelly_triage_reopen');
        return String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true';
      } catch (_) {
        return false;
      }
    })();
    if (triageReopenSlots) {
      bump('voice_agent_misuse_get_available_slots_triage_reopen');
      return {
        success: false,
        error: 'TRIAGE_REOPEN',
        error_code: 'TRIAGE_REOPEN',
        message:
          'New or changed symptoms were flagged. Complete OPQRST and run_triage_rag again before looking up slots.'
      };
    }

    let triageResult = TriageRAGService.getAuthoritativeForSession(sessionId);
    let usingRoutineBypass = false;
    if (!triageResult && routineNoSymptoms) {
      usingRoutineBypass = true;
      // Synthetic row: confidence is current threshold so gating passes; not persisted as a real RAG row.
      // If RAG_CONFIDENCE_THRESHOLD changes mid-session, stored triage rows keep their original scores.
      triageResult = {
        id: `routine-${sessionId}`,
        target_specialty: args.appointment_type || 'PrimaryCare',
        urgency: 'routine',
        recommended_lane: args.lane || 'sync',
        rag_confidence: THRESHOLD,
        differentials: [{ specialty: args.appointment_type || 'PrimaryCare', probability: 1 }]
      };
      KellyToolExecutor._logGateBypass(sessionId, 'synthetic_routine_triage_row', {
        appointment_type: args.appointment_type || 'PrimaryCare'
      });
    }
    if (!triageResult) {
      bump('voice_agent_misuse_get_available_slots_no_rag_result');
      return {
        success: false,
        error: 'TRIAGE_REQUIRED',
        error_code: 'TRIAGE_REQUIRED',
        message: 'Please complete triage first. Ask the patient to describe their symptoms, then call run_triage_rag to determine the right specialty. Only after triage can we look up available slots.'
      };
    }
    // Block orphan/stale RAG: triage_sessions must point at this exact RAG row (set on run_triage_rag).
    if (routineNoSymptoms) {
      console.log('[SLOTS] Routine session - skipping stale RAG check');
    } else if (
      !usingRoutineBypass &&
      sessionRow &&
      sessionRow.rag_result_id != null &&
      String(sessionRow.rag_result_id).trim() !== '' &&
      String(sessionRow.rag_result_id) !== String(triageResult.id)
    ) {
      bump('voice_agent_misuse_get_available_slots_no_rag_result');
      return {
        success: false,
        error: 'TRIAGE_REQUIRED',
        error_code: 'TRIAGE_REQUIRED',
        message: 'Triage is out of date for this visit. Please call run_triage_rag again with the current symptoms before looking up slots.'
      };
    }
    // W3-S5.1: Assert differentials or target_specialty before resolver
    const hasDifferentials = (triageResult.differentials || []).length >= 1;
    const hasSpecialty = !!(triageResult.target_specialty);
    if (!e2eSkipTriage && !hasDifferentials && !hasSpecialty) {
      return {
        success: false,
        error: 'DIFFERENTIALS_REQUIRED',
        error_code: 'DIFFERENTIALS_REQUIRED',
        message: 'Differentials are not yet generated. Complete triage and run run_triage_rag to get specialty recommendations before looking up available slots.'
      };
    }

    // T20: Hard gate — refuse if triage_complete is false OR rag_confidence is below threshold
    // gap13: block slots when rag_confidence < threshold — ask one more question first
    // IMPORTANT: Check this BEFORE `triage_complete`, otherwise we may return TRIAGE_INCOMPLETE
    // and the UX falls back to a generic "tell me more" question even when the real blocker
    // is confidence.
    const confidence = KellyToolExecutor._confidenceFromTriageRow(triageResult);
    // Controlled borderline override:
    // after repeated clarification loops, allow slot lookup when confidence is only
    // slightly below threshold, but only if OPQRST + rich intake are complete and
    // we already have a specialty from triage.
    const forceAfterClarified = args.force_after_clarified === true || args.force_after_clarified === 'true';
    const opqrstComplete = sessionRow && KellyToolExecutor._isCompleteFlag(sessionRow.opqrst_complete);
    const intakeComplete = !!(sessionRow && sessionRow.intake_complete_at);
    const confidenceNearThreshold = isConfidenceNearThreshold(confidence, THRESHOLD);
    const allowBorderlineProgress = !!(
      forceAfterClarified &&
      opqrstComplete &&
      intakeComplete &&
      hasSpecialty &&
      confidenceNearThreshold
    );
    const bypassConfidenceForRoutine = routineNoSymptoms || usingRoutineBypass || e2eSkipTriage;
    if (confidence < THRESHOLD && !allowBorderlineProgress && !bypassConfidenceForRoutine) {
      bump('voice_agent_misuse_get_available_slots_low_confidence');
      return {
        success: false,
        error: 'LOW_CONFIDENCE',
        error_code: 'LOW_CONFIDENCE',
        message: 'RAG confidence is low. Ask one more clarifying question (e.g. "Can you describe the pain in more detail?" or "Is it on both sides?") then call run_triage_rag again before looking up slots.'
      };
    }

    const triageComplete =
      usingRoutineBypass ||
      routineNoSymptoms ||
      (sessionRow && KellyToolExecutor._isCompleteFlag(sessionRow.triage_complete));
    if (!triageComplete) {
      bump('voice_agent_misuse_get_available_slots_triage_incomplete');
      return {
        success: false,
        error: 'TRIAGE_INCOMPLETE',
        error_code: 'TRIAGE_INCOMPLETE',
        message: 'Triage is not complete yet. Please call run_triage_rag until triage is marked complete before looking up slots.'
      };
    }

    const dateRaw = args.date || new Date().toISOString().slice(0, 10);
    const date = KellyToolExecutor._normalizeToBusinessDate(dateRaw, clinicId);
    const timezone = args.timezone || 'America/New_York';
    const lane = args.lane || triageResult.recommended_lane || 'sync';
    // W3-S5.2: specialty from differential (triageResult.target_specialty)
    const appointmentType = routineNoSymptoms
      ? 'Primary Care'
      : (args.appointment_type || triageResult.target_specialty || 'General Consult');

    // gap5: pass patient price_tier
    const pricing = db.getPatientPricing ? db.getPatientPricing(patientId) : { price_tier: 2 };
    const patientTier = (pricing && pricing.price_tier) || 2;

    // W3-S5.3 + W3-S5.4: language from session (kelly_session_meta or triage_sessions.detected_language), location (patient state)
    let language = db.getKellySessionLanguage ? db.getKellySessionLanguage(sessionId) : null;
    if (!language && sessionRow?.detected_language) language = sessionRow.detected_language;
    language = language || 'en';
    let patientState = null;
    if (patientId && db.getFHIRPatient) {
      try {
        const patient = db.getFHIRPatient(patientId);
        if (patient?.resource_data) {
          const data = typeof patient.resource_data === 'string' ? JSON.parse(patient.resource_data) : patient.resource_data;
          const addr = data?.address?.[0];
          patientState = addr?.state || (addr?.address?.state) || null;
        }
      } catch (_) {}
    }
    if (!patientState && db.getOrchestrateSessionBySessionId) {
      try {
        const row = db.getOrchestrateSessionBySessionId(sessionId);
        patientState = row?.flow_state?.patient_state || row?.flow_state?.state || null;
      } catch (_) {}
    }

    if (!clinicId) {
      return { success: false, error: 'clinic_id is required' };
    }

    if (String(process.env.RCM_E2E_DIRECT_TOOLS || '').trim() === '1') {
      const BookingService = require('../patient/booking-service');
      const resultRaw = await BookingService.getAvailableSlots(
        date,
        null,
        appointmentType,
        timezone,
        clinicId,
        null
      );
      const direct = KellyToolExecutor._ensureSlotBundles(resultRaw, date);
      if (direct?.success) {
        const bundles = direct.slot_bundles || [];
        const availableSlots = bundles.map((s) =>
          s.time === 'ASYNC' ? `Async review — ${s.practitioner_name || 'provider'}` : s.time
        );
        KellyToolExecutor._setSessionMeta(sessionId, 'kelly_script_hint', '');
        return {
          success: true,
          available_slots: availableSlots,
          slot_bundles: bundles,
          appointment_type: appointmentType
        };
      }
    }

    // W3-S5.5: Multi-specialty when primary + secondary differ
    const secondarySpecialties = triageResult.secondary_specialties || [];
    const allSpecialties = [appointmentType, ...secondarySpecialties].filter((s, i, a) => a.indexOf(s) === i);
    const multiSpecialty = allSpecialties.length > 1;

    // gap2 + W3-S5.3: SpecialistResolver with full inputs
    if (isSpecialtyType(appointmentType) || multiSpecialty) {
      try {
        const resolveOpts = {
          clinicId,
          specialty: appointmentType,
          language,
          state: patientState,
          lane,
          urgency: triageResult.urgency || 'routine',
          patientTier,
          date
        };
        let resolverResult = await SpecialistResolverService.resolve(resolveOpts);

        // W3-S5.5: Call resolver for each specialty when multi-specialty, merge option sets
        let allSlots = [];
        let allKellyScripts = [resolverResult.kellyScript].filter(Boolean);
        let mergedProviderMap = resolverResult.providers || new Map();

        if (multiSpecialty && secondarySpecialties.length > 0) {
          for (const spec of secondarySpecialties) {
            if (!isSpecialtyType(spec)) continue;
            const secResult = await SpecialistResolverService.resolve({
              ...resolveOpts,
              specialty: spec
            });
            if (secResult.kellyScript) allKellyScripts.push(secResult.kellyScript);
            if (secResult.providers && secResult.providers.size > 0) {
              for (const [pid, attrs] of secResult.providers) {
                if (!mergedProviderMap.has(pid)) mergedProviderMap.set(pid, { ...attrs, _specialty: spec });
              }
            }
          }
        }

        if (mergedProviderMap.size > 0) {
          const slots = await getAvailableSlotsWithSpecialist({
            date,
            lane,
            providerMap: mergedProviderMap,
            clinicId,
            timezone,
            appointmentType
          });

          const availableSlots = slots.map(s =>
            s.time === 'ASYNC'
              ? `Async review — ${s.practitioner_name}`
              : s.time
          );

          // W3-S5.5 + M-S5.A: kelly_script for filter decay (e.g. "No Swahili-speaking...") or multi-specialty narrative
          let kellyScript = allKellyScripts[0] || null;
          if (!kellyScript && multiSpecialty && allSpecialties.length >= 2) {
            const specLabels = allSpecialties.slice(0, 3).map(s => s.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2'));
            kellyScript = `Based on your symptoms you may need both ${specLabels.slice(0, -1).join(' and ')} and ${specLabels[specLabels.length - 1]} care. Here are the available options.`;
          }

          // M-S5.A: say_to_patient ensures LLM says kelly_script verbatim
          const out = {
            success: true,
            available_slots: availableSlots,
            slot_bundles: slots,
            appointment_type: appointmentType,
            secondary_specialties: multiSpecialty ? secondarySpecialties : [],
            kelly_script: kellyScript
          };
          KellyToolExecutor._setSessionMeta(sessionId, 'kelly_script_hint', kellyScript || '');
          if (kellyScript) out.say_to_patient = `Say this to the patient before presenting slots: "${kellyScript}"`;
          return out;
        }
      } catch (err) {
        console.warn('[KellyToolExecutor] Specialist path failed, falling back:', err.message);
      }
    }

    // Fallback: use the shared voice availability endpoint for BOTH chat and voice.
    // The legacy /api/appointments/available-slots route can be disabled and diverges
    // from triage/session parity behavior, causing 403s in chat while voice succeeds.
    const slotsEndpoint = '/voice/appointments/available-slots';
    let fallbackOut;
    try {
      fallbackOut = await this._post(slotsEndpoint, {
        date,
        appointment_type: appointmentType,
        timezone,
        lane,
        clinic_id: clinicId,
        // Backend safety-guard (when implemented) and for consistent triage-session traceability.
        metadata: { session_id: sessionId },
        session_id: sessionId
      });
    } catch (slotsErr) {
      throw slotsErr;
    }
    if (fallbackOut?.slot_bundles && Array.isArray(fallbackOut.slot_bundles)) {
      fallbackOut.slot_bundles = fallbackOut.slot_bundles.map((s) => ({
        ...s,
        practitioner_name: s?.practitioner_name || null,
        practitioner_id: s?.practitioner_id || null
      }));
    }
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_script_hint', fallbackOut?.kelly_script || '');
    return fallbackOut;
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP helper
  // ─────────────────────────────────────────────────────────────
  static _internalJobHeaders() {
    const tok = process.env.INTERNAL_JOB_TOKEN;
    return tok ? { 'x-internal-job-token': tok } : {};
  }

  static _ensureSlotBundles(result, date, practitionerId = null) {
    if (!result || !result.success) return result;
    if (Array.isArray(result.slot_bundles) && result.slot_bundles.length) return result;

    const fromDisplay = Array.isArray(result.slots_with_display) ? result.slots_with_display : [];
    const fromSlots = Array.isArray(result.available_slots)
      ? result.available_slots
      : Array.isArray(result.slots)
        ? result.slots
        : [];
    const base = fromDisplay.length
      ? fromDisplay.map((s) => ({
          time: s.time,
          date: date || null,
          display: s.slot_display || s.time,
          slot_start_iso: s.slot_start_iso || null,
          practitioner_id: practitionerId || null,
          lane: 'sync',
          is_async: false
        }))
      : fromSlots.map((t) => ({
          time: t,
          date: date || null,
          display: String(t),
          slot_start_iso: null,
          practitioner_id: practitionerId || null,
          lane: 'sync',
          is_async: false
        }));

    return { ...result, slot_bundles: base };
  }

  static async _postDirect(path, body = {}) {
    const { postDirect } = require('../kelly-tool-executor/http-client');
    return postDirect(path, body);
  }

  static async _post(path, body) {
    const { kellyPost } = require('../kelly-tool-executor/http-client');
    return kellyPost(path, body);
  }

  // ─────────────────────────────────────────────────────────────
  // Claims lookup — fixes V-1: forward patient_id from insurance
  // ─────────────────────────────────────────────────────────────
  static async _getPatientClaims(args, sessionId) {
    const insResult = await this._post('/voice/insurance/collect', {
      member_id: args.member_id,
      patient_name: args.patient_name,
      payer_name: args.payer_name || undefined,
      call_id: sessionId
    });

    if (!insResult.success) {
      return { success: false, error: insResult.error || 'Could not find insurance information' };
    }

    const patientId = insResult.patient_id;
    if (!patientId) {
      return { success: false, error: 'Patient not found for this insurance member ID' };
    }

    try {
      const claimsResponse = await axios.get(`${BASE_URL}/api/patient/benefits`, {
        params: { patientId, memberId: args.member_id },
        timeout: KellyToolExecutor._httpTimeoutMs()
      });
      return {
        success: true,
        ...claimsResponse.data,
        insurance: insResult
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // gap11+12: get_triage_session, store_triage_opqrst
  // ─────────────────────────────────────────────────────────────
  static _getTriageSession(sessionId) {
    const row = db.getTriageSession ? db.getTriageSession(sessionId) : null;
    if (!row) return { success: true, session: null };
    return {
      success: true,
      session: {
        onset: row.onset,
        provocation: row.provocation,
        quality: row.quality,
        radiation: row.radiation,
        severity: row.severity,
        timing: row.timing,
        associated_sx: row.associated_sx,
        family_history: row.family_history,
        medications: row.medications,
        prior_diagnoses: row.prior_diagnoses,
        prior_workups: row.prior_workups,
        allergies: row.allergies,
        alcohol_use: row.alcohol_use,
        alcohol_cage_score: row.alcohol_cage_score,
        smoking_status: row.smoking_status,
        phq2_score: row.phq2_score,
        gad2_score: row.gad2_score,
        safety_screen: row.safety_screen,
        substance_use: row.substance_use,
        critical_unknowns: row.critical_unknowns || [],
        occupation: row.occupation ?? null,
        intake_complete_at: row.intake_complete_at ?? null,

        // Upload gating state (needed for pause/resume UX).
        media_requested: row.media_requested ?? null,
        media_received: row.media_received ?? null,
        media_ids: row.media_ids ?? []
      }
    };
  }

  // W1-S6.2: Idempotent for partial updates — merge with stored, DB uses COALESCE
  // Coerce severity: LLM may pass "5" or "unknown" as string; store number 1-10 or null
  static _coerceSeverity(v) {
    if (v == null) return null;
    if (typeof v === 'number' && v >= 1 && v <= 10) return v;
    const s = String(v).trim().toLowerCase();
    if (s === 'unknown' || s === '' || s === 'n/a') return null;
    const n = parseInt(s, 10);
    return (n >= 1 && n <= 10) ? n : null;
  }

  static _normalizeListToText(v) {
    if (v == null) return v;
    if (Array.isArray(v)) {
      const parts = v
        .map(x => (x == null ? '' : String(x).trim()))
        .filter(Boolean);
      return parts.join(', ');
    }
    return String(v);
  }

  static _normalizeArrayOfStrings(v) {
    if (v == null) return null;
    if (Array.isArray(v)) {
      return v
        .map(x => (x == null ? '' : String(x).trim()))
        .filter(Boolean);
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.startsWith('[')) {
        try {
          const parsed = JSON.parse(t);
          if (Array.isArray(parsed)) {
            return parsed.map(x => (x == null ? '' : String(x).trim())).filter(Boolean);
          }
        } catch (_) {}
      }
      return t
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }
    return null;
  }

  static _skinConcernsListFromRow(row) {
    const raw = row?.skin_concerns_json;
    if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) return p.map((s) => String(s).trim()).filter(Boolean);
      } catch (_) {}
    }
    if (KellyToolExecutor._hasText(row?.quality)) return [String(row.quality).trim()];
    return [];
  }

  static _skinTriggersListFromRow(row) {
    const raw = row?.triggers_json;
    if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) return p.map((s) => String(s).trim()).filter(Boolean);
      } catch (_) {}
    }
    return [];
  }

  static _priorDermatologistSeenAnswered(row) {
    const raw = row?.prior_dermatologist_json;
    let o = raw;
    if (typeof raw === 'string') {
      try {
        o = JSON.parse(raw);
      } catch (_) {
        return false;
      }
    }
    if (!o || typeof o !== 'object') return false;
    return o.seen === true || o.seen === false;
  }

  static _skincareHardGateMissingList(row) {
    const missing = [];
    if (!KellyToolExecutor._hasText(row?.skin_type)) missing.push('skin_type');
    if (!KellyToolExecutor._skinConcernsListFromRow(row).length) missing.push('skin_concerns_or_quality');
    if (!KellyToolExecutor._hasText(row?.pregnancy_status)) missing.push('pregnancy_status');
    if (!KellyToolExecutor._priorDermatologistSeenAnswered(row)) missing.push('prior_dermatologist');
    const fi = row?.functional_impact;
    const n = fi == null || fi === '' ? NaN : parseInt(String(fi), 10);
    if (!Number.isFinite(n) || n < 1 || n > 5) missing.push('functional_impact');
    return missing;
  }

  static _computeSkincareSoftGaps(row) {
    const gaps = [];
    const hasRoutine =
      KellyToolExecutor._hasText(row?.associated_sx) || KellyToolExecutor._hasText(row?.medications);
    if (!hasRoutine) gaps.push('routine_or_products');
    if (!KellyToolExecutor._skinTriggersListFromRow(row).length && !KellyToolExecutor._hasText(row?.provocation)) {
      gaps.push('triggers');
    }
    if (!KellyToolExecutor._hasText(row?.lifestyle_notes)) gaps.push('lifestyle_notes');
    if (!KellyToolExecutor._hasText(row?.environment_notes)) gaps.push('environment_notes');
    if (!KellyToolExecutor._hasText(row?.ingredient_reactions)) gaps.push('ingredient_reactions');
    if (!KellyToolExecutor._hasText(row?.what_has_worked)) gaps.push('what_has_worked');
    if (!KellyToolExecutor._hasText(row?.hormonal_context)) gaps.push('hormonal_context');
    return gaps;
  }

  static _normalizeSkinConcernsForDb(v) {
    if (v == null) return null;
    if (Array.isArray(v)) {
      const arr = v.map((x) => String(x).trim()).filter(Boolean);
      return arr.length ? JSON.stringify(arr) : null;
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return null;
      if (t.startsWith('[')) {
        try {
          const p = JSON.parse(t);
          if (Array.isArray(p)) {
            return JSON.stringify(p.map((x) => String(x).trim()).filter(Boolean));
          }
        } catch (_) {}
      }
      return JSON.stringify([t]);
    }
    return null;
  }

  static _normalizeTriggersForDb(v) {
    if (v == null) return null;
    if (Array.isArray(v)) {
      const arr = v.map((x) => String(x).trim()).filter(Boolean);
      return arr.length ? JSON.stringify(arr) : null;
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return null;
      if (t.startsWith('[')) return t;
      return JSON.stringify([t]);
    }
    return null;
  }

  static _normalizePriorDermForDb(arg, stored) {
    let seen = null;
    let note = '';
    const prevRaw = stored?.prior_dermatologist_json;
    let prev = prevRaw;
    if (typeof prevRaw === 'string') {
      try {
        prev = JSON.parse(prevRaw);
      } catch (_) {
        prev = null;
      }
    }
    if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
      if (prev.seen === true || prev.seen === false) seen = prev.seen;
      if (prev.note != null) note = String(prev.note).slice(0, 2000);
    }
    if (arg !== undefined) {
      if (arg === null) return JSON.stringify({ seen: null, note: '' });
      if (typeof arg === 'object' && arg && !Array.isArray(arg)) {
        if (arg.seen === true || arg.seen === false) seen = arg.seen;
        else if (arg.seen === null) seen = null;
        if (arg.note != null) note = String(arg.note).slice(0, 2000);
      } else if (typeof arg === 'string') {
        const lc = arg.toLowerCase().trim();
        if (/^(yes|yeah|yep|seen|visited|i have)\b/.test(lc)) seen = true;
        else if (/^(no|nope|never|not yet|haven'?t)\b/.test(lc)) seen = false;
        else note = String(arg).slice(0, 2000);
      }
    }
    return JSON.stringify({ seen, note });
  }

  static _mergeSkincareAssessmentForUpsert(args, stored) {
    const out = {};
    out.skin_type =
      args.skin_type !== undefined
        ? args.skin_type == null || args.skin_type === ''
          ? null
          : String(args.skin_type).trim()
        : stored?.skin_type != null && String(stored.skin_type).trim() !== ''
          ? String(stored.skin_type).trim()
          : null;

    if (args.skin_concerns_json !== undefined) {
      out.skin_concerns_json = KellyToolExecutor._normalizeSkinConcernsForDb(args.skin_concerns_json);
    } else {
      const s = stored?.skin_concerns_json;
      if (Array.isArray(s)) out.skin_concerns_json = s.length ? JSON.stringify(s) : null;
      else if (typeof s === 'string' && s.trim()) out.skin_concerns_json = s.trim();
      else out.skin_concerns_json = null;
    }

    out.pregnancy_status =
      args.pregnancy_status !== undefined
        ? args.pregnancy_status == null || args.pregnancy_status === ''
          ? null
          : String(args.pregnancy_status).trim()
        : stored?.pregnancy_status != null && String(stored.pregnancy_status).trim() !== ''
          ? String(stored.pregnancy_status).trim()
          : null;

    if (args.prior_dermatologist_json !== undefined) {
      out.prior_dermatologist_json = KellyToolExecutor._normalizePriorDermForDb(
        args.prior_dermatologist_json,
        stored
      );
    } else {
      const s = stored?.prior_dermatologist_json;
      if (s == null) out.prior_dermatologist_json = null;
      else if (typeof s === 'object') out.prior_dermatologist_json = JSON.stringify(s);
      else out.prior_dermatologist_json = String(s);
    }

    if (args.functional_impact !== undefined) {
      const v = args.functional_impact;
      if (v == null || v === '') out.functional_impact = null;
      else {
        const n = typeof v === 'number' ? v : parseInt(String(v), 10);
        out.functional_impact = Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
      }
    } else {
      const s = stored?.functional_impact;
      const n = s == null || s === '' ? NaN : parseInt(String(s), 10);
      out.functional_impact = Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
    }

    const textMerge = (key) => {
      if (args[key] !== undefined) {
        out[key] = args[key] == null || args[key] === '' ? null : String(args[key]).trim();
      } else {
        out[key] = KellyToolExecutor._hasText(stored?.[key]) ? String(stored[key]).trim() : null;
      }
    };
    textMerge('ingredient_reactions');
    textMerge('what_has_worked');
    textMerge('hormonal_context');
    textMerge('lifestyle_notes');
    textMerge('environment_notes');

    if (args.triggers_json !== undefined) {
      out.triggers_json = KellyToolExecutor._normalizeTriggersForDb(args.triggers_json);
    } else {
      const s = stored?.triggers_json;
      if (Array.isArray(s)) out.triggers_json = s.length ? JSON.stringify(s) : null;
      else if (typeof s === 'string' && s.trim()) out.triggers_json = s.trim();
      else out.triggers_json = null;
    }

    return out;
  }

  static _syncRoutineSkincareIntakeMeta(sessionId, row) {
    try {
      const active = String(KellyToolExecutor._getSessionMeta(sessionId, 'routine_intake_active') || '')
        .toLowerCase();
      if (active !== '1' && active !== 'true') return;
      const missing = KellyToolExecutor._skincareHardGateMissingList(row);
      const gaps = KellyToolExecutor._computeSkincareSoftGaps(row);
      KellyToolExecutor._setSessionMeta(sessionId, 'skincare_intake_hard_missing_json', JSON.stringify(missing));
      KellyToolExecutor._setSessionMeta(sessionId, 'skincare_intake_gaps_json', JSON.stringify(gaps));
      KellyToolExecutor._setSessionMeta(sessionId, 'skincare_intake_hard_complete', missing.length ? '0' : '1');

      const done = String(KellyToolExecutor._getSessionMeta(sessionId, 'intake_complete') || '').toLowerCase();
      if (done === '1' || done === 'true') return;
      if (missing.length) return;

      KellyToolExecutor._setSessionMeta(sessionId, 'intake_complete', '1');
      KellyToolExecutor._setSessionMeta(sessionId, 'skincare_post_intake', '1');
      if (db.upsertTriageSession) {
        db.upsertTriageSession({
          session_id: sessionId,
          intake_complete_at: new Date().toISOString()
        });
      }
    } catch (_) {}
  }

  static _storeTriageOpqrst(args, sessionId, patientId, context = {}) {
    const clinicId = context.clinicId || context.clinic_id || null;
    const customerId = context.customerId || context.customer_id || null;
    try {
      const siteStatus = context.site_context_status || context.siteContextStatus;
      if (siteStatus && siteStatus !== 'verified' && siteStatus !== 'not_required') {
        return {
          success: false,
          error: 'site_context_unverified',
          message: 'Clinical intake requires a verified clinic site. Connecting you with support.'
        };
      }
      if (!db.upsertTriageSession) return { success: true };
      const stored = db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {};
      const rawSeverity = args.severity ?? stored.severity;
      const severity = KellyToolExecutor._coerceSeverity(rawSeverity) ?? stored.severity;
      const merged = {
        onset: args.onset ?? stored.onset,
        provocation: args.provocation ?? stored.provocation,
        quality: args.quality ?? stored.quality,
        radiation: args.radiation ?? stored.radiation,
        severity,
        timing: args.timing ?? stored.timing,
        associated_sx: args.associated_sx ?? stored.associated_sx,
        family_history: args.family_history ?? stored.family_history,
        medications: KellyToolExecutor._normalizeListToText(args.medications ?? stored.medications),
        prior_diagnoses: KellyToolExecutor._normalizeListToText(args.prior_diagnoses ?? stored.prior_diagnoses),
        prior_workups: args.prior_workups ?? stored.prior_workups,
        allergies: KellyToolExecutor._normalizeListToText(args.allergies ?? stored.allergies),
        alcohol_use: args.alcohol_use ?? stored.alcohol_use,
        alcohol_cage_score: (() => {
          const v = args.alcohol_cage_score;
          if (v != null) {
            if (typeof v === 'number' && v >= 0 && v <= 4) return v;
            const n = parseInt(String(v), 10);
            if (n >= 0 && n <= 4) return n;
          }
          return stored.alcohol_cage_score ?? null;
        })(),
        smoking_status: args.smoking_status ?? stored.smoking_status,
        safety_screen: args.safety_screen ?? stored.safety_screen,
        substance_use: args.substance_use ?? stored.substance_use
      };
      const { scorePHQ2, scoreGAD2 } = require('../../utils/phq-gad-scorer');
      let phq2 = args.phq2_score;
      if (phq2 == null && (args.phq2_q1 != null || args.phq2_q2 != null)) {
        phq2 = scorePHQ2({ q1: args.phq2_q1, q2: args.phq2_q2 });
      }
      let gad2 = args.gad2_score;
      if (gad2 == null && (args.gad2_q1 != null || args.gad2_q2 != null)) {
        gad2 = scoreGAD2({ q1: args.gad2_q1, q2: args.gad2_q2 });
      }
      let safetyScreen = args.safety_screen;
      if (safetyScreen == null && (args.safety_screen_q1 != null || args.safety_screen_q2 != null)) {
        const q1 = String(args.safety_screen_q1 || '').toLowerCase();
        const q2 = String(args.safety_screen_q2 || '').toLowerCase();
        const pos = ['yes', 'yeah', 'true', '1'].some(t => q1.includes(t) || q2.includes(t));
        safetyScreen = pos ? 'positive' : 'negative';
      }
      // M-S3.C: opqrst_complete when core OPQRST stored.
      // Provocation/radiation is helpful, but we should not block triage progress when it is missing
      // (otherwise the agent can get stuck in OPQRST-clarification loops).
      const { opqrstComplete: computeOpqrstComplete } = require('../clinical/opqrst-field-gate');
      let triagePolicy = 'conditional';
      try {
        const { loadTenantPolicyFromProfile } = require('../conversation/tenant-policy');
        const policy = loadTenantPolicyFromProfile(db, clinicId, customerId);
        triagePolicy = policy?.triage_policy || 'conditional';
      } catch (_) {}
      const opqrstComplete = computeOpqrstComplete(merged, {
        triagePolicy,
        specialty: merged.target_specialty || stored.target_specialty
      });
      const hasOnset = KellyToolExecutor._hasText(merged.onset);
      const hasQuality = KellyToolExecutor._hasText(merged.quality);
      const hasSeverity = merged.severity != null && merged.severity !== '';
      const hasTiming = KellyToolExecutor._hasText(merged.timing);

      if (process.env.KELLY_DEBUG_OPQRST === '1') {
        console.log('[DEBUG_OPQRST]', {
          sessionId,
          patientId,
          receivedKeys: Object.keys(args || {}),
          received: {
            onset: args.onset != null ? String(args.onset).slice(0, 80) : null,
            quality: args.quality != null ? String(args.quality).slice(0, 80) : null,
            severity: args.severity ?? null,
            timing: args.timing != null ? String(args.timing).slice(0, 80) : null
          },
          flags: { hasOnset, hasQuality, hasSeverity, hasTiming, opqrstComplete }
        });
      }

      const detectedLang = db.getKellySessionLanguage ? db.getKellySessionLanguage(sessionId) : null;
      const opqrstPayload = {
        session_id: sessionId,
        patient_id: patientId,
        clinic_id: clinicId || stored.clinic_id || null,
        customer_id: customerId || stored.customer_id || null,
        opqrst_complete: opqrstComplete,
        onset: merged.onset,
        provocation: merged.provocation,
        quality: merged.quality,
        radiation: merged.radiation,
        severity: merged.severity,
        timing: merged.timing,
        associated_sx: merged.associated_sx,
        family_history: merged.family_history,
        medications: merged.medications,
        prior_diagnoses: merged.prior_diagnoses,
        prior_workups: merged.prior_workups,
        allergies: merged.allergies,
        alcohol_use: merged.alcohol_use,
        alcohol_cage_score: merged.alcohol_cage_score ?? null,
        smoking_status: merged.smoking_status,
        phq2_score: phq2,
        gad2_score: gad2,
        safety_screen: safetyScreen,
        substance_use: merged.substance_use
      };
      if (detectedLang != null) opqrstPayload.detected_language = detectedLang;
      const routineSkin = String(KellyToolExecutor._getSessionMeta(sessionId, 'routine_intake_active') || '')
        .toLowerCase();
      if (routineSkin === '1' || routineSkin === 'true') {
        Object.assign(
          opqrstPayload,
          KellyToolExecutor._mergeSkincareAssessmentForUpsert(args, stored)
        );
      }
      db.upsertTriageSession(opqrstPayload);
      const freshRow = db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {};
      if (routineSkin === '1' || routineSkin === 'true') {
        KellyToolExecutor._syncRoutineSkincareIntakeMeta(sessionId, freshRow);
      }
      return {
        success: true,
        stored: {
          onset: merged.onset || null,
          provocation: merged.provocation || null,
          quality: merged.quality || null,
          radiation: merged.radiation || null,
          severity: merged.severity ?? null,
          timing: merged.timing || null,
          opqrst_complete: opqrstComplete
        }
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Phase 1 T2: dedicated rich-intake storage tool.
  static _storeTriageRichIntake(args, sessionId, patientId) {
    try {
      if (!db.upsertTriageSession) return { success: true };
      // Re-read immediately before upsert so we never downgrade flags after a same-turn OPQRST write.
      const stored = db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {};
      const opqrstWasComplete = KellyToolExecutor._isCompleteFlag(stored.opqrst_complete);
      const triageWasComplete = KellyToolExecutor._isCompleteFlag(stored.triage_complete);

      // Set once (idempotent). If already stored, keep the original timestamp.
      const intakeCompleteAt = stored?.intake_complete_at
        ? stored.intake_complete_at
        : new Date().toISOString();

      const payload = {
        session_id: sessionId,
        patient_id: patientId,
        opqrst_complete: opqrstWasComplete,
        triage_complete: triageWasComplete,

        family_history: args.family_history ?? null,
        medications: this._normalizeListToText(args.medications),
        allergies: this._normalizeListToText(args.allergies),
        prior_diagnoses: this._normalizeListToText(args.prior_diagnoses),
        prior_workups: args.prior_workups ?? null,

        alcohol_use: args.alcohol_use ?? null,
        smoking_status: args.smoking_status ?? null,
        substance_use: args.substance_use ?? null,
        occupation: args.occupation ?? null,

        critical_unknowns: this._normalizeArrayOfStrings(args.critical_unknowns),
        intake_complete_at: intakeCompleteAt
      };

      const skinPick = {};
      for (const k of SKINCARE_ASSESSMENT_DB_KEYS) {
        if (Object.prototype.hasOwnProperty.call(args, k)) skinPick[k] = args[k];
      }
      if (Object.keys(skinPick).length) {
        Object.assign(payload, KellyToolExecutor._mergeSkincareAssessmentForUpsert(skinPick, stored));
      }

      db.upsertTriageSession(payload);
      const ri = String(KellyToolExecutor._getSessionMeta(sessionId, 'routine_intake_active') || '')
        .toLowerCase();
      if (ri === '1' || ri === 'true') {
        const fresh = db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {};
        KellyToolExecutor._syncRoutineSkincareIntakeMeta(sessionId, fresh);
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async _collectInsurance(args, ctx) {
    const { collectInsurance } = require('../kelly-tool-executor/collect-insurance');
    return collectInsurance(KellyToolExecutor, this, args, ctx);
  }

  static _clearHitlResumeOnCollectSuccess(sessionId) {
    try {
      const { clearCodingHitlResumePending } = require('../clinical/coding-hitl-resume');
      clearCodingHitlResumePending(sessionId);
    } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────────
  // Triage RAG — gap10+12: merge session state, include media
  // ─────────────────────────────────────────────────────────────
  static async _runTriageRAG(args, sessionId, patientId, clinicId) {
    try {
      const forceRerun = args?.force_rerun === true || args?.force_rerun === 'true';
      if (!forceRerun && KellyToolExecutor._triageLockedForRerag(sessionId)) {
        const existing = TriageRAGService.getAuthoritativeForSession(sessionId);
        if (existing) {
          return {
            success: true,
            skipped_rerun: true,
            triage_complete: true,
            target_specialty: existing.target_specialty,
            patient_friendly_summary: existing.patient_friendly_summary,
            rag_confidence: existing.rag_confidence,
            safety_level: existing.safety_level || 'green',
            urgency: existing.urgency || 'routine'
          };
        }
      }
      const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
      const stored = sessionRow || {};
      const opqrst = {
        onset: args.onset || stored.onset || '',
        provocation: args.provocation || stored.provocation || '',
        quality: args.quality || stored.quality || '',
        radiation: args.radiation || stored.radiation || '',
        severity: KellyToolExecutor._coerceSeverity(args.severity != null ? args.severity : stored.severity),
        timing: args.timing || stored.timing || '',
        associated_sx: args.associated_sx || stored.associated_sx || ''
      };
      const richIntake = {
        family_history: args.family_history || stored.family_history || '',
        medications: args.medications || stored.medications || '',
        prior_diagnoses: args.prior_diagnoses || stored.prior_diagnoses || '',
        prior_workups: args.prior_workups || stored.prior_workups || '',
        allergies: args.allergies || stored.allergies || '',
        alcohol_use: args.alcohol_use || stored.alcohol_use || '',
        alcohol_cage_score: args.alcohol_cage_score ?? stored.alcohol_cage_score,
        smoking_status: args.smoking_status || stored.smoking_status || '',
        safety_screen: args.safety_screen || stored.safety_screen || ''
      };

      let symptomText = args.symptom_text || '';
      if (db.getTriageMediaForSession) {
        const media = db.getTriageMediaForSession(sessionId);
        for (const m of media) {
          let text = '';
          if (m.ai_analysis) {
            try {
              const analysis = typeof m.ai_analysis === 'string' ? JSON.parse(m.ai_analysis) : m.ai_analysis;
              text = analysis?.summary || analysis?.description || analysis?.text || '';
            } catch (_) {}
          }
          if (!text) text = m.context_note || m.file_name || '';
          if (text) symptomText += ` [Uploaded: ${text}]`;
        }
      }
      // M-Doc: Include vision/PDF-extracted text so triage RAG sees image content, not just filenames
      const MAX_TRIAGE_EXTRACTS = 5;
      const MAX_EXTRACT_CHARS = 4000;
      if (patientId && db.getPatientDocumentExtractsByPatient) {
        const extracts = db.getPatientDocumentExtractsByPatient(patientId)
          .filter(e => e.extracted_text && String(e.extracted_text).trim())
          .slice(0, MAX_TRIAGE_EXTRACTS);
        for (const e of extracts) {
          const text = String(e.extracted_text).trim().slice(0, MAX_EXTRACT_CHARS);
          if (text) symptomText += ` [Document extract (${e.doc_id}): ${text}]`;
        }
      }

      const useV2 = process.env.USE_TRIAGE_RAG_V2 === '1' || process.env.USE_TRIAGE_RAG_V2 === 'true';
      const RagService = useV2 ? TriageRAGServiceV2 : TriageRAGService;

      // If the model provided question-level safety answers (q1/q2) but did not
      // provide the normalized `safety_screen` string, compute it here.
      let safetyScreenNorm = richIntake.safety_screen;
      if ((!safetyScreenNorm || String(safetyScreenNorm).trim() === '') &&
        (args.safety_screen_q1 != null || args.safety_screen_q2 != null)) {
        const q1 = String(args.safety_screen_q1 || '').toLowerCase();
        const q2 = String(args.safety_screen_q2 || '').toLowerCase();
        const pos = ['yes', 'yeah', 'true', '1'].some(t => q1.includes(t) || q2.includes(t));
        safetyScreenNorm = pos ? 'positive' : 'negative';
      }
      richIntake.safety_screen = safetyScreenNorm;

      const result = await RagService.enrichFromSymptoms({
        sessionId,
        symptomText: symptomText.trim() || 'Patient-reported symptoms',
        opqrst,
        richIntake,
        patientId,
        clinicId,
        force_rerun: forceRerun
      });

      const THRESHOLD = KellyToolExecutor._ragConfidenceThreshold();
      const isRoutineBypass =
        /routine wellness visit|no active symptoms/i.test(args.symptom_text || '') &&
        !KellyToolExecutor._triageRowHasConcernOrOnsetStored(sessionId);
      const routineNoSymptomsFlag = KellyToolExecutor._routineNoSymptomsEffective(sessionId);
      if (isRoutineBypass || routineNoSymptomsFlag) {
        result.rag_confidence = Math.max(result.rag_confidence || 0, THRESHOLD);
        result.triage_complete = true;
        result.target_specialty = result.target_specialty || 'PrimaryCare';
        result.urgency = result.urgency || 'routine';
        result.safety_level = result.safety_level || 'green';
        if (_kellyToolDebug()) {
          console.log('[RAG] Routine bypass: forcing triage_complete=true, confidence=', result.rag_confidence);
        }
      }

      // M-S3.C: triage_complete when OPQRST + (≥1 differential or specialty) + confidence gate.
      // Rich-intake remains a scheduling/slot gate; do not block triage_complete on intake timestamp.
      const hasDifferential = (result.differentials || []).length >= 1;
      const hasSpecialty = !!(result.target_specialty);
      const conf = KellyToolExecutor._confidenceFromTriageRow(result);
      // Allow a small "near threshold" window when we already have a specialty, so
      // we don't get stuck in clarifying loops when the external differential
      // generation is flaky but a target_specialty is still present.
      const confNearThreshold = isConfidenceNearThreshold(conf, THRESHOLD);
      const confOk = conf >= THRESHOLD || (hasSpecialty && confNearThreshold);
      // Expose the effective threshold so the LLM can make consistent routing decisions.
      result.rag_confidence_threshold = THRESHOLD;
      result.rag_confidence_ok = confOk;
      const latestSession = db.getTriageSession ? db.getTriageSession(sessionId) : sessionRow;
      const opqrstComplete = latestSession && KellyToolExecutor._isCompleteFlag(latestSession.opqrst_complete);
      const triageComplete = !!(result.triage_complete || (opqrstComplete && (hasDifferential || hasSpecialty) && confOk));

      // Debug telemetry: explain why triage_complete isn't being set.
      if (!triageComplete) {
        const reasons = {
          opqrst_complete: !!opqrstComplete,
          has_differentials: hasDifferential,
          has_target_specialty: hasSpecialty,
          rag_confidence: conf,
          rag_confidence_threshold: THRESHOLD,
          triage_complete_computed: triageComplete
        };
        console.warn('[KellyToolExecutor] triage_complete remains false:', JSON.stringify(reasons));
      }

      // M-S2.C: Critical gate — when rag_confidence < threshold, Kelly must ask one more question before routing.
      // If we already accepted a "near threshold" confidence (confOk), don't keep forcing the loop.
      if (conf < THRESHOLD && !confOk) {
        result.suggested_next_step = 'Ask one more clarifying question (e.g. "Can you describe the pain in more detail?" or "Is it on both sides or one side?") then call run_triage_rag again before looking up slots.';
        result.low_confidence = true;
      }

      const detectedLang = db.getKellySessionLanguage ? db.getKellySessionLanguage(sessionId) : null;
      if (db.upsertTriageSession) {
        const sessionPayload = {
          session_id: sessionId,
          patient_id: patientId,
          rag_result_id: result.id,
          safety_level: result.safety_level,
          urgency: result.urgency,
          target_specialty: result.target_specialty,
          opqrst_complete: opqrstComplete,
          triage_complete: triageComplete,
          media_received: true,
          // Bug 6: Pass [] explicitly when empty so stale DB value is cleared on second pass
          critical_unknowns: result.critical_unknowns ?? []
        };
        // Bug 12: Only include detected_language when non-null to avoid overwriting stored value
        if (detectedLang != null) sessionPayload.detected_language = detectedLang;
        // W4-S6.3: Persist SOAP to triage_sessions when triage_complete
        if (triageComplete && result.soap_note) sessionPayload.soap_note = result.soap_note;
        db.upsertTriageSession(sessionPayload);
        if (triageComplete) {
          try {
            KellyToolExecutor._setSessionMeta(sessionId, 'kelly_triage_reopen', '0');
          } catch (_) {}
        }
      }
      return result;
    } catch (err) {
      console.warn('[KellyToolExecutor] TriageRAG unavailable:', err.message);
      return {
        success: false,
        error: err.message,
        safety_level: 'green',
        urgency: 'routine',
        target_specialty: 'PrimaryCare',
        rag_confidence: 0.5
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Document upload request — gap10: set media_requested
  // ─────────────────────────────────────────────────────────────
  static async _requestDocumentUpload(args, sessionId, patientId, callerPhone, channel) {
    try {
      // If we already have uploaded media for this session, do not clear it or
      // keep forcing the user to upload again.
      let existingMediaIds = [];
      let hasMedia = false;
      try {
        if (db.getTriageMediaForSession) {
          const media = db.getTriageMediaForSession(sessionId) || [];
          existingMediaIds = Array.isArray(media)
            ? media.map(m => m?.id).filter(Boolean)
            : [];
          hasMedia = existingMediaIds.length > 0;
        }
      } catch (_) {}

      if (db.upsertTriageSession) {
        db.upsertTriageSession({
          session_id: sessionId,
          patient_id: patientId,
          media_requested: true,
          media_received: hasMedia,
          media_ids: existingMediaIds
        });
      }

      // If upload already exists, unblock the flow by not returning an upload gate.
      if (hasMedia) {
        return {
          success: true,
          channel: channel === 'voice' ? 'voice' : 'chat_widget',
          upload_requested: false,
          message: 'I already received your document/photo. Proceeding with triage.'
        };
      }

      if (channel === 'voice' && callerPhone) {
        const result = await this._post('/api/patient/send-upload-link', {
          patient_id: patientId || undefined,
          patient_phone: callerPhone,
          session_id: sessionId
        });
        return {
          success: true,
          channel: 'sms',
          sent: result.sent,
          message: `Upload link sent to ${callerPhone}. The patient can use it to upload their ${args.reason}.`
        };
      }

      return {
        success: true,
        channel: 'chat_widget',
        upload_requested: true,
        reason: args.reason,
        message: `Please upload your ${args.reason} using the button below.`,
        next_step: 'UPLOAD_IMAGE'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `I wasn't able to send the upload link. Please ask the patient to upload through the patient portal.`
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // M-Doc.3: query_patient_records — RAG over patient document extracts
  // ─────────────────────────────────────────────────────────────
  static async _queryPatientRecords(args, patientId) {
    if (!patientId) {
      return { success: false, answer: "I don't have access to your records yet. Please complete identification first.", sources: 0 };
    }
    const query = (args.query || '').toString().trim();
    if (!query) {
      return { success: false, answer: "What would you like to know about your records?", sources: 0 };
    }
    try {
      const { answer, sources } = await QueryPlanner.runRecordsRetrieval({ patientId, query });
      return { success: true, answer, sources };
    } catch (e) {
      return { success: false, answer: "I couldn't look up your records right now. Please try again.", sources: 0 };
    }
  }

  static async _resolveProductIngredients(args) {
    const productName = String(args?.product_name || args?.name || '').trim();
    const brand = String(args?.brand || '').trim();
    if (!productName) return { success: false, error: 'product_name_required' };
    return ProductIngredientResolver.resolveProductByName({ productName, brand });
  }

  static async _lookupIngredientFunctions(args) {
    const raw = args?.inci_list;
    let inciList = [];
    if (Array.isArray(raw)) inciList = raw.map((v) => String(v || '').trim()).filter(Boolean);
    else if (raw != null) inciList = String(raw).split(',').map((v) => v.trim()).filter(Boolean);
    if (!inciList.length) return { success: false, error: 'inci_list_required' };
    return ProductIngredientResolver.lookupIngredientFunctions(inciList);
  }

  /**
   * Deterministic routine verdict (Layer B) + curated RAG chunk pointers.
   * Persists JSON to kelly_session_meta_kv for session snapshot / reasoning_map merge.
   */
  static async _evaluateSkincareRoutine(args, sessionId) {
    try {
      const graph = db.createIngredientConflictGraph && db.createIngredientConflictGraph();
      if (!graph) return { success: false, error: 'conflict_graph_unavailable' };
      let slots = Array.isArray(args?.slots) ? args.slots : [];
      const sid = sessionId ? String(sessionId) : '';
      if (!slots.length && sid) {
        try {
          const { createSessionStateService } = require('../shared/session-state');
          const sessions = createSessionStateService(db.db);
          const pack = sessions.getRoutineForEvaluation(sid);
          slots = pack && Array.isArray(pack.slots) ? pack.slots : [];
        } catch (_) {}
      }
      if (!slots.length) {
        return { success: false, error: 'slots_required', message: 'Provide slots or persist a routine in user_sessions for this session.' };
      }
      const verdict = graph.evaluateRoutine(slots);
      if (sessionId) {
        KellyToolExecutor._setSessionMeta(sessionId, 'kelly_routine_verdict_json', JSON.stringify(verdict));
      }
      const {
        getChunksForRoutineVerdict,
        legacyRowsFromUnifiedChunks,
        unifiedChunksFromLegacyRagRows,
      } = require('../catalog/ingredient-rag-chunks-service');

      let knowledge_chunk_bundle = null;
      let routine_reply = null;
      let routine_reply_validation = null;
      let system_prompt = null;
      let user_prompt = null;
      let agent_turn = null;
      const skipUnified = process.env.KELLY_SKIP_UNIFIED_ROUTINE_BUNDLE === '1';
      if (!skipUnified) {
        try {
          const { buildRoutineReasoningPayload } = require('../catalog/routine-reasoning-orchestrator');
          const payload = buildRoutineReasoningPayload({
            db: db.db,
            sessionId: sid || 'kelly',
            slots,
            userMessage: (args?.user_message || args?.message || '').toString(),
            productIds: Array.isArray(args?.product_ids)
              ? args.product_ids.map((x) => String(x || '').trim()).filter(Boolean)
              : undefined,
          });
          knowledge_chunk_bundle = payload.chunkBundle;
          routine_reply = payload.routine_reply;
          routine_reply_validation = payload.validation;
          if (routine_reply_validation && routine_reply_validation.valid === false) {
            try {
              const { logRoutineReplyRejected } = require('../platform/composer');
              logRoutineReplyRejected({
                source: 'kelly_unified_routine_bundle',
                errors: routine_reply_validation.errors,
                reply: routine_reply,
                context: { stage: 'orchestrator', sessionId: sid || null },
              });
            } catch (_) {}
          }
          system_prompt = payload.system_prompt;
          user_prompt = payload.user_prompt;
          agent_turn = payload.agentTurn || null;
        } catch (_) {
          /* optional path if migrations 031 not applied */
        }
      }

      const legacyRagRows =
        knowledge_chunk_bundle && Array.isArray(knowledge_chunk_bundle.chunks)
          ? legacyRowsFromUnifiedChunks(knowledge_chunk_bundle.chunks)
          : getChunksForRoutineVerdict(verdict);

      let evidence_bundle;
      if (knowledge_chunk_bundle && Array.isArray(knowledge_chunk_bundle.chunks)) {
        evidence_bundle = {
          schema_version: '1',
          chunks: knowledge_chunk_bundle.chunks,
          chunk_ids: Array.isArray(knowledge_chunk_bundle.chunk_ids) ? knowledge_chunk_bundle.chunk_ids : [],
          coverage: Array.isArray(knowledge_chunk_bundle.coverage) ? knowledge_chunk_bundle.coverage : [],
        };
      } else {
        const uChunks = unifiedChunksFromLegacyRagRows(legacyRagRows);
        evidence_bundle = {
          schema_version: '1',
          chunks: uChunks,
          chunk_ids: legacyRagRows.map((r) => r.id),
          coverage: [],
        };
      }

      const dualRag =
        String(process.env.KELLY_ROUTINE_DUAL_RAG_SHAPES || '').toLowerCase() === '1' ||
        String(process.env.KELLY_ROUTINE_DUAL_RAG_SHAPES || '').toLowerCase() === 'true';

      const base = {
        success: true,
        verdict,
        evidence_bundle,
        routine_reply,
        routine_reply_validation,
        system_prompt,
        user_prompt,
        agent_turn,
        kelly_contract: {
          version: '1',
          must_not_soften_avoid: true,
          cite: ['overall', 'conflicts', 'reason_codes', 'suggested_split', 'evidence_bundle'],
        },
      };

      if (dualRag) {
        base.rag_chunks = legacyRagRows;
        base.knowledge_chunk_bundle =
          knowledge_chunk_bundle ||
          (evidence_bundle
            ? {
                chunks: evidence_bundle.chunks,
                chunk_ids: evidence_bundle.chunk_ids,
                coverage: evidence_bundle.coverage,
              }
            : null);
      }

      return base;
    } catch (e) {
      return { success: false, error: 'evaluate_skincare_routine_failed', message: e.message };
    }
  }

  static _retrieveIngredientMonographs(args) {
    try {
      const { getChunksByIngredientIds, getChunksByReasonCodes } = require('../catalog/ingredient-rag-chunks-service');
      const ids = Array.isArray(args?.ingredient_ids) ? args.ingredient_ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
      const codes = Array.isArray(args?.reason_codes) ? args.reason_codes.map((x) => String(x || '').trim()).filter(Boolean) : [];
      const byId = ids.length ? getChunksByIngredientIds(ids) : [];
      const byRc = codes.length ? getChunksByReasonCodes(codes) : [];
      const seen = new Set();
      const chunks = [];
      for (const row of [...byId, ...byRc]) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        chunks.push(row);
      }
      return { success: true, chunks, count: chunks.length };
    } catch (e) {
      return { success: false, error: e.message, chunks: [] };
    }
  }

  static _getIngredientResolutionMetrics() {
    try {
      const m = require('../catalog/ingredient-resolution-metrics');
      return {
        success: true,
        ...m.getIngredientResolutionMetrics(),
        top_unresolved_tokens: m.getTopUnresolvedInciTokens(20)
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static _getCatalogCoverageMetrics() {
    try {
      const { getCatalogCoverageMetrics } = require('../catalog/catalog-coverage-metrics');
      return { success: true, ...getCatalogCoverageMetrics() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /** Phase 5 — same pipeline as POST /api/patient/derm-qa (feature-flagged). */
  static async _runDermPatientQA(args, patientId) {
    const enabled = String(process.env.DERM_EDUCATION_PIPELINE_ENABLED || 'false').toLowerCase() === 'true';
    if (!enabled) {
      return {
        success: false,
        error: 'derm_education_pipeline_disabled',
        message: 'Derm Q&A pipeline is not enabled in this environment.'
      };
    }
    const message = (args.message || '').toString().trim();
    if (!message) {
      return { success: false, error: 'message_required' };
    }
    try {
      const { runDermPatientQAPipeline } = require('../shared/derm-patient-qa-pipeline');
      const out = await runDermPatientQAPipeline({
        message,
        imageCaption: (args.image_caption || args.imageCaption || '').toString().trim(),
        imagePresent: args.image_present === true || args.imagePresent === true,
        patient_id: patientId || null
      });
      const e2eLog =
        String(process.env.DERM_QA_E2E_LOG || '').toLowerCase() === 'true' ||
        process.env.DERM_QA_E2E_LOG === '1' ||
        String(process.env.DERM_QA_TOOL_LOG || '').toLowerCase() === 'true';
      if (e2eLog) {
        const payload = {
          tool: 'run_derm_patient_qa',
          at: new Date().toISOString(),
          success: !!out.success,
          llm_used: !!out.llm_used,
          compose_mode: out.compose && out.compose.mode,
          abstain_reason: out.compose && out.compose.abstain_reason,
          answer_chars: out.answer_text ? String(out.answer_text).length : 0,
          patient_id: patientId || null
        };
        console.log('[DERM_QA_E2E]', JSON.stringify(payload));
      }
      return {
        ...out,
        answer: out.answer_text,
        patient_id: patientId || null,
        tool: 'run_derm_patient_qa'
      };
    } catch (e) {
      if (
        String(process.env.DERM_QA_E2E_LOG || '').toLowerCase() === 'true' ||
        process.env.DERM_QA_E2E_LOG === '1'
      ) {
        console.error('[DERM_QA_E2E]', JSON.stringify({ tool: 'run_derm_patient_qa', error: e.message }));
      }
      return { success: false, error: 'run_failed', message: e.message };
    }
  }
}

module.exports = KellyToolExecutor;
