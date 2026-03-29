#!/usr/bin/env node
/**
 * Terminal harness: Kelly commerce checkout (Anthropic, non-streaming).
 *
 * The UI uses SSE → Groq for checkout-chat. This script sets NO onStreamDelta so
 * _runLLMLoop uses LLMRouter.call → Anthropic when KELLY_PRIMARY_PROVIDER=anthropic.
 *
 * Requires: API server on API_BASE_URL (default http://localhost:4000) for tool HTTP,
 * ANTHROPIC_API_KEY, and DB_PATH pointing at a DB with products + clinic merchant link.
 *
 * Usage (from middleware-platform/):
 *   KELLY_PRIMARY_PROVIDER=anthropic node scripts/test-commerce-checkout-agent.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

process.env.KELLY_PRIMARY_PROVIDER = process.env.KELLY_PRIMARY_PROVIDER || 'anthropic';
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../middleware-dev.db');

const BASE_URL = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';

const CLINIC_ID = process.env.TEST_CLINIC_ID || 'clinic-default';
const MERCHANT_ID = process.env.TEST_MERCHANT_ID || 'merchant_c3d547a10f43eeec';

// Load DB + Kelly after env
const database = require('../database');
const KellyAgentService = require('../services/kelly-agent-service');

function hr() {
  console.log('\n' + '='.repeat(72) + '\n');
}

function pickProducts() {
  try {
    return database.getProductsByMerchant(MERCHANT_ID) || [];
  } catch (e) {
    console.error('DB products query failed:', e.message);
    return [];
  }
}

async function checkServer() {
  try {
    const r = await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
    return { ok: r.status === 200, status: r.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function apiQuote(productId) {
  const r = await axios.post(
    `${BASE_URL}/api/public/commerce/quote`,
    {
      product_id: productId,
      prescription_id: productId,
      provider_id: MERCHANT_ID,
      quantity: 1
    },
    { timeout: 20000, validateStatus: () => true }
  );
  return { status: r.status, data: r.data };
}

async function apiCheckoutStart(body) {
  const r = await axios.post(`${BASE_URL}/api/public/checkout/start`, body, {
    timeout: 45000,
    validateStatus: () => true,
    headers: { 'Content-Type': 'application/json' }
  });
  return { status: r.status, data: r.data };
}

async function runAgentTurn({
  sessionId,
  productId,
  providerId,
  message,
  patientEmail,
  label
}) {
  const started = Date.now();
  const result = await KellyAgentService.processTurn({
    message,
    sessionId,
    channel: 'chat',
    clinicId: CLINIC_ID,
    patientId: null,
    patientEmail: patientEmail || null,
    commerceCheckout: { productId, providerId }
    // no onStreamDelta → Anthropic path
  });
  const ms = Date.now() - started;
  console.log(`[${label}] ${ms}ms`);
  console.log('  toolsUsed:', JSON.stringify(result.toolsUsed || []));
  console.log('  quote_id:', result.quote_id || null);
  console.log('  redirect_to:', result.redirect_to ? String(result.redirect_to).slice(0, 120) + '…' : null);
  console.log('  reply (trunc):', String(result.reply || '').slice(0, 420).replace(/\s+/g, ' '));
  if (result.error_code) console.log('  error_code:', result.error_code);
  return result;
}

async function main() {
  hr();
  console.log('Commerce checkout agent test (Anthropic via non-streaming Kelly path)');
  console.log('DB_PATH:', process.env.DB_PATH);
  console.log('KELLY_PRIMARY_PROVIDER:', process.env.KELLY_PRIMARY_PROVIDER);
  console.log('BASE_URL (tools):', BASE_URL);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nFATAL: ANTHROPIC_API_KEY is not set. Add it to middleware-platform/.env\n');
    process.exit(1);
  }

  const health = await checkServer();
  if (!health.ok) {
    console.error('\nFATAL: API server not reachable at', BASE_URL, health.error || '');
    console.error('Start the middleware first: cd middleware-platform && node server.js\n');
    process.exit(1);
  }
  console.log('Health:', health.status || 'ok');

  const products = pickProducts();
  console.log('\nProducts for merchant', MERCHANT_ID, ':', products.length);
  products.forEach((p) => {
    console.log(`  - ${p.id} | ${p.name} | $${p.price} | inv ${p.inventory}`);
  });

  if (products.length === 0) {
    console.error('\nNo products for merchant — cannot run scenarios.\n');
    process.exit(1);
  }

  const p0 = products[0];
  const p1 = products[1] || p0;

  // --- Layer A: direct HTTP (no LLM) ---
  hr();
  console.log('LAYER A — Direct HTTP (quote + checkout start)\n');

  const q1 = await apiQuote(p0.id);
  console.log('A1 POST /api/public/commerce/quote', p0.id, '→ HTTP', q1.status);
  console.log('   ', JSON.stringify(q1.data).slice(0, 500));

  let quoteId = q1.data && q1.data.quote_id;
  const cs = await apiCheckoutStart({
    provider_id: MERCHANT_ID,
    email: 'commerce-test@example.com',
    name: 'Commerce Test',
    prescription_id: p0.id,
    quantity: 1,
    payment_method: 'direct_stripe',
    quote_id: quoteId,
    checkout_session_id: quoteId,
    shipping_address: '100 Main St, Boston, MA 02101'
  });
  console.log('\nA2 POST /api/public/checkout/start (with quote + shipping) → HTTP', cs.status);
  console.log('   ', JSON.stringify(cs.data).slice(0, 800));

  const qStale = await apiQuote(p1.id);
  const wrongQuote = qStale.data && qStale.data.quote_id;
  const mismatch = await apiCheckoutStart({
    provider_id: MERCHANT_ID,
    email: 'mismatch@example.com',
    name: 'Mismatch',
    prescription_id: p0.id,
    quantity: 1,
    payment_method: 'direct_stripe',
    quote_id: wrongQuote,
    checkout_session_id: wrongQuote
  });
  console.log('\nA3 checkout with product A id but quote from product B → HTTP', mismatch.status);
  console.log('   ', JSON.stringify(mismatch.data).slice(0, 400));

  // --- Layer B: Kelly + Anthropic ---
  hr();
  console.log('LAYER B — KellyAgentService.processTurn (Anthropic, commerce tools)\n');

  await runAgentTurn({
    label: 'B1 small talk (ingredients)',
    sessionId: uuidv4(),
    productId: p0.id,
    providerId: MERCHANT_ID,
    message: 'In one sentence, what is niacinamide used for in skincare?',
    patientEmail: null
  });

  await runAgentTurn({
    label: 'B2 ask price explicitly',
    sessionId: uuidv4(),
    productId: p0.id,
    providerId: MERCHANT_ID,
    message: 'What is the exact total in USD for quantity 1 including any tax? Use your tools.',
    patientEmail: 'price-check@example.com'
  });

  await runAgentTurn({
    label: 'B3 intent to buy + shipping + email',
    sessionId: uuidv4(),
    productId: p0.id,
    providerId: MERCHANT_ID,
    message:
      'I want to buy one unit. Email: checkout.agent.test@example.com. Ship to: 200 Oak Ave, Cambridge, MA 02139.',
    patientEmail: 'checkout.agent.test@example.com'
  });

  await runAgentTurn({
    label: 'B4 quantity 2 (quote should reflect 2 units)',
    sessionId: uuidv4(),
    productId: p0.id,
    providerId: MERCHANT_ID,
    message: 'I need two bottles shipped to the same address. Quote the total for quantity 2.',
    patientEmail: 'qty2@example.com'
  });

  await runAgentTurn({
    label: 'B4b different catalog product (same merchant)',
    sessionId: uuidv4(),
    productId: p1.id,
    providerId: MERCHANT_ID,
    message: 'What is the server-locked price for one unit? Use get_product_quote.',
    patientEmail: 'other-sku@example.com'
  });

  // Wrong merchant: provider that does not own product
  const wrongMerchant = 'merchant_invalid_xxxxxxxx';
  await runAgentTurn({
    label: 'B5 wrong provider_id (product belongs to demo merchant)',
    sessionId: uuidv4(),
    productId: p0.id,
    providerId: wrongMerchant,
    message: 'Get me a quote for one unit.',
    patientEmail: 'x@y.com'
  });

  hr();
  console.log('Done. See summary of common issues in script header / team TODO doc.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
