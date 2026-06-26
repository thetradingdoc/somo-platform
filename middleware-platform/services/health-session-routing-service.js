'use strict';

const Stripe = require('stripe');
const routingRepo = require('../database/repos/health-session-routing');
const healthSessionService = require('./health-session-service');
const eligibilityService = require('./health-session-eligibility-service');

let _stripe = null;

function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = new Stripe(key, { apiVersion: '2024-04-10' });
  return _stripe;
}

function getRouting(sessionId) {
  const row = routingRepo.getBySessionId(sessionId);
  return routingRepo.formatPublic(row);
}

async function ensureQuoted(sessionId, input = {}) {
  let routing = getRouting(sessionId);
  if (!routing || routing.eligibility_status !== 'complete') {
    routing = await eligibilityService.runEligibilityCheck(sessionId, input);
  }
  return routing;
}

async function createCopayRoute(sessionId, input = {}) {
  if (!eligibilityService.financeEnabled()) {
    const err = new Error('Health session finance rails are disabled');
    err.statusCode = 503;
    throw err;
  }

  const session = healthSessionService.getById(sessionId);
  if (!session) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }

  const routing = await ensureQuoted(sessionId, input);
  if (!routing?.copay_cents) {
    const err = new Error('Copay quote unavailable');
    err.statusCode = 422;
    throw err;
  }

  if (routing.payment_status === 'paid') {
    return { ...routing, already_paid: true };
  }

  if (eligibilityService.mockEnabled()) {
    const row = routingRepo.upsertRow({
      sessionId,
      paymentStatus: 'pending_mock',
      routingStatus: 'awaiting_mock_pay'
    });
    return {
      ...routingRepo.formatPublic(row),
      mock_payment: true,
      message: 'Use POST /pay/mock to simulate payment in mock mode'
    };
  }

  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Stripe is not configured');
    err.statusCode = 503;
    throw err;
  }

  const intent = await stripe.paymentIntents.create({
    amount: routing.copay_cents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: {
      health_session_id: sessionId,
      room_id: session.room_id,
      copay_cents: String(routing.copay_cents),
      urgency: routing.urgency || '',
      payer_id: routing.payer_id || ''
    },
    description: `Health session copay ${sessionId.slice(0, 8)}`
  });

  const row = routingRepo.upsertRow({
    sessionId,
    paymentStatus: 'pending',
    routingStatus: 'awaiting_payment',
    stripePaymentIntentId: intent.id,
    routingPayloadJson: JSON.stringify({
      ...(routing.payload || {}),
      stripe: { payment_intent_id: intent.id }
    })
  });

  return {
    ...routingRepo.formatPublic(row),
    client_secret: intent.client_secret,
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null
  };
}

async function mockPay(sessionId) {
  if (!eligibilityService.mockEnabled()) {
    const err = new Error('Mock payment is disabled');
    err.statusCode = 403;
    throw err;
  }
  await ensureQuoted(sessionId);
  const row = routingRepo.markPaid(sessionId, {
    stripePaymentIntentId: `pi_mock_${sessionId.slice(0, 8)}`
  });
  healthSessionService.updateMetadata(sessionId, {
    routing: {
      payment_status: 'paid',
      paid_at: row.paid_at
    }
  });
  try {
    const rcmOrchestrator = require('./rcm-journey-orchestrator');
    if (rcmOrchestrator?.recordHealthSessionCopayStub) {
      await rcmOrchestrator.recordHealthSessionCopayStub(sessionId, row);
    }
  } catch (_) {}
  return routingRepo.formatPublic(row);
}

function markPaidFromStripe(sessionId, paymentIntentId, amountCents) {
  const row = routingRepo.markPaid(sessionId, {
    stripePaymentIntentId: paymentIntentId,
    paidAt: new Date().toISOString()
  });
  if (!row) {
    console.warn('[HealthRouting] payment succeeded but no routing row:', sessionId);
    routingRepo.upsertRow({
      sessionId,
      eligibilityStatus: 'complete',
      paymentStatus: 'paid',
      routingStatus: 'confirmed',
      copayCents: amountCents || null,
      stripePaymentIntentId: paymentIntentId,
      paidAt: new Date().toISOString()
    });
  }
  healthSessionService.updateMetadata(sessionId, {
    routing: { payment_status: 'paid', stripe_payment_intent_id: paymentIntentId }
  });
  return routingRepo.formatPublic(routingRepo.getBySessionId(sessionId));
}

module.exports = {
  getRouting,
  ensureQuoted,
  createCopayRoute,
  mockPay,
  markPaidFromStripe
};
