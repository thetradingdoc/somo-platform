'use strict';

const axios = require('axios');

const BASE_URL = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';

function internalJobHeaders() {
  const tok = process.env.INTERNAL_JOB_TOKEN || process.env.INTERNAL_API_TOKEN || '';
  return tok ? { 'x-internal-job-token': tok } : {};
}

function httpTimeoutMs() {
  const v = parseInt(process.env.KELLY_TOOL_HTTP_TIMEOUT_MS || '15000', 10);
  return Number.isFinite(v) && v > 0 ? v : 15000;
}

function ensureSlotBundles(result, date, practitionerId = null) {
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

async function postDirect(path, body = {}) {
  const BookingService = require('../booking-service');
  const p = String(path || '');
  if (p.includes('available-slots')) {
    const resultRaw = await BookingService.getAvailableSlots(
      body.date,
      body.provider || null,
      body.appointment_type,
      body.timezone || 'America/New_York',
      body.clinic_id,
      body.practitioner_id || null
    );
    return ensureSlotBundles(resultRaw, body.date, body.practitioner_id || null);
  }
  if (p.includes('/schedule')) {
    return BookingService.scheduleAppointment({
      patient_name: body.patient_name,
      patient_phone: body.patient_phone,
      patient_email: body.patient_email,
      patient_id: body.patient_id,
      appointment_type: body.appointment_type || 'Dermatology',
      date: body.date || body.appointment_date,
      time: body.time,
      duration_minutes: body.duration_minutes || 50,
      provider: body.provider,
      practitioner_id: body.practitioner_id || body.slot_id || null,
      notes: body.notes,
      timezone: body.timezone || 'America/New_York',
      clinic_id: body.clinic_id,
      primary_icd10: body.primary_icd10 || null,
      primary_cpt: body.primary_cpt || null
    });
  }
  if (p.includes('/appointments/search') || p.includes('search')) {
    if (body.patient_id && body.clinic_id) {
      const dbMod = require('../../database');
      const rows =
        dbMod.db
          ?.prepare(
            `SELECT * FROM appointments WHERE patient_id = ? AND clinic_id = ?
             AND (deleted_at IS NULL OR deleted_at = '')
             ORDER BY datetime(created_at) DESC LIMIT 10`
          )
          ?.all(body.patient_id, body.clinic_id) || [];
      if (rows.length) {
        return { success: true, appointments: rows, count: rows.length };
      }
    }
    const searchTerm =
      body.search_term || body.phone || body.patient_phone || body.email || body.patient_email;
    if (!searchTerm) {
      return { success: false, error: 'search_term required' };
    }
    return BookingService.searchAppointments(searchTerm, body.clinic_id || null);
  }
  if (p.includes('/cancel')) {
    return BookingService.cancelAppointment(body.appointment_id, body.reason || null, body.clinic_id || null);
  }
  if (p.includes('/reschedule')) {
    return BookingService.rescheduleAppointment(
      body.appointment_id,
      body.new_date,
      body.new_time,
      body.reason || null,
      body.timezone || null,
      body.clinic_id || null
    );
  }
  if (p.includes('/insurance/collect')) {
    return {
      success: true,
      call_id: body.call_id || body.session_id || null,
      patient_id: body.patient_id || null,
      primary_icd10: body.primary_icd10 || null,
      primary_cpt: body.primary_cpt || null,
      code_source: body.code_source || 'spine',
      quote: body.quote || null
    };
  }

  if (String(process.env.PSTN_REPLAY_COMMERCE || '').trim() === '1') {
    if (p.includes('/commerce/email/send-code')) {
      const EmailVerificationService = require('../email-verification-service');
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return { success: false, error: 'email_required' };
      return EmailVerificationService.sendVerificationCode(email);
    }
    if (p.includes('/commerce/email/verify-code')) {
      const EmailVerificationService = require('../email-verification-service');
      return EmailVerificationService.verifyCode(body.email, body.code);
    }
    if (p.includes('/commerce/quote')) {
      const dbMod = require('../../database');
      const merchantId = body.provider_id || body.merchant_id;
      const productId = body.product_id || body.prescription_id;
      const qty = Math.max(1, Number(body.quantity) || 1);
      if (!merchantId) return { success: false, error: 'merchant_not_found' };
      if (!productId) return { success: false, error: 'product_id_required' };
      const product = dbMod.getProduct(productId);
      if (!product) return { success: false, error: 'product_not_found' };
      if (product.merchant_id && product.merchant_id !== merchantId) {
        return { success: false, error: 'product_merchant_mismatch' };
      }
      const unit = Number(product.price || 0);
      const amount = Number((unit * qty).toFixed(2));
      const quoteId = `pstn_quote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        success: true,
        quote_id: quoteId,
        checkout_session_id: quoteId,
        prescription_id: productId,
        product_id: productId,
        amount,
        subtotal: amount,
        tax_amount: 0,
        tax_rate: 0,
        tax_included: false,
        quantity: qty,
        currency: 'USD'
      };
    }
    if (p.includes('/checkout/start')) {
      const pi = `pi_pstn_replay_${Date.now()}`;
      const checkoutId = `chk_pstn_${Date.now()}`;
      return {
        success: true,
        checkout: {
          checkout_id: checkoutId,
          payment_intent_id: pi,
          client_secret: `${pi}_secret`
        },
        commerce_checkout: {
          checkout_id: checkoutId,
          payment_action: {
            type: 'stripe_payment_intent',
            payment_intent_id: pi,
            client_secret: `${pi}_secret`
          }
        }
      };
    }
  }

  throw new Error(`RCM_E2E_DIRECT_TOOLS: unsupported path ${path}`);
}

async function kellyPost(path, body) {
  if (String(process.env.RCM_E2E_DIRECT_TOOLS || '').trim() === '1') {
    return postDirect(path, body);
  }
  const response = await axios.post(`${BASE_URL}${path}`, body, {
    timeout: httpTimeoutMs(),
    headers: internalJobHeaders()
  });
  return response.data;
}

module.exports = {
  kellyPost,
  postDirect,
  internalJobHeaders,
  httpTimeoutMs,
  ensureSlotBundles,
  BASE_URL
};
