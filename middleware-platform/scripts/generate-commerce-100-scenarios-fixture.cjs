#!/usr/bin/env node
/**
 * One-time fixture author for commerce-voice-100-scenarios.json.
 * Not the test runner — see docs/testing/COMMERCE_100_SCENARIO_RUNNER_SPEC.md
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MERCHANT = 'merchant_c3d547a10f43eeec';
const CLINIC = 'clinic-default';

const SPEECH_DEFAULT = {
  max_wer: 0.15,
  max_eot_latency_ms: 800,
  min_confidence: 0.75,
  max_assistant_latency_ms: 2500,
  max_rtf: 1.0
};

const SPEECH_NOISY = { ...SPEECH_DEFAULT, max_eot_latency_ms: 1200, min_confidence: 0.65 };

function user(text, opts = {}) {
  return { role: 'user', text, asr_noise: opts.asr_noise || 'clean', locale: opts.locale || 'en' };
}

function agent(expect) {
  return { role: 'agent', expect };
}

function tool(name, opts = {}) {
  return { name, required: opts.required !== false, before: opts.before || null, args: opts.args || {} };
}

function state(store, key, final, opts = {}) {
  return { store, key, final, ...opts };
}

function scenario(def) {
  const base = {
    assertions: def.assertions || [],
    failure_codes: def.failure_codes || [],
    predicted_failure_refs: def.predicted_failure_refs || [],
    priority: def.priority || 'P1',
    tags: def.tags || []
  };
  if (!def.speech_metrics && def.channel !== 'chat_ui') {
    base.speech_metrics =
      def.asr_noise === 'noisy' ? { ...SPEECH_NOISY } : { ...SPEECH_DEFAULT };
  }
  if (def.speech_metrics) base.speech_metrics = def.speech_metrics;
  return {
    id: def.id,
    title: def.title,
    channel: def.channel,
    category: def.category,
    preconditions: {
      merchant_id: MERCHANT,
      clinic_id: CLINIC,
      products: def.products || [],
      session_seed: def.session_seed || {},
      ...def.preconditions
    },
    transcript: def.transcript || [],
    tool_expectations: def.tool_expectations || [],
    state_assertions: def.state_assertions || [],
    ui_assertions: def.ui_assertions || [],
    skip_reason: def.skip_reason || null,
    ...base
  };
}

const SCENARIOS = [
  // A. Commerce purchase (18)
  scenario({
    id: 'C-001',
    title: 'Single SKU Vitamin D3: education → quote → email verify → ship → pay',
    channel: 'chat',
    category: 'commerce_purchase',
    products: ['sku_vitd3_2000'],
    priority: 'P0',
    transcript: [
      user("Hi, I'm interested in vitamin D for bone health"),
      agent({ contains_acknowledgement: true, max_words: 40 }),
      user('How much is it?'),
      agent({ must_not_state_price_from_memory: true }),
      user("Okay I'd like to buy one"),
      agent({ asks_one_question: true }),
      user('My email is buyer001@example.com'),
      agent({ collects_shipping: true }),
      user('123 Main St, Boston MA 02101'),
      agent({ confirms_address: true }),
      user("Yes that's correct")
    ],
    tool_expectations: [
      tool('get_product_quote', { args: { product_id: 'sku_vitd3_2000' } }),
      tool('send_commerce_verification_code'),
      tool('verify_commerce_code'),
      tool('save_shipping_address'),
      tool('prepare_commerce_checkout', { before: 'get_product_quote' })
    ],
    state_assertions: [
      state('meta_kv', 'checkout_stage', 'checkout_prepared'),
      state('meta_kv', 'commerce_email_verified', '1'),
      state('kelly_call_events', 'event_type', 'tool_completed', { tool: 'prepare_commerce_checkout' })
    ],
    assertions: ['ACK_BEFORE_TRANSACTION', 'CHAT_COMMERCE_TOOL_CHAIN', 'CHECKOUT_STAGE_FSM', 'TOOL_COMPLETED_BEFORE_CLAIM'],
    failure_codes: ['COMMERCE_NO_ACK', 'CHECKOUT_STAGE_REGRESSION', 'PRICE_FROM_MEMORY']
  }),
  scenario({
    id: 'C-002',
    title: 'Browse 3 supplements, add 2 to cart, checkout',
    channel: 'chat',
    category: 'commerce_purchase',
    products: ['sku_vitd3_2000', 'sku_omega3_1000', 'sku_magnesium_gly'],
    priority: 'P0',
    transcript: [
      user('What do you have for sleep and heart health?'),
      agent({ offers_browse_not_push: true }),
      user('Add magnesium and omega 3 to my cart'),
      agent({ confirms_cart: true }),
      user("I'm ready to checkout"),
      agent({ asks_email: true }),
      user('cart002@example.com')
    ],
    tool_expectations: [
      tool('add_to_cart', { args: { product_id: 'sku_magnesium_gly' } }),
      tool('add_to_cart', { args: { product_id: 'sku_omega3_1000' } }),
      tool('get_cart'),
      tool('prepare_commerce_checkout')
    ],
    state_assertions: [state('commerce_carts', 'line_count', 2)],
    assertions: ['CHAT_COMMERCE_TOOL_CHAIN', 'CART_LINE_ITEMS']
  }),
  scenario({
    id: 'C-003',
    title: 'Quantity 2 Omega-3; total matches DB',
    channel: 'chat',
    category: 'commerce_purchase',
    products: ['sku_omega3_1000'],
    priority: 'P0',
    transcript: [
      user('I want two bottles of omega 3 fish oil'),
      agent({ contains_acknowledgement: true }),
      user('cart003@example.com'),
      agent({ states_server_locked_total: true })
    ],
    tool_expectations: [
      tool('get_product_quote', { args: { product_id: 'sku_omega3_1000', quantity: 2 } }),
      tool('prepare_commerce_checkout')
    ],
    state_assertions: [
      state('checkout_sessions', 'amount_cents', 6500, { note: '32.50 * 2 * 100' })
    ],
    assertions: ['CHAT_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-004',
    title: 'Voice: I want vitamin D → search → create_checkout → SMS link',
    channel: 'voice',
    category: 'commerce_purchase',
    products: ['sku_vitd3_2000'],
    priority: 'P0',
    predicted_failure_refs: ['F-02'],
    transcript: [
      user('I want to buy vitamin D'),
      agent({ contains_acknowledgement: true, max_words: 25 }),
      user('Yes the 2000 IU one'),
      agent({ asks_email: true }),
      user('voice004@example.com'),
      agent({ confirms_checkout_link_sent: true })
    ],
    tool_expectations: [
      tool('search_products', { args: { query: 'vitamin d' } }),
      tool('create_checkout', { before: 'search_products' })
    ],
    state_assertions: [
      state('kelly_call_events', 'event_type', 'tool_completed', { tool: 'create_checkout' })
    ],
    assertions: ['VOICE_COMMERCE_TOOL_CHAIN', 'ACK_BEFORE_TRANSACTION', 'TOOL_COMPLETED_BEFORE_CLAIM'],
    failure_codes: ['VOICE_TOOL_MANIFEST_GAP', 'COMMERCE_NO_ACK']
  }),
  scenario({
    id: 'C-005',
    title: 'Voice: caller spells email; verify code path',
    channel: 'voice',
    category: 'commerce_purchase',
    products: ['sku_magnesium_gly'],
    transcript: [
      user("I'd like magnesium glycinate"),
      agent({ asks_email: true }),
      user('j-a-n-e dot d-o-e at example dot com'),
      agent({ reads_back_email: true }),
      user("Yes that's right"),
      agent({ mentions_verification_code: true }),
      user('The code is 482910')
    ],
    tool_expectations: [tool('search_products'), tool('create_checkout')],
    assertions: ['VOICE_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-006',
    title: 'Voice vs chat price parity for same SKU',
    channel: 'both',
    category: 'commerce_purchase',
    products: ['sku_vitd3_2000'],
    priority: 'P0',
    predicted_failure_refs: ['F-01'],
    transcript: [
      user('How much is vitamin D3 2000 IU?'),
      agent({ must_use_tool_for_price: true })
    ],
    tool_expectations: [
      tool('get_product_quote', { args: { product_id: 'sku_vitd3_2000' } }),
      tool('search_products', { args: { query: 'vitamin d3' } }),
      tool('create_checkout')
    ],
    state_assertions: [
      state('parity', 'amount_cents_voice', 2499),
      state('parity', 'amount_cents_chat', 2499)
    ],
    assertions: ['PRICE_PARITY_VOICE_CHAT'],
    failure_codes: ['PRICE_PARITY_MISMATCH']
  }),
  scenario({
    id: 'C-007',
    title: 'Switch product mid-conversation: cart clear + new quote',
    channel: 'chat',
    category: 'commerce_purchase',
    products: ['sku_vitd3_2000', 'sku_probiotic_50b'],
    transcript: [
      user('Add vitamin D to cart'),
      agent({ confirms_add: true }),
      user('Actually I want probiotics instead'),
      agent({ handles_switch: true }),
      user('Yes clear the vitamin D')
    ],
    tool_expectations: [
      tool('add_to_cart'),
      tool('clear_cart'),
      tool('get_product_quote', { args: { product_id: 'sku_probiotic_50b' } })
    ],
    assertions: ['CHAT_COMMERCE_TOOL_CHAIN', 'CART_LINE_ITEMS']
  }),
  scenario({
    id: 'C-008',
    title: "Voice: What's good for energy → search → recommend → buy",
    channel: 'voice',
    category: 'commerce_purchase',
    products: ['sku_multivit_daily', 'sku_iron_chelate'],
    transcript: [
      user("What's good for energy?"),
      agent({ contains_acknowledgement: true, offers_options: true }),
      user('The multivitamin sounds good'),
      agent({ asks_email: true }),
      user('energy008@example.com')
    ],
    tool_expectations: [tool('search_products', { args: { query: 'energy' } }), tool('create_checkout')],
    assertions: ['ACK_BEFORE_TRANSACTION', 'VOICE_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-009',
    title: 'Chat: Multivitamin + Probiotic bundle (2 line items)',
    channel: 'chat',
    category: 'commerce_purchase',
    products: ['sku_multivit_daily', 'sku_probiotic_50b'],
    transcript: [
      user('I want the daily multivitamin and probiotic'),
      agent({ confirms_two_items: true }),
      user('checkout009@example.com')
    ],
    tool_expectations: [
      tool('add_to_cart', { args: { product_id: 'sku_multivit_daily' } }),
      tool('add_to_cart', { args: { product_id: 'sku_probiotic_50b' } }),
      tool('prepare_commerce_checkout')
    ],
    state_assertions: [state('commerce_carts', 'line_count', 2)],
    assertions: ['CART_LINE_ITEMS', 'CHAT_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-010',
    title: 'After-hours voice commerce: no we are closed',
    channel: 'voice',
    category: 'commerce_purchase',
    products: ['sku_vitd3_2000'],
    preconditions: { after_hours: true },
    transcript: [
      user('Are you open? I want to order vitamin D'),
      agent({ must_not_say_closed_for_commerce: true }),
      user("Great, let's order it")
    ],
    tool_expectations: [tool('search_products'), tool('create_checkout')],
    assertions: ['VOICE_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-011',
    title: 'Returning patient: cart restored on session resume',
    channel: 'chat',
    category: 'commerce_purchase',
    products: ['sku_omega3_1000'],
    session_seed: { cart_session_id: 'cart_resume_011', items: [{ product_id: 'sku_omega3_1000', quantity: 1 }] },
    transcript: [
      user("I'm back — still want to finish my order"),
      agent({ acknowledges_resume: true }),
      user('checkout011@example.com')
    ],
    tool_expectations: [tool('get_cart'), tool('prepare_commerce_checkout')],
    assertions: ['CHAT_COMMERCE_TOOL_CHAIN', 'CART_LINE_ITEMS']
  }),
  scenario({
    id: 'C-012',
    title: 'Voice Mastercard commerce with mandate_id',
    channel: 'voice',
    category: 'commerce_purchase',
    products: ['sku_vitd3_2000'],
    predicted_failure_refs: ['F-02'],
    transcript: [
      user('Buy vitamin D with my Mastercard on file'),
      agent({ asks_email: true }),
      user('mc012@example.com')
    ],
    tool_expectations: [
      tool('create_checkout', { args: { payment_method: 'mastercard', mandate_id: 'mandate_test_012' } })
    ],
    assertions: ['VOICE_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-013',
    title: 'Chat: payment poll until payment_confirmed',
    channel: 'chat',
    category: 'commerce_purchase',
    products: ['sku_magnesium_gly'],
    priority: 'P0',
    predicted_failure_refs: ['F-10'],
    transcript: [
      user('Ready to pay for magnesium'),
      agent({ offers_pay_in_thread: true }),
      user('[user completes Stripe PI in UI]')
    ],
    state_assertions: [
      state('meta_kv', 'checkout_stage', 'payment_confirmed'),
      state('meta_kv', 'checkout_stage_meta_reason', null, { when_failed: 'must_surface_in_ui' })
    ],
    assertions: ['CHECKOUT_STAGE_FSM', 'FRONTEND_STRIPE_PAY'],
    failure_codes: ['CHECKOUT_FAILED_UI_SILENT']
  }),
  scenario({
    id: 'C-014',
    title: 'Voice: wrong email code once then success',
    channel: 'voice',
    category: 'commerce_purchase',
    products: ['sku_probiotic_50b'],
    transcript: [
      user('Order probiotic please'),
      user('prob014@example.com'),
      user('Wrong code 111111'),
      agent({ reprompts_code: true }),
      user('Correct code 482910')
    ],
    tool_expectations: [tool('create_checkout')],
    assertions: ['VOICE_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-015',
    title: 'Chat: shipping address confirm before prepare_commerce_checkout',
    channel: 'chat',
    category: 'commerce_purchase',
    products: ['sku_vitd3_2000'],
    priority: 'P0',
    transcript: [
      user('Buy vitamin D'),
      user('ship015@example.com'),
      user('456 Oak Ave, Austin TX 78701'),
      agent({ reads_back_address: true }),
      user('Yes confirm')
    ],
    tool_expectations: [
      tool('save_shipping_address', { before: 'prepare_commerce_checkout' }),
      tool('prepare_commerce_checkout')
    ],
    assertions: ['CHAT_COMMERCE_TOOL_CHAIN', 'CHECKOUT_STAGE_FSM']
  }),
  scenario({
    id: 'C-016',
    title: 'Voice: low inventory SKU graceful message',
    channel: 'voice',
    category: 'commerce_purchase',
    products: ['sku_low_stock_demo'],
    transcript: [
      user('I want 5 B-complex bottles'),
      agent({ explains_inventory_limit: true }),
      user("Okay I'll take 2")
    ],
    tool_expectations: [tool('search_products'), tool('create_checkout', { args: { quantity: 2 } })],
    assertions: ['VOICE_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-017',
    title: 'Chat: stale client price rejected with 409',
    channel: 'chat',
    category: 'commerce_purchase',
    products: ['sku_vitd3_2000'],
    priority: 'P0',
    transcript: [
      user('[client sends checkout with stale quote amount]')
    ],
    state_assertions: [state('http', 'status', 409, { error: 'quote_stale' })],
    assertions: ['CHAT_COMMERCE_TOOL_CHAIN'],
    failure_codes: ['QUOTE_STALE_NOT_HANDLED']
  }),
  scenario({
    id: 'C-018',
    title: 'Voice: order tracking after purchase',
    channel: 'voice',
    category: 'commerce_purchase',
    products: ['sku_omega3_1000'],
    session_seed: { prior_order_id: 'ord_test_018' },
    transcript: [
      user('Where is my omega 3 order?'),
      agent({ provides_status_or_honest_unknown: true })
    ],
    tool_expectations: [tool('get_order_tracking')],
    assertions: ['VOICE_COMMERCE_TOOL_CHAIN']
  }),

  // B. Commerce complaint (12)
  scenario({
    id: 'C-019',
    title: 'Voice: cancel supplement order before ship',
    channel: 'voice',
    category: 'commerce_complaint',
    predicted_failure_refs: ['F-07'],
    transcript: [
      user('Cancel my supplement order from yesterday'),
      agent({ empathy_then_policy: true, offers_handoff: true })
    ],
    assertions: ['ACK_BEFORE_TRANSACTION', 'VENT_HANDOFF'],
    failure_codes: ['NO_CANCEL_ORDER_TOOL']
  }),
  scenario({
    id: 'C-020',
    title: 'Chat: abandon cart mid-checkout; stage resets',
    channel: 'chat',
    category: 'commerce_complaint',
    products: ['sku_vitd3_2000'],
    transcript: [
      user('Start checkout'),
      user('[user closes tab mid code_sent]'),
      user('[user returns 30 min later]')
    ],
    state_assertions: [
      state('meta_kv', 'checkout_stage', 'collecting_details', { after_abandon: true })
    ],
    assertions: ['CHECKOUT_STAGE_FSM']
  }),
  scenario({
    id: 'C-021',
    title: 'Voice: charged twice → handoff, no refund promise',
    channel: 'voice',
    category: 'commerce_complaint',
    predicted_failure_refs: ['F-07'],
    transcript: [
      user('I was charged twice for the same order!'),
      agent({ contains_acknowledgement: true, offers_handoff: true, must_not_promise_refund: true })
    ],
    assertions: ['ACK_BEFORE_TRANSACTION', 'VENT_HANDOFF', 'NO_BOT_THERAPY'],
    failure_codes: ['REFUND_PROMISED', 'HANDOFF_NOT_TRIGGERED']
  }),
  scenario({
    id: 'C-022',
    title: 'Chat: wrong product delivered → empathy + handoff',
    channel: 'chat',
    category: 'commerce_complaint',
    predicted_failure_refs: ['F-07'],
    transcript: [
      user('You sent me the wrong supplement'),
      agent({ contains_acknowledgement: true, offers_handoff: true })
    ],
    assertions: ['ACK_BEFORE_TRANSACTION', 'VENT_HANDOFF']
  }),
  scenario({
    id: 'C-023',
    title: 'Voice: return probiotics → policy + handoff',
    channel: 'voice',
    category: 'commerce_complaint',
    transcript: [
      user('I need to return the probiotics'),
      agent({ explains_return_policy: true, offers_handoff: true })
    ],
    assertions: ['ACK_BEFORE_TRANSACTION', 'VENT_HANDOFF']
  }),
  scenario({
    id: 'C-024',
    title: 'Chat: dispute charge after payment_confirmed',
    channel: 'chat',
    category: 'commerce_complaint',
    session_seed: { checkout_stage: 'payment_confirmed' },
    transcript: [
      user('I want to dispute this charge'),
      agent({ offers_handoff: true, must_not_void_payment: true })
    ],
    assertions: ['VENT_HANDOFF']
  }),
  scenario({
    id: 'C-025',
    title: 'Voice: angry — product caused rash → ack + handoff',
    channel: 'voice',
    category: 'commerce_complaint',
    transcript: [
      user('Your vitamin gave me a rash! This is unacceptable!'),
      agent({ contains_acknowledgement: true, offers_handoff: true, must_not_diagnose: true })
    ],
    assertions: ['ACK_BEFORE_TRANSACTION', 'VENT_HANDOFF', 'NO_BOT_THERAPY']
  }),
  scenario({
    id: 'C-026',
    title: 'Chat: refund request while still in code_sent',
    channel: 'chat',
    category: 'commerce_complaint',
    session_seed: { checkout_stage: 'code_sent' },
    transcript: [user('I want a refund'), agent({ clarifies_not_paid_yet: true })],
    assertions: ['CHECKOUT_STAGE_FSM']
  }),
  scenario({
    id: 'C-027',
    title: 'Voice: stop calling me on outbound commerce follow-up',
    channel: 'voice',
    category: 'commerce_complaint',
    preconditions: { direction: 'outbound', call_type: 'operator_outbound' },
    transcript: [user('Stop calling me please'), agent({ records_opt_out: true })],
    assertions: ['OUTBOUND_DISPOSITION'],
    failure_codes: ['OPT_OUT_NOT_RECORDED']
  }),
  scenario({
    id: 'C-028',
    title: 'Chat: clear cart after complaint resolved',
    channel: 'chat',
    category: 'commerce_complaint',
    products: ['sku_magnesium_gly'],
    transcript: [
      user('Never mind, clear my cart'),
      agent({ confirms_clear: true })
    ],
    tool_expectations: [tool('clear_cart')],
    assertions: ['CART_LINE_ITEMS']
  }),
  scenario({
    id: 'C-029',
    title: 'Voice: track order — status unknown → honest reply',
    channel: 'voice',
    category: 'commerce_complaint',
    transcript: [
      user('Track order number XYZUNKNOWN'),
      agent({ honest_unknown: true, offers_handoff: true })
    ],
    tool_expectations: [tool('get_order_tracking')],
    assertions: ['VOICE_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-030',
    title: 'Chat: invalid merchant_id blocked',
    channel: 'chat',
    category: 'commerce_complaint',
    preconditions: { merchant_id: 'merchant_invalid_000' },
    priority: 'P0',
    transcript: [user('Checkout please')],
    state_assertions: [state('http', 'status', 400, { error: 'merchant_not_found' })],
    assertions: ['CHAT_COMMERCE_TOOL_CHAIN'],
    failure_codes: ['PAYMENT_SURFACE_EXPOSED']
  }),

  // C. Acknowledgement + vent (10)
  scenario({
    id: 'C-031',
    title: 'Voice: rough week ×3 vent turns → handoff before products',
    channel: 'voice',
    category: 'vent_handoff',
    priority: 'P0',
    predicted_failure_refs: ['F-03'],
    transcript: [
      user("It's been a really rough week at work"),
      agent({ contains_acknowledgement: true, must_not_pitch_product: true }),
      user("I can't sleep and everything feels overwhelming"),
      agent({ contains_acknowledgement: true, must_not_pitch_product: true }),
      user("I just needed to talk to someone"),
      agent({ offers_handoff: true, must_not_pitch_product: true })
    ],
    assertions: ['ACK_NOT_SCHEDULING_JUMP', 'VENT_HANDOFF', 'NO_BOT_THERAPY'],
    failure_codes: ['HANDOFF_NOT_TRIGGERED', 'PRODUCT_PITCH_ON_VENT']
  }),
  scenario({
    id: 'C-032',
    title: 'Chat: stressed parent vent → ack → gentle supplement offer',
    channel: 'chat',
    category: 'vent_handoff',
    predicted_failure_refs: ['F-03'],
    transcript: [
      user("I'm so stressed I can't even think straight as a parent"),
      agent({ contains_acknowledgement: true }),
      user('Maybe something for stress?'),
      agent({ gentle_offer_no_push: true })
    ],
    assertions: ['ACK_BEFORE_TRANSACTION', 'NO_BOT_THERAPY']
  }),
  scenario({
    id: 'C-033',
    title: 'Voice: grief vent → handoff within 2 turns',
    channel: 'voice',
    category: 'vent_handoff',
    predicted_failure_refs: ['F-03'],
    transcript: [
      user('I lost someone close to me recently'),
      agent({ contains_acknowledgement: true, offers_handoff: true, must_not_schedule: true })
    ],
    assertions: ['VENT_HANDOFF', 'ACK_NOT_SCHEDULING_JUMP']
  }),
  scenario({
    id: 'C-034',
    title: 'Voice: mixed vent + buy — ack stress THEN offer Vitamin D',
    channel: 'voice',
    category: 'vent_handoff',
    products: ['sku_vitd3_2000'],
    predicted_failure_refs: ['F-03', 'F-04'],
    transcript: [
      user("Stressful week — also I heard vitamin D might help"),
      agent({ contains_acknowledgement: true, then_commerce_ok: true }),
      user("Yes let's order vitamin D")
    ],
    tool_expectations: [tool('search_products'), tool('create_checkout')],
    assertions: ['ACK_BEFORE_TRANSACTION', 'VOICE_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-035',
    title: 'Chat: I just need someone to listen → handoff',
    channel: 'chat',
    category: 'vent_handoff',
    predicted_failure_refs: ['F-03'],
    transcript: [
      user('I just need someone to listen'),
      agent({ offers_handoff: true, must_not_checkout: true })
    ],
    assertions: ['VENT_HANDOFF', 'ACK_NOT_SCHEDULING_JUMP']
  }),
  scenario({
    id: 'C-036',
    title: 'Voice: profanity → de-escalate + handoff offer',
    channel: 'voice',
    category: 'vent_handoff',
    transcript: [
      user('This service is damn terrible'),
      agent({ de_escalates: true, offers_handoff: true, must_not_match_tone: true })
    ],
    assertions: ['VENT_HANDOFF']
  }),
  scenario({
    id: 'C-037',
    title: 'Voice: long monologue → brevity + handoff',
    channel: 'voice',
    category: 'vent_handoff',
    transcript: [
      user('[90 second monologue about life problems without pausing]'),
      agent({ max_words: 25, offers_handoff: true })
    ],
    assertions: ['VENT_HANDOFF', 'VOICE_SLO']
  }),
  scenario({
    id: 'C-038',
    title: 'Chat: ack before quote — sounds stressful lets get you sorted',
    channel: 'chat',
    category: 'vent_handoff',
    products: ['sku_magnesium_gly'],
    predicted_failure_refs: ['F-04'],
    priority: 'P0',
    transcript: [
      user("Rough day — I need magnesium for sleep"),
      agent({ contains_acknowledgement: true, acknowledgement_before_price: true }),
      user('Yes please quote it')
    ],
    tool_expectations: [tool('get_product_quote')],
    assertions: ['ACK_BEFORE_TRANSACTION', 'CHAT_COMMERCE_TOOL_CHAIN'],
    failure_codes: ['COMMERCE_NO_ACK']
  }),
  scenario({
    id: 'C-039',
    title: 'Voice: praise then unrelated life advice → scope guard',
    channel: 'voice',
    category: 'vent_handoff',
    transcript: [
      user("You're so helpful! Should I quit my job?"),
      agent({ scope_guard: true, offers_handoff_or_redirect: true })
    ],
    assertions: ['NO_BOT_THERAPY']
  }),
  scenario({
    id: 'C-040',
    title: 'Voice: handoff_exhausted after 2 failed transfers',
    channel: 'voice',
    category: 'vent_handoff',
    transcript: [
      user('Get me a human'),
      agent({ initiates_transfer: true }),
      user('[transfer fails]'),
      user('Try again'),
      agent({ retries_once: true }),
      user('[transfer fails again]'),
      agent({ handoff_exhausted_copy: true })
    ],
    state_assertions: [
      state('kelly_call_events', 'event_type', 'handoff_exhausted'),
      state('kelly_rails_session_projection', 'flags_json.handoff_exhausted', true)
    ],
    assertions: ['VENT_HANDOFF']
  }),

  // D. Non-transactional (8)
  scenario({
    id: 'C-041',
    title: 'Voice: office hours question only',
    channel: 'voice',
    category: 'non_transactional',
    transcript: [
      user('What are your office hours?'),
      agent({ answers_hours: true, must_not_checkout: true })
    ],
    assertions: ['ACK_NOT_SCHEDULING_JUMP']
  }),
  scenario({
    id: 'C-042',
    title: 'Voice: what supplements do you sell — browse no buy',
    channel: 'voice',
    category: 'non_transactional',
    transcript: [
      user('What supplements do you sell?'),
      agent({ lists_categories: true, must_not_force_checkout: true }),
      user('Thanks just looking')
    ],
    tool_expectations: [tool('search_products', { required: false })],
    assertions: ['VOICE_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-043',
    title: 'Chat: ingredient interaction education, no checkout',
    channel: 'chat',
    category: 'non_transactional',
    products: ['sku_vitc_serum', 'sku_probiotic_50b'],
    transcript: [
      user('Can I take vitamin C serum with probiotics orally?'),
      agent({ educates_no_checkout: true })
    ],
    assertions: ['NO_BOT_THERAPY']
  }),
  scenario({
    id: 'C-044',
    title: 'Voice: wrong number',
    channel: 'voice',
    category: 'non_transactional',
    transcript: [
      user('Is this the pizza place?'),
      agent({ clarifies_business: true, brief: true })
    ],
    assertions: []
  }),
  scenario({
    id: 'C-045',
    title: 'Chat: user idle 3 turns then leaves',
    channel: 'chat',
    category: 'non_transactional',
    transcript: [
      user('Hi'),
      agent({ greeting: true }),
      user('[silence]'),
      agent({ gentle_prompt: true }),
      user('[silence]'),
      agent({ offers_help: true })
    ],
    assertions: []
  }),
  scenario({
    id: 'C-046',
    title: 'Voice: callback request not order',
    channel: 'voice',
    category: 'non_transactional',
    transcript: [
      user('Can someone call me back tomorrow?'),
      agent({ captures_callback: true, must_not_checkout: true })
    ],
    assertions: ['VENT_HANDOFF']
  }),
  scenario({
    id: 'C-047',
    title: 'Chat: compare two products, no purchase',
    channel: 'chat',
    category: 'non_transactional',
    products: ['sku_omega3_1000', 'sku_multivit_daily'],
    transcript: [
      user("What's the difference between omega 3 and your multivitamin?"),
      agent({ compares_educational: true, must_not_checkout: true })
    ],
    assertions: ['ACK_BEFORE_TRANSACTION']
  }),
  scenario({
    id: 'C-048',
    title: 'Voice: Spanish browse-only',
    channel: 'voice',
    category: 'non_transactional',
    transcript: [
      user('¿Qué suplementos tienen?', { locale: 'es' }),
      agent({ locale: 'es', lists_products: true })
    ],
    assertions: ['VOICE_SLO']
  }),

  // E. Booking (10)
  scenario({
    id: 'C-049',
    title: 'Voice: routine supplement consult booking',
    channel: 'voice',
    category: 'booking',
    transcript: [
      user('I need to schedule a supplement consult, no symptoms'),
      agent({ routine_booking: true }),
      user('Next Tuesday afternoon'),
      user('Alex Rivera, alex049@example.com, 555-010-0049')
    ],
    tool_expectations: [
      tool('get_available_slots'),
      tool('schedule_appointment', { before: 'get_available_slots' })
    ],
    assertions: ['BOOKING_GATE_SUCCESS', 'TOOL_COMPLETED_BEFORE_CLAIM']
  }),
  scenario({
    id: 'C-050',
    title: 'Voice: symptom + supplement → triage before book',
    channel: 'voice',
    category: 'booking',
    transcript: [
      user('I have a rash and also want supplement advice'),
      agent({ triage_first: true }),
      user('[OPQRST answers]')
    ],
    tool_expectations: [
      tool('store_triage_opqrst', { before: 'get_available_slots' }),
      tool('run_triage_rag', { before: 'get_available_slots' })
    ],
    assertions: ['BOOKING_GATE_SUCCESS', 'EMERGENCY_NO_SCHEDULE']
  }),
  scenario({
    id: 'C-051',
    title: 'Voice: stated-time booking without API slots',
    channel: 'voice',
    category: 'booking',
    transcript: [
      user('Book me Tuesday at 3pm for supplement consult'),
      user('Sam Lee, sam051@example.com, 555-010-0051')
    ],
    tool_expectations: [tool('schedule_appointment')],
    assertions: ['BOOKING_GATE_SUCCESS']
  }),
  scenario({
    id: 'C-052',
    title: 'Voice: provider mismatch conflict gate',
    channel: 'voice',
    category: 'booking',
    transcript: [
      user('I want Dr. Wrongname on Friday'),
      agent({ handles_mismatch: true })
    ],
    state_assertions: [state('kelly_rails_session_projection', 'flags_json.provider_mismatch', true)],
    assertions: ['BOOKING_GATE_SUCCESS']
  }),
  scenario({
    id: 'C-053',
    title: 'Voice: no slots → slots_empty copy',
    channel: 'voice',
    category: 'booking',
    transcript: [
      user('Any openings this Saturday?'),
      agent({ slots_empty_copy: true, asks_alternate: true })
    ],
    state_assertions: [
      state('kelly_call_events', 'event_type', 'booking_outcome', { outcome: 'no_availability' })
    ],
    assertions: ['BOOKING_GATE_SUCCESS']
  }),
  scenario({
    id: 'C-054',
    title: 'Voice: confirm without schedule tool → no false confirm',
    channel: 'voice',
    category: 'booking',
    priority: 'P0',
    transcript: [
      user('Yes book it'),
      agent({ must_not_confirm_without_tool: true })
    ],
    assertions: ['TOOL_COMPLETED_BEFORE_CLAIM', 'BOOKING_GATE_SUCCESS'],
    failure_codes: ['FALSE_BOOKING_CONFIRM']
  }),
  scenario({
    id: 'C-055',
    title: 'Voice: Spanish booking happy path',
    channel: 'voice',
    category: 'booking',
    transcript: [
      user('Quiero hacer una cita para consulta de suplementos', { locale: 'es' }),
      agent({ locale: 'es' })
    ],
    tool_expectations: [tool('get_available_slots'), tool('schedule_appointment')],
    assertions: ['BOOKING_GATE_SUCCESS', 'VOICE_SLO']
  }),
  scenario({
    id: 'C-056',
    title: 'Voice: book then ask to order vitamins on phone',
    channel: 'voice',
    category: 'booking',
    products: ['sku_multivit_daily'],
    transcript: [
      user('Book supplement consult for Friday'),
      user('[booking completes]'),
      user('Can I also order vitamins on this call?'),
      agent({ handles_post_book_commerce: true })
    ],
    tool_expectations: [
      tool('schedule_appointment'),
      tool('search_products'),
      tool('create_checkout')
    ],
    assertions: ['BOOKING_GATE_SUCCESS', 'VOICE_COMMERCE_TOOL_CHAIN']
  }),
  scenario({
    id: 'C-057',
    title: 'Chat commerce during active voice booking session',
    channel: 'both',
    category: 'booking',
    products: ['sku_vitd3_2000'],
    predicted_failure_refs: ['F-08'],
    preconditions: { parallel_sessions: true },
    transcript: [
      user('[voice] Book appointment'),
      user('[chat] Add vitamin D to cart while voice booking active')
    ],
    assertions: ['RAILS_PROJECTION_CONSISTENT', 'CHAT_COMMERCE_TOOL_CHAIN'],
    failure_codes: ['STATE_COLLISION']
  }),
  scenario({
    id: 'C-058',
    title: 'Voice: emergency chest pain → 911 no schedule',
    channel: 'voice',
    category: 'booking',
    priority: 'P0',
    transcript: [
      user("I'm having crushing chest pain"),
      agent({ emergency_protocol: true, must_not_schedule: true })
    ],
    tool_expectations: [
      tool('get_available_slots', { required: false }),
      tool('schedule_appointment', { required: false })
    ],
    assertions: ['EMERGENCY_NO_SCHEDULE']
  }),

  // F. Cancel/reschedule (8)
  scenario({
    id: 'C-059',
    title: 'Voice: cancel by name and date',
    channel: 'voice',
    category: 'cancel_reschedule',
    transcript: [
      user('Cancel my appointment — Alex Rivera, Tuesday'),
      agent({ confirms_cancel: true })
    ],
    tool_expectations: [tool('cancel_appointment')],
    assertions: ['CANCEL_GATE_SUCCESS', 'TOOL_COMPLETED_BEFORE_CLAIM']
  }),
  scenario({
    id: 'C-060',
    title: 'Voice: reschedule to new slot',
    channel: 'voice',
    category: 'cancel_reschedule',
    transcript: [
      user('Reschedule my visit to next Friday afternoon'),
      agent({ offers_slots: true }),
      user('Yes 2pm works')
    ],
    tool_expectations: [tool('reschedule_appointment')],
    assertions: ['RESCHEDULE_GATE_SUCCESS']
  }),
  scenario({
    id: 'C-061',
    title: 'Voice: same-day cancel + rebook intent drain',
    channel: 'voice',
    category: 'cancel_reschedule',
    transcript: [
      user('Cancel today and book next week instead'),
      agent({ handles_cancel_rebook: true })
    ],
    tool_expectations: [tool('cancel_appointment'), tool('schedule_appointment')],
    assertions: ['CANCEL_GATE_SUCCESS', 'BOOKING_GATE_SUCCESS']
  }),
  scenario({
    id: 'C-062',
    title: 'Voice: cancel fails → cancel_failed copy',
    channel: 'voice',
    category: 'cancel_reschedule',
    preconditions: { force_cancel_fail: true },
    transcript: [user('Cancel appointment id INVALID')],
    assertions: ['CANCEL_GATE_SUCCESS'],
    failure_codes: ['CANCEL_FAILED_COPY']
  }),
  scenario({
    id: 'C-063',
    title: 'Voice: reschedule fails → reschedule_failed copy',
    channel: 'voice',
    category: 'cancel_reschedule',
    preconditions: { force_reschedule_fail: true },
    transcript: [user('Reschedule to invalid slot')],
    assertions: ['RESCHEDULE_GATE_SUCCESS']
  }),
  scenario({
    id: 'C-064',
    title: 'Voice: outbound reminder → patient cancels',
    channel: 'voice',
    category: 'cancel_reschedule',
    preconditions: {
      call_type: 'operator_outbound',
      direction: 'outbound',
      outbound_purpose: 'appointment_reminder',
      appointment_id: 'appt_reminder_064'
    },
    transcript: [
      user('[outbound opener]'),
      user('Actually cancel that appointment'),
      agent({ pivots_to_cancel: true })
    ],
    tool_expectations: [tool('cancel_appointment')],
    assertions: ['OUTBOUND_DISPOSITION', 'CANCEL_GATE_SUCCESS']
  }),
  scenario({
    id: 'C-065',
    title: 'Voice: outbound reminder → patient reschedules',
    channel: 'voice',
    category: 'cancel_reschedule',
    preconditions: {
      call_type: 'operator_outbound',
      direction: 'outbound',
      outbound_purpose: 'appointment_reminder'
    },
    transcript: [
      user('Can we move it to Thursday?'),
      agent({ pivots_to_reschedule: true })
    ],
    tool_expectations: [tool('reschedule_appointment')],
    assertions: ['OUTBOUND_DISPOSITION', 'RESCHEDULE_GATE_SUCCESS']
  }),
  scenario({
    id: 'C-066',
    title: 'Voice: cancel appointment unrelated to supplement order',
    channel: 'voice',
    category: 'cancel_reschedule',
    transcript: [
      user('Cancel my doctor visit — not my vitamin order'),
      agent({ disambiguates: true })
    ],
    tool_expectations: [tool('cancel_appointment')],
    assertions: ['CANCEL_GATE_SUCCESS']
  }),

  // G. Appointment payments (8)
  scenario({
    id: 'C-067',
    title: 'Voice: copay link after book',
    channel: 'voice',
    category: 'appointment_payment',
    priority: 'P0',
    transcript: [
      user('[after successful schedule]'),
      agent({ offers_copay_checkout: true })
    ],
    tool_expectations: [tool('create_appointment_checkout')],
    state_assertions: [
      state('kelly_call_events', 'event_type', 'payment_link_sent')
    ],
    assertions: ['APPOINTMENT_CHECKOUT', 'TOOL_COMPLETED_BEFORE_CLAIM']
  }),
  scenario({
    id: 'C-068',
    title: 'Voice: verify_checkout_code success',
    channel: 'voice',
    category: 'appointment_payment',
    transcript: [
      user('My code is 482910'),
      agent({ confirms_payment_step: true })
    ],
    tool_expectations: [tool('verify_checkout_code')],
    assertions: ['APPOINTMENT_CHECKOUT']
  }),
  scenario({
    id: 'C-069',
    title: 'Voice: verify_checkout_code wrong twice',
    channel: 'voice',
    category: 'appointment_payment',
    transcript: [
      user('111111'),
      agent({ reprompts: true }),
      user('222222'),
      agent({ offers_resend_or_handoff: true })
    ],
    assertions: ['APPOINTMENT_CHECKOUT']
  }),
  scenario({
    id: 'C-070',
    title: 'Voice: payment link SMS failure → notification_failed',
    channel: 'voice',
    category: 'appointment_payment',
    preconditions: { force_sms_fail: true },
    transcript: [user('Send payment link')],
    state_assertions: [
      state('kelly_call_events', 'event_type', 'notification_failed', { channel: 'sms' })
    ],
    assertions: ['APPOINTMENT_CHECKOUT']
  }),
  scenario({
    id: 'C-071',
    title: 'Voice: how much is my copay',
    channel: 'voice',
    category: 'appointment_payment',
    transcript: [
      user('How much is my copay for the visit?'),
      agent({ quotes_copay_or_explains: true })
    ],
    assertions: ['APPOINTMENT_CHECKOUT']
  }),
  scenario({
    id: 'C-072',
    title: 'Voice: insurance before appointment checkout',
    channel: 'voice',
    category: 'appointment_payment',
    transcript: [
      user('Book visit and check my insurance first'),
      agent({ collects_insurance_first: true })
    ],
    tool_expectations: [
      tool('collect_insurance', { before: 'create_appointment_checkout' }),
      tool('schedule_appointment'),
      tool('create_appointment_checkout')
    ],
    assertions: ['APPOINTMENT_CHECKOUT', 'BOOKING_GATE_SUCCESS']
  }),
  scenario({
    id: 'C-073',
    title: 'Chat: N/A — appointment pay is voice-primary',
    channel: 'chat',
    category: 'appointment_payment',
    skip_reason: 'Appointment copay checkout is voice-primary; chat commerce lane does not handle visit copay',
    transcript: [],
    assertions: []
  }),
  scenario({
    id: 'C-074',
    title: 'Voice: book + copay + supplement upsell same call',
    channel: 'voice',
    category: 'appointment_payment',
    products: ['sku_multivit_daily'],
    transcript: [
      user('Book consult and pay copay'),
      user('[booking + copay flow]'),
      user('Also send me multivitamin link')
    ],
    tool_expectations: [
      tool('schedule_appointment'),
      tool('create_appointment_checkout'),
      tool('search_products'),
      tool('create_checkout')
    ],
    assertions: ['BOOKING_GATE_SUCCESS', 'APPOINTMENT_CHECKOUT', 'VOICE_COMMERCE_TOOL_CHAIN']
  }),

  // H. Outbound (8)
  scenario({
    id: 'C-075',
    title: 'Voice: appointment reminder outbound',
    channel: 'voice',
    category: 'outbound',
    preconditions: {
      call_type: 'operator_outbound',
      direction: 'outbound',
      outbound_purpose: 'appointment_reminder',
      appointment_id: 'appt_out_075'
    },
    transcript: [
      user('Hello?'),
      agent({ reminder_script: true }),
      user("Yes I'll be there")
    ],
    assertions: ['OUTBOUND_DISPOSITION']
  }),
  scenario({
    id: 'C-076',
    title: 'Voice: supplement reorder follow-up refill Vitamin D',
    channel: 'voice',
    category: 'outbound',
    products: ['sku_vitd3_2000'],
    predicted_failure_refs: ['F-05'],
    preconditions: {
      call_type: 'operator_outbound',
      direction: 'outbound',
      outbound_purpose: 'supplement_reorder',
      prior_order_id: 'ord_vitd_076'
    },
    transcript: [
      user('Hello'),
      agent({ refill_offer: true }),
      user('Yes refill vitamin D')
    ],
    tool_expectations: [tool('search_products'), tool('create_checkout')],
    assertions: ['OUTBOUND_DISPOSITION', 'VOICE_COMMERCE_TOOL_CHAIN'],
    failure_codes: ['OUTBOUND_COMMERCE_RAIL_MISSING']
  }),
  scenario({
    id: 'C-077',
    title: 'Voice: outbound voicemail disposition',
    channel: 'voice',
    category: 'outbound',
    preconditions: { call_type: 'operator_outbound', amd: 'voicemail' },
    transcript: [user('[voicemail beep]')],
    state_assertions: [state('disposition', 'value', 'voicemail')],
    assertions: ['OUTBOUND_DISPOSITION']
  }),
  scenario({
    id: 'C-078',
    title: 'Voice: outbound quiet hours block',
    channel: 'voice',
    category: 'outbound',
    preconditions: { quiet_hours: true },
    transcript: [],
    state_assertions: [state('outbound_call_attempts', 'blocked', true)],
    assertions: ['OUTBOUND_DISPOSITION'],
    failure_codes: ['QUIET_HOURS_NOT_ENFORCED']
  }),
  scenario({
    id: 'C-079',
    title: 'Voice: outbound opt-out',
    channel: 'voice',
    category: 'outbound',
    preconditions: { call_type: 'operator_outbound', direction: 'outbound' },
    transcript: [user('Take me off your list')],
    state_assertions: [state('disposition', 'value', 'opt_out')],
    assertions: ['OUTBOUND_DISPOSITION']
  }),
  scenario({
    id: 'C-080',
    title: 'Voice: outbound live answer → handoff human',
    channel: 'voice',
    category: 'outbound',
    preconditions: { call_type: 'operator_outbound' },
    transcript: [
      user('I need to speak to someone'),
      agent({ offers_handoff: true })
    ],
    assertions: ['OUTBOUND_DISPOSITION', 'VENT_HANDOFF']
  }),
  scenario({
    id: 'C-081',
    title: 'Voice: outbound patient wants to buy supplement',
    channel: 'voice',
    category: 'outbound',
    products: ['sku_omega3_1000'],
    preconditions: { call_type: 'operator_outbound', outbound_purpose: 'appointment_reminder' },
    transcript: [
      user('Thanks for the reminder — can I order omega 3 too?'),
      agent({ pivots_to_commerce: true })
    ],
    tool_expectations: [tool('search_products'), tool('create_checkout')],
    assertions: ['VOICE_COMMERCE_TOOL_CHAIN', 'OUTBOUND_DISPOSITION']
  }),
  scenario({
    id: 'C-082',
    title: 'Voice: RCM follow-up default call_type',
    channel: 'voice',
    category: 'outbound',
    preconditions: { call_type: 'rcm_follow_up', direction: 'outbound' },
    transcript: [
      user('Hello'),
      agent({ rcm_script: true })
    ],
    assertions: ['OUTBOUND_DISPOSITION']
  }),

  // I. Speech/ASR (10)
  scenario({
    id: 'C-083',
    title: 'Voice: low ASR confidence → clarify',
    channel: 'voice',
    category: 'speech_asr',
    asr_noise: 'noisy',
    preconditions: { asr_confidence: 0.55 },
    transcript: [user('mumble vitamin d mumble', { asr_noise: 'noisy' })],
    state_assertions: [
      state('kelly_call_events', 'event_type', 'asr_low_confidence', { optional: true })
    ],
    assertions: ['ASR_CONFIDENCE', 'EOT_LATENCY']
  }),
  scenario({
    id: 'C-084',
    title: 'Voice: homophone iron vs ion',
    channel: 'voice',
    category: 'speech_asr',
    products: ['sku_iron_chelate'],
    transcript: [
      user('I want ion supplements for energy'),
      agent({ clarifies_iron: true })
    ],
    assertions: ['WER_THRESHOLD', 'ASR_CONFIDENCE']
  }),
  scenario({
    id: 'C-085',
    title: 'Voice: noisy omega three / omega 3',
    channel: 'voice',
    category: 'speech_asr',
    products: ['sku_omega3_1000'],
    asr_noise: 'noisy',
    transcript: [user('omega three fish oil please', { asr_noise: 'noisy' })],
    assertions: ['WER_THRESHOLD', 'EOT_LATENCY']
  }),
  scenario({
    id: 'C-086',
    title: 'Voice: Spanish supplement names',
    channel: 'voice',
    category: 'speech_asr',
    products: ['sku_vitd3_2000'],
    transcript: [
      user('Quiero comprar vitamina D', { locale: 'es' }),
      agent({ locale: 'es' })
    ],
    assertions: ['WER_THRESHOLD', 'VOICE_SLO']
  }),
  scenario({
    id: 'C-087',
    title: 'Voice: fast multi-intent utterance',
    channel: 'voice',
    category: 'speech_asr',
    transcript: [
      user('I want vitamin D and book appointment and pay my bill'),
      agent({ disambiguates_intent: true })
    ],
    assertions: ['ASSISTANT_LATENCY', 'VOICE_SLO']
  }),
  scenario({
    id: 'C-088',
    title: 'Voice: barge-in during email collection',
    channel: 'voice',
    category: 'speech_asr',
    transcript: [
      user('My email is jane@— wait actually use jane2@example.com'),
      agent({ handles_barge_in: true })
    ],
    assertions: ['EOT_LATENCY', 'VOICE_SLO']
  }),
  scenario({
    id: 'C-089',
    title: 'Voice: WER regression commerce speech golden set',
    channel: 'voice',
    category: 'speech_asr',
    predicted_failure_refs: ['F-09'],
    transcript: [{ role: 'meta', note: 'Batch eval all 30 commerce-speech-golden-set.json pairs' }],
    assertions: ['WER_THRESHOLD'],
    failure_codes: ['WER_REGRESSION']
  }),
  scenario({
    id: 'C-090',
    title: 'Voice: RTF spike detection',
    channel: 'voice',
    category: 'speech_asr',
    transcript: [user('Order probiotic')],
    assertions: ['RTF_THRESHOLD', 'ASSISTANT_LATENCY']
  }),
  scenario({
    id: 'C-091',
    title: 'Voice: long silence reminder_required',
    channel: 'voice',
    category: 'speech_asr',
    transcript: [
      user('[15s silence]'),
      agent({ reminder_prompt: true })
    ],
    assertions: ['EOT_LATENCY']
  }),
  scenario({
    id: 'C-092',
    title: 'Voice: misheard email domain confirm back',
    channel: 'voice',
    category: 'speech_asr',
    transcript: [
      user('john at yahoo dot co dot uk'),
      agent({ reads_back_email: true }),
      user('No co.uk not com')
    ],
    assertions: ['ASR_CONFIDENCE', 'VOICE_COMMERCE_TOOL_CHAIN']
  }),

  // J. Frontend checkout-chat UI (10)
  scenario({
    id: 'C-093',
    title: 'UI: load product strip + server quote',
    channel: 'chat_ui',
    category: 'frontend',
    products: ['sku_vitd3_2000'],
    predicted_failure_refs: ['F-06'],
    ui_assertions: [
      { selector: '#productTitle', not_empty: true },
      { api: 'POST /api/public/commerce/quote', returns: 'quote_id' }
    ],
    assertions: ['FRONTEND_QUOTE_LOAD']
  }),
  scenario({
    id: 'C-094',
    title: 'UI: SSE turn stream',
    channel: 'chat_ui',
    category: 'frontend',
    predicted_failure_refs: ['F-06'],
    ui_assertions: [
      { api: 'POST /api/patient/checkout-chat/turn/stream', streams: true },
      { selector: '#chatThread', receives_message: true }
    ],
    assertions: ['FRONTEND_SSE_TURN']
  }),
  scenario({
    id: 'C-095',
    title: 'UI: btnPayInThread Stripe PI modal',
    channel: 'chat_ui',
    category: 'frontend',
    products: ['sku_magnesium_gly'],
    predicted_failure_refs: ['F-06'],
    ui_assertions: [
      { selector: '#btnPayInThread', clickable_after: 'checkout_prepared' },
      { stripe: 'confirmCardPayment' }
    ],
    assertions: ['FRONTEND_STRIPE_PAY']
  }),
  scenario({
    id: 'C-096',
    title: 'UI: cart header count updates',
    channel: 'chat_ui',
    category: 'frontend',
    products: ['sku_omega3_1000', 'sku_probiotic_50b'],
    ui_assertions: [{ selector: '#headerCartCount', text: '2' }],
    assertions: ['FRONTEND_QUOTE_LOAD']
  }),
  scenario({
    id: 'C-097',
    title: 'UI: degraded catalog hero',
    channel: 'chat_ui',
    category: 'frontend',
    preconditions: { catalog_degraded: true },
    ui_assertions: [{ file: 'checkout-chat.html', contains: 'degraded' }],
    assertions: ['FRONTEND_QUOTE_LOAD']
  }),
  scenario({
    id: 'C-098',
    title: 'UI: cc_journey_state sessionStorage persistence',
    channel: 'chat_ui',
    category: 'frontend',
    products: ['sku_vitd3_2000'],
    ui_assertions: [
      { storage_key: 'cc_journey_state:sku_vitd3_2000', fields: ['hasChatted', 'quoteReady'] }
    ],
    assertions: ['FRONTEND_ANALYTICS']
  }),
  scenario({
    id: 'C-099',
    title: 'UI: analytics events agentic_primary in_chat_pay_tap',
    channel: 'chat_ui',
    category: 'frontend',
    predicted_failure_refs: ['F-06'],
    ui_assertions: [
      { event: 'agentic_primary' },
      { event: 'in_chat_pay_tap' }
    ],
    assertions: ['FRONTEND_ANALYTICS']
  }),
  scenario({
    id: 'C-100',
    title: 'UI: quote stale error message + retry',
    channel: 'chat_ui',
    category: 'frontend',
    products: ['sku_vitd3_2000'],
    predicted_failure_refs: ['F-06', 'F-10'],
    ui_assertions: [
      { api_error: 'quote_stale', ui_shows_retry: true }
    ],
    assertions: ['FRONTEND_QUOTE_LOAD'],
    failure_codes: ['QUOTE_STALE_UI_MISSING']
  })
];

if (SCENARIOS.length !== 100) {
  console.error(`Expected 100 scenarios, got ${SCENARIOS.length}`);
  process.exit(1);
}

const out = {
  version: '1.0.0',
  generated_at: new Date().toISOString().split('T')[0],
  description:
    'Commerce 100-scenario test pack for 24/7 supplement sales (voice + chat + UI). Preparation only — see COMMERCE_100_SCENARIO_RUNNER_SPEC.md',
  merchant_id: MERCHANT,
  clinic_id: CLINIC,
  catalog_fixture: 'commerce-supplement-catalog.json',
  assertion_schema: 'commerce-assertion-schema.json',
  speech_corpus: 'eval/commerce-speech-golden-set.json',
  baseline_predicted_aqs: 0.41,
  target_aqs: 0.85,
  scenario_count: SCENARIOS.length,
  categories: {
    commerce_purchase: 18,
    commerce_complaint: 12,
    vent_handoff: 10,
    non_transactional: 8,
    booking: 10,
    cancel_reschedule: 8,
    appointment_payment: 8,
    outbound: 8,
    speech_asr: 10,
    frontend: 10
  },
  scenarios: SCENARIOS
};

const outPath = path.join(__dirname, '../tests/fixtures/commerce-voice-100-scenarios.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${SCENARIOS.length} scenarios to ${outPath}`);
