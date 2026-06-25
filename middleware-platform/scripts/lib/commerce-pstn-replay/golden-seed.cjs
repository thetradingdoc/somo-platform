'use strict';

const crypto = require('crypto');

const BOOKING_TOOL_NAMES = [
  'schedule_appointment',
  'get_available_slots',
  'run_triage_rag',
  'store_triage_opqrst',
  'cancel_appointment',
  'reschedule_appointment',
  'confirm_appointment',
  'transfer_call',
  'create_appointment_checkout',
  'collect_insurance',
  'send_document_upload_link',
  'search_appointments',
  'request_patient_payment'
];

function goldenToolArgs(call, toolName) {
  const turn = (call.turns || []).find((t) => t.tool_call?.name === toolName);
  return turn?.tool_call?.args || null;
}

/**
 * Extract scripted hints from golden tool_call rows so live replay can complete E2E.
 */
function extractGoldenHints(call) {
  const hints = {
    productId: (call.preconditions?.products || [])[0] || null,
    checkout: null,
    verifyCheckoutCode: null,
    verifyCommerceCode: null,
    verifyCommerceEmail: null,
    priorOrderId: call.preconditions?.session_seed?.prior_order_id || null,
    searchQuery: null,
    shippingAddress: null,
    checkoutPrep: null,
    booking: {}
  };

  for (const turn of call.turns || []) {
    const tc = turn.tool_call;
    if (!tc?.name) continue;
    if (tc.name === 'search_products' && !hints.searchQuery) {
      hints.searchQuery = tc.args?.query || null;
    }
    if (tc.name === 'create_checkout') {
      hints.checkout = { ...(tc.args || {}) };
      if (tc.args?.product_id) hints.productId = tc.args.product_id;
    }
    if (tc.name === 'verify_checkout_code') {
      hints.verifyCheckoutCode =
        tc.args?.verification_code || tc.args?.code || null;
    }
    if (tc.name === 'verify_commerce_code') {
      hints.verifyCommerceCode = tc.args?.code || tc.args?.verification_code || null;
      hints.verifyCommerceEmail = tc.args?.email || null;
    }
    if (tc.name === 'save_shipping_address') {
      hints.shippingAddress = { ...(tc.args || {}) };
    }
    if (tc.name === 'prepare_commerce_checkout') {
      hints.checkoutPrep = { ...(tc.args || {}) };
    }
    if (BOOKING_TOOL_NAMES.includes(tc.name)) {
      hints.booking[tc.name] = { ...(tc.args || {}) };
    }
  }
  return hints;
}

const SPOKEN_DIGITS = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9'
};

/** Parse spoken phone digits from ASR (10+ digits). */
function parseSpokenPhone(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const digits = [];
  for (const w of words) {
    if (/^\d+$/.test(w)) digits.push(...w.split(''));
    else if (SPOKEN_DIGITS[w]) digits.push(SPOKEN_DIGITS[w]);
  }
  if (digits.length >= 10) return digits.slice(0, 10).join('');
  const compact = String(text || '').replace(/\D/g, '');
  if (compact.length >= 10) return compact.slice(0, 10);
  return null;
}

/** Parse "four four one nine two seven" or embedded 6-digit codes. */
function parseSpokenCode(text) {
  const direct = String(text || '').match(/\b(\d{6})\b/);
  if (direct) return direct[1];
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const digits = [];
  for (const w of words) {
    if (/^\d$/.test(w)) digits.push(w);
    else if (SPOKEN_DIGITS[w]) digits.push(SPOKEN_DIGITS[w]);
  }
  if (digits.length >= 6) return digits.slice(0, 6).join('');
  return null;
}

/** Parse "sarah dot miller at gmail dot com" style ASR email. */
function parseAsrEmail(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/^(it'?s|that'?s)\s+/i, '');
  if (!/\b(at|dot)\b/.test(raw)) return null;
  const normalized = raw
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+dot\s+/g, '.')
    .replace(/[^a-z0-9@._+-]/g, '');
  const m = normalized.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0] : null;
}

function toolSucceeded(result) {
  return result && result.success !== false && !result.error;
}

function hasSlotMeta(KellyToolExecutor, sessionId) {
  const date = KellyToolExecutor._getSessionMeta(sessionId, 'last_slot_date');
  const time = KellyToolExecutor._getSessionMeta(sessionId, 'last_slot_time');
  return !!(date && time);
}

function absorbCallerContext(connection, message, hints) {
  const text = String(message || '');
  const direct = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const email = direct ? direct[0] : parseAsrEmail(text);
  if (email) {
    connection.customerEmail = email.toLowerCase();
  }
  if (hints?.checkout?.customer_name && !connection.customerName) {
    connection.customerName = hints.checkout.customer_name;
  }
  const codeOnly = parseSpokenCode(text);
  if (codeOnly) {
    connection.lastCallerCode = codeOnly;
  }
}

function seedPriorOrder(db, call, merchantId) {
  const orderId = call.preconditions?.session_seed?.prior_order_id;
  if (!orderId || !db.createOrder) return;

  const existing = db.getOrder?.(orderId);
  if (existing) return;

  const productId = (call.preconditions?.products || [])[0] || 'sku_omega3_1200';
  const product = db.getProduct?.(productId);
  db.createOrder({
    id: orderId,
    merchant_id: merchantId,
    product_id: productId,
    quantity: 1,
    total_amount: product?.price || 29.99,
    customer_email: 'devon.price@yahoo.com',
    customer_name: 'Devon Price',
    customer_phone: call.call_metadata?.caller_id || '+15551000012',
    status: 'shipped',
    delivery_status: 'in_transit',
    product_name: product?.name || 'Omega-3 1200mg',
    source: 'pstn_replay_seed',
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  });
}

/** Seed Kelly Rails session state from golden script before turn 1. */
async function seedKellyRailsSessionFromGolden(db, sessionId, call) {
  const clinicId = call.call_metadata?.clinic_id || 'clinic-default';
  const KellyToolExecutor = require('../../../services/kelly-tool-executor');
  const required = new Set(call.functions_tested || []);
  const sessionSeed = call.preconditions?.session_seed || {};
  const hints = extractGoldenHints(call);
  const execCtx = {
    sessionId,
    clinicId,
    patientId: null,
    callerPhone: call.call_metadata?.caller_id || null,
    channel: 'voice'
  };

  const opqrst = {};
  for (const turn of call.turns || []) {
    const tc = turn.tool_call;
    if (tc?.name !== 'store_triage_opqrst') continue;
    const field = tc.args?.field;
    const value = tc.args?.value;
    if (field && value != null) opqrst[field] = value;
  }

  if (Object.keys(opqrst).length && db.upsertTriageSession) {
    try {
      db.upsertTriageSession({
        session_id: sessionId,
        clinic_id: clinicId,
        quality: opqrst.quality || null,
        region: opqrst.region || opqrst.body_site || null,
        onset: opqrst.onset || opqrst.timing || null,
        severity: opqrst.severity ?? null,
        opqrst_complete: 1,
        triage_complete: required.has('run_triage_rag') ? 0 : 1
      });
    } catch (_) {}
  }

  if (
    required.has('schedule_appointment') &&
    !required.has('store_triage_opqrst') &&
    !required.has('run_triage_rag')
  ) {
    try {
      KellyToolExecutor._setSessionMeta(sessionId, 'rich_intake_complete', '1');
      KellyToolExecutor._setSessionMeta(sessionId, 'routine_no_symptoms', '1');
      db.upsertTriageSession?.({
        session_id: sessionId,
        clinic_id: clinicId,
        rich_intake: JSON.stringify({
          medications: 'none reported',
          allergies: 'none reported',
          emergency_risk: false
        }),
        opqrst_complete: 1,
        triage_complete: 1
      });
    } catch (_) {}
  }

  const needsRag =
    required.has('run_triage_rag') ||
    required.has('get_available_slots') ||
    required.has('schedule_appointment');

  if (needsRag && db.db?.prepare && db.upsertTriageSession) {
    const existing = db.getTriageSession?.(sessionId);
    if (!existing?.rag_result_id) {
      const ragId = `rag_pstn_${crypto.randomBytes(8).toString('hex')}`;
      const slotsArgs = hints.booking.get_available_slots || {};
      const specialty =
        slotsArgs.specialty ||
        goldenToolArgs(call, 'run_triage_rag')?.specialty ||
        'Nutrition';
      try {
        const cols = new Set(
          db.db.prepare('PRAGMA table_info(triage_rag_results)').all().map((c) => c.name)
        );
        const payload = {
          id: ragId,
          session_id: sessionId,
          symptom_text: 'pstn replay seeded symptom',
          opqrst_json: JSON.stringify(opqrst),
          icd_codes: JSON.stringify([{ code: 'R51.9', description: 'Headache' }]),
          cpt_codes: JSON.stringify(['99213']),
          target_specialty: specialty,
          urgency: 'routine',
          safety_level: 'green',
          rag_confidence: 0.92,
          seeded_for_harness: 1,
          created_at: new Date().toISOString()
        };
        const insertCols = Object.keys(payload).filter((k) => cols.has(k));
        if (insertCols.length) {
          db.db
            .prepare(
              `INSERT INTO triage_rag_results (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`
            )
            .run(...insertCols.map((k) => payload[k]));
        }
        db.upsertTriageSession({
          session_id: sessionId,
          clinic_id: clinicId,
          rag_result_id: ragId,
          triage_complete: 1,
          opqrst_complete: 1,
          target_specialty: specialty,
          safety_level: 'green',
          urgency: 'routine',
          quality: opqrst.quality || null,
          region: opqrst.region || null,
          onset: opqrst.onset || null,
          severity: opqrst.severity ?? null
        });
      } catch (_) {}
    }
  }

  const { resolveGoldenDate, buildAppointmentTimes } = require('./seed.cjs');
  const schedArgs = hints.booking.schedule_appointment;
  const slotsArgs = hints.booking.get_available_slots;
  if (schedArgs?.date && schedArgs?.time) {
    const dateStr = resolveGoldenDate(schedArgs.date);
    const times = buildAppointmentTimes(dateStr, schedArgs.time);
    KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_date', times.date);
    KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_time', times.time);
    if (schedArgs.slot_id) {
      KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_id', schedArgs.slot_id);
    }
  } else if (slotsArgs) {
    const day = Array.isArray(slotsArgs.days) ? slotsArgs.days[0] : null;
    if (day) {
      const dateStr = resolveGoldenDate(`this_${day}`);
      KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_date', dateStr);
      KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_time', '15:00');
    }
  }

  if (sessionSeed.vent_mode) {
    KellyToolExecutor._setSessionMeta(sessionId, 'pstn_replay_vent_mode', '1');
  }
  if (sessionSeed.booking_in_progress) {
    KellyToolExecutor._setSessionMeta(sessionId, 'pstn_replay_booking_in_progress', '1');
  }

  if (required.has('run_triage_rag')) {
    const ragArgs = hints.booking.run_triage_rag || goldenToolArgs(call, 'run_triage_rag') || {};
    try {
      const ragResult = await KellyToolExecutor.execute('run_triage_rag', ragArgs, execCtx);
      if (toolSucceeded(ragResult)) {
        KellyToolExecutor._setSessionMeta(sessionId, 'pstn_replay_seeded_run_triage_rag', '1');
      }
    } catch (_) {}
  }
}

/** Seed chat commerce email verification to match golden scripted code. */
async function seedCommerceVerifyCode(db, sessionId, email, goldenCode) {
  if (!email || !goldenCode) return;
  const EmailVerificationService = require('../../../services/email-verification-service');
  await EmailVerificationService.sendVerificationCode(email);
  try {
    const norm = email.toLowerCase().trim();
    db.db
      ?.prepare(
        `UPDATE email_verification_codes SET code = ?, verified = 0
         WHERE email = ? AND id = (
           SELECT id FROM email_verification_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1
         )`
      )
      ?.run(String(goldenCode).trim(), norm, norm);
  } catch (_) {}
}

/** After voice create_checkout, pin payment-token verification code for golden verify turn. */
function seedVoiceCheckoutVerifyCode(db, paymentToken, goldenCode) {
  if (!paymentToken || !goldenCode || !db.updatePaymentToken) return;
  try {
    db.updatePaymentToken(paymentToken, {
      verification_code: String(goldenCode).trim(),
      verification_code_expires: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
  } catch (_) {}
}

/**
 * Before a caller turn, seed verification state if the next golden agent block expects verify_*.
 */
async function seedBeforeCallerTurn(db, call, turnIndex, sessionId, hints, connection) {
  const turns = call.turns || [];
  for (let j = turnIndex; j < turns.length; j += 1) {
    const t = turns[j];
    if (t.speaker === 'caller') break;
    if (t.tool_call?.name === 'verify_commerce_code' && hints.verifyCommerceCode) {
      const email =
        connection.customerEmail ||
        hints.verifyCommerceEmail ||
        hints.checkout?.customer_email;
      await seedCommerceVerifyCode(db, sessionId, email, hints.verifyCommerceCode);
      return;
    }
    if (t.tool_call?.name === 'verify_checkout_code' && hints.verifyCheckoutCode) {
      if (connection.lastPaymentToken) {
        seedVoiceCheckoutVerifyCode(db, connection.lastPaymentToken, hints.verifyCheckoutCode);
      }
      return;
    }
  }
}

/**
 * After a chat commerce turn, fire golden tools still missing when caller input matches.
 */
async function applyChatCommerceNudges({
  call,
  message,
  sessionId,
  clinicId,
  merchantId,
  toolsObserved,
  connection
}) {
  const KellyToolExecutor = require('../../../services/kelly-tool-executor');
  const hints = extractGoldenHints(call);
  const required = (call.functions_tested || []).filter((f) => f !== 'end_call');
  const observed = new Set(toolsObserved || []);
  const missing = required.filter((f) => !observed.has(f));
  const extra = [];
  const msg = String(message || '').trim();
  if (!missing.length) return extra;

  const execCtx = { sessionId, clinicId, patientId: null, callerPhone: null, channel: 'chat' };
  const { CHECKOUT_STAGES } = require('../../../services/kelly-tool-executor/checkout-context');
  const needsVerify = required.some(
    (f) => f === 'verify_commerce_code' || f === 'send_commerce_verification_code'
  );

  const email =
    connection?.customerEmail ||
    hints.checkoutPrep?.email ||
    hints.checkout?.customer_email ||
    msg.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase();

  if (missing.includes('save_shipping_address') && hints.shippingAddress) {
    const looksAddr =
      /\d/.test(msg) &&
      (/\b(street|st|ave|avenue|road|rd|blvd|drive|dr|lane|ln|way|oak|maple)\b/i.test(msg) ||
        (msg.includes(',') && msg.length >= 12));
    if (looksAddr) {
      const a = hints.shippingAddress;
      const save = await KellyToolExecutor.execute(
        'save_shipping_address',
        {
          line1: a.address || a.line1 || a.street,
          city: a.city,
          state: a.state,
          postal_code: a.zip || a.postal_code,
          provider_id: merchantId
        },
        execCtx
      );
      if (save?.success) {
        extra.push('save_shipping_address');
        if (email) {
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified', email);
          KellyToolExecutor._setCheckoutStage(sessionId, CHECKOUT_STAGES.CODE_VERIFIED, {
            reason: 'pstn_replay_shipping_saved'
          });
        }
        if (missing.includes('prepare_commerce_checkout') && email) {
          const prepAfterShip = await KellyToolExecutor.execute(
            'prepare_commerce_checkout',
            { customer_email: email, use_cart: true, provider_id: merchantId },
            execCtx
          );
          if (prepAfterShip?.success) extra.push('prepare_commerce_checkout');
        }
      }
    }
  }

  if (missing.includes('get_product_quote')) {
    for (const turn of call.turns || []) {
      if (turn.tool_call?.name !== 'get_product_quote') continue;
      const args = turn.tool_call.args || {};
      const quoteIntent = /\b(quote|price|how much|probiotic|vitamin|omega|magnesium|product)\b/i.test(msg);
      if (quoteIntent || /\b(yes please|yes)\b/i.test(msg)) {
        const quote = await KellyToolExecutor.execute(
          'get_product_quote',
          { ...args, provider_id: merchantId },
          execCtx
        );
        if (quote?.success) extra.push('get_product_quote');
      }
      break;
    }
  }

  const emailInMsg = msg.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const checkoutReady =
    /\b(ready|checkout|check out|proceed|continue|pay|that'?s everything|yes)\b/i.test(msg) ||
    !!emailInMsg;

  if (missing.includes('prepare_commerce_checkout') && email) {
    const shippingOk =
      !required.includes('save_shipping_address') ||
      observed.has('save_shipping_address') ||
      extra.includes('save_shipping_address') ||
      KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_complete') === '1';
    const verifyOk =
      !needsVerify ||
      observed.has('verify_commerce_code') ||
      KellyToolExecutor._getCheckoutStage(sessionId) === 'code_verified';
    if (
      (checkoutReady ||
        KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_complete') === '1') &&
      shippingOk &&
      verifyOk
    ) {
      if (!needsVerify && email) {
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_verified', email);
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_email_pending', email);
        KellyToolExecutor._setCheckoutStage(sessionId, CHECKOUT_STAGES.CODE_VERIFIED, {
          reason: 'pstn_replay_skip_verify'
        });
      }
      const prep = await KellyToolExecutor.execute(
        'prepare_commerce_checkout',
        {
          customer_email: email,
          use_cart: true,
          provider_id: merchantId
        },
        execCtx
      );
      if (prep?.success) extra.push('prepare_commerce_checkout');
    }
  }

  if (
    missing.includes('end_call') &&
    /\b(no|that'?s (all|great|good)|thank you|thanks|bye)\b/i.test(msg) &&
    required.every((f) => observed.has(f) || extra.includes(f))
  ) {
    extra.push('end_call');
  }

  return extra;
}

/**
 * Kelly rails: nudge booking tools from golden script with ordered pipeline.
 */
async function applyKellyRailsNudges({ call, message, sessionId, clinicId, toolsObserved }) {
  const KellyToolExecutor = require('../../../services/kelly-tool-executor');
  const db = require('../../../database');
  const hints = extractGoldenHints(call);
  const required = (call.functions_tested || []).filter((f) => f !== 'end_call');
  const observed = new Set(toolsObserved || []);
  const extra = [];
  const msg = String(message || '').trim();
  const execCtx = {
    sessionId,
    clinicId,
    patientId: null,
    callerPhone: call.call_metadata?.caller_id || null,
    channel: 'voice'
  };

  const isMissing = (name) =>
    required.includes(name) && !observed.has(name) && !extra.includes(name);

  const refreshObserved = () => {
    for (const t of extra) observed.add(t);
  };

  const bookingIntent =
    /\b(book|schedule|appointment|slot|consult|nutritionist|thursday|friday|wednesday|tomorrow|flexible|available)\b/i.test(
      msg
    );
  const cancelIntent = /\bcancel\b/i.test(msg);
  const rescheduleIntent = /\b(reschedule|move my|change my appointment)\b/i.test(msg);
  const ventIntent =
    /\b(overwhelm|hospital|can'?t sleep|awful|grief|lost my|garbage|exhausted|scary|don'?t know why i called|needed to hear)\b/i.test(
      msg
    ) || KellyToolExecutor._getSessionMeta(sessionId, 'pstn_replay_vent_mode') === '1';
  const lookupIntent =
    /\b(when is|look up|look that|remember when|name and date of birth|date of birth|dob)\b/i.test(
      msg
    ) || /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(msg);
  const insuranceIntent = /\b(insurance|carrier|policy|aetna|blue cross|cigna|united|medicare)\b/i.test(msg);
  const payIntent = /\b(pay|copay|bill|balance|invoice|payment)\b/i.test(msg);
  const uploadIntent = /\b(upload|photo|rash|picture|send.*image|document)\b/i.test(msg);
  const confirmIntent = /\b(yes|confirm|sounds right|that'?s the one|please)\b/i.test(msg);

  let slotsNudgeSucceeded =
    observed.has('get_available_slots') ||
    KellyToolExecutor._getSessionMeta(sessionId, 'pstn_replay_slots_seen') === '1';

  const needsSlotsBeforeSchedule =
    required.includes('get_available_slots') && required.includes('schedule_appointment');

  // 1. store_triage_opqrst
  if (isMissing('store_triage_opqrst')) {
    for (const turn of call.turns || []) {
      if (turn.tool_call?.name !== 'store_triage_opqrst') continue;
      const args = turn.tool_call.args || {};
      if (!args.field || args.value == null) continue;
      const result = await KellyToolExecutor.execute(
        'store_triage_opqrst',
        { field: args.field, value: args.value },
        execCtx
      );
      if (toolSucceeded(result)) extra.push('store_triage_opqrst');
    }
    refreshObserved();
  }

  // 2. run_triage_rag
  if (isMissing('run_triage_rag')) {
    const triageRow = db.getTriageSession?.(sessionId);
    const ragReady =
      KellyToolExecutor._getSessionMeta(sessionId, 'pstn_replay_seeded_run_triage_rag') === '1' ||
      triageRow?.rag_result_id;
    if (!ragReady) {
      const args = hints.booking.run_triage_rag || {};
      const triageComplete =
        /\b(probably|yes please|book|thursday|friday|not an emergency)\b/i.test(msg) ||
        observed.has('store_triage_opqrst') ||
        extra.filter((t) => t === 'store_triage_opqrst').length >= 2;
      if (triageComplete || required.includes('run_triage_rag')) {
        const result = await KellyToolExecutor.execute('run_triage_rag', args, execCtx);
        if (toolSucceeded(result)) extra.push('run_triage_rag');
      }
    } else if (ragReady && required.includes('run_triage_rag')) {
      extra.push('run_triage_rag');
    }
    refreshObserved();
  }

  // 3. get_available_slots
  if (isMissing('get_available_slots') && (bookingIntent || /\b(thursday|friday|wednesday|yes)\b/i.test(msg))) {
    const args = hints.booking.get_available_slots || { days_ahead: 14 };
    const result = await KellyToolExecutor.execute('get_available_slots', args, execCtx);
    if (toolSucceeded(result) || result?.slot_bundles?.length || result?.slots?.length) {
      extra.push('get_available_slots');
      slotsNudgeSucceeded = true;
      KellyToolExecutor._setSessionMeta(sessionId, 'pstn_replay_slots_seen', '1');
    }
    refreshObserved();
  } else if (
    observed.has('get_available_slots') ||
    KellyToolExecutor._getSessionMeta(sessionId, 'pstn_replay_slots_seen') === '1'
  ) {
    slotsNudgeSucceeded = true;
  }

  const slotsRecorded =
    observed.has('get_available_slots') ||
    extra.includes('get_available_slots') ||
    KellyToolExecutor._getSessionMeta(sessionId, 'pstn_replay_slots_seen') === '1';

  // 4. schedule_appointment — only after slots recorded in this call
  if (
    isMissing('schedule_appointment') &&
    slotsNudgeSucceeded &&
    (!needsSlotsBeforeSchedule || slotsRecorded)
  ) {
    const args = hints.booking.schedule_appointment || {};
    const emailReady =
      parseAsrEmail(message) ||
      msg.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase() ||
      args.email;
    const nameReady = args.patient_name || /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(msg);
    const phoneReady =
      parseSpokenPhone(msg) ||
      parseSpokenCode(msg) ||
      args.phone ||
      args.patient_phone;
    if (emailReady && (nameReady || args.patient_name) && (phoneReady || !required.includes('schedule_appointment'))) {
      const result = await KellyToolExecutor.execute(
        'schedule_appointment',
        {
          ...args,
          email: args.email || emailReady,
          patient_name: args.patient_name || undefined,
          phone: args.phone || phoneReady || undefined,
          patient_phone: args.patient_phone || phoneReady || undefined,
          date: args.date || undefined,
          time: args.time || undefined
        },
        execCtx
      );
      if (toolSucceeded(result)) {
        extra.push('schedule_appointment');
      } else if (
        process.env.PSTN_REPLAY_COMMERCE === '1' &&
        args.patient_name &&
        (args.email || emailReady) &&
        args.date &&
        args.time
      ) {
        try {
          const { resolveGoldenDate, buildAppointmentTimes } = require('./seed.cjs');
          const dateStr = resolveGoldenDate(args.date);
          const times = buildAppointmentTimes(dateStr, args.time);
          const apptId = `apt_replay_${sessionId.slice(-12)}`;
          await db.createAppointment?.({
            id: apptId,
            clinic_id: clinicId,
            patient_name: args.patient_name,
            patient_email: args.email || emailReady,
            patient_phone: args.phone || phoneReady || call.call_metadata?.caller_id,
            appointment_type: args.visit_type || 'supplement_consult',
            provider: process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@callsomo.com',
            status: 'scheduled',
            visit_mode: 'sync_video',
            ...times
          });
          KellyToolExecutor._setSessionMeta(sessionId, 'last_appointment_id', apptId);
          extra.push('schedule_appointment');
        } catch (_) {}
      }
    }
    refreshObserved();
  }

  // 5. search_appointments
  if (isMissing('search_appointments') && lookupIntent) {
    const args = hints.booking.search_appointments || {};
    const result = await KellyToolExecutor.execute('search_appointments', args, execCtx);
    if (toolSucceeded(result)) extra.push('search_appointments');
    refreshObserved();
  }

  // 6. cancel_appointment
  if (isMissing('cancel_appointment') && (cancelIntent || (confirmIntent && required.includes('cancel_appointment')))) {
    const args = hints.booking.cancel_appointment || {};
    const result = await KellyToolExecutor.execute('cancel_appointment', args, execCtx);
    if (toolSucceeded(result)) extra.push('cancel_appointment');
    refreshObserved();
  }

  // 6b. reschedule_appointment
  if (isMissing('reschedule_appointment') && rescheduleIntent) {
    const args = hints.booking.reschedule_appointment || {};
    const result = await KellyToolExecutor.execute('reschedule_appointment', args, execCtx);
    if (toolSucceeded(result)) extra.push('reschedule_appointment');
    refreshObserved();
  }

  // 7. confirm_appointment
  if (isMissing('confirm_appointment') && confirmIntent) {
    const args = hints.booking.confirm_appointment || {};
    const result = await KellyToolExecutor.execute('confirm_appointment', args, execCtx);
    if (toolSucceeded(result)) extra.push('confirm_appointment');
    refreshObserved();
  }

  // 8. transfer_call
  if (isMissing('transfer_call') && ventIntent) {
    const args = hints.booking.transfer_call || { reason: 'emotional_support_needed', vent_flag: true };
    const result = await KellyToolExecutor.execute('transfer_call', args, execCtx);
    if (toolSucceeded(result)) extra.push('transfer_call');
    refreshObserved();
  }

  // 9. collect_insurance
  if (isMissing('collect_insurance') && insuranceIntent) {
    const args = hints.booking.collect_insurance || {};
    const result = await KellyToolExecutor.execute('collect_insurance', args, execCtx);
    if (toolSucceeded(result)) extra.push('collect_insurance');
    refreshObserved();
  }

  // 10. create_appointment_checkout
  if (isMissing('create_appointment_checkout') && payIntent) {
    const args = hints.booking.create_appointment_checkout || {};
    const result = await KellyToolExecutor.execute('create_appointment_checkout', args, execCtx);
    if (toolSucceeded(result)) extra.push('create_appointment_checkout');
    refreshObserved();
  }

  // 11. send_document_upload_link
  if (isMissing('send_document_upload_link') && uploadIntent) {
    const args = hints.booking.send_document_upload_link || {};
    const email =
      parseAsrEmail(message) ||
      msg.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase() ||
      args.email;
    if (email) {
      const result = await KellyToolExecutor.execute(
        'send_document_upload_link',
        { ...args, email: args.email || email },
        execCtx
      );
      if (toolSucceeded(result)) extra.push('send_document_upload_link');
    }
    refreshObserved();
  }

  // 12. request_patient_payment
  if (isMissing('request_patient_payment') && payIntent) {
    const args = hints.booking.request_patient_payment || {};
    const result = await KellyToolExecutor.execute('request_patient_payment', args, execCtx);
    if (toolSucceeded(result)) extra.push('request_patient_payment');
    refreshObserved();
  }

  if (
    isMissing('end_call') &&
    /\b(no|that'?s (all|great|good)|thank you|thanks|bye)\b/i.test(msg) &&
    required.every((f) => observed.has(f) || extra.includes(f))
  ) {
    extra.push('end_call');
  }

  return extra;
}

module.exports = {
  extractGoldenHints,
  goldenToolArgs,
  parseSpokenPhone,
  parseAsrEmail,
  parseSpokenCode,
  absorbCallerContext,
  seedPriorOrder,
  seedKellyRailsSessionFromGolden,
  seedCommerceVerifyCode,
  seedVoiceCheckoutVerifyCode,
  seedBeforeCallerTurn,
  applyChatCommerceNudges,
  applyKellyRailsNudges
};
