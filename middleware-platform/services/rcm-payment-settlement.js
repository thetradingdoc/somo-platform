'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const orchestrator = require('./rcm-journey-orchestrator');

let CircleService;
try {
  CircleService = require('./circle-service');
} catch (_) {
  CircleService = null;
}

function ensureTables() {
  orchestrator.ensureKellyRcmTables();
}

function resolveFhirPatientId(patientId) {
  if (!patientId) return null;
  const raw = String(patientId).trim();
  const byId = db.getFHIRPatient(raw);
  if (byId?.resource_id) return byId.resource_id;
  if (raw.includes('@')) {
    const byEmail = db.getFHIRPatientByEmail(raw);
    if (byEmail?.resource_id) return byEmail.resource_id;
  }
  return raw;
}

function getProviderWalletId(clinicId) {
  const clinic = String(clinicId || 'clinic-default');
  return (
    db.getCircleAccountByEntity('provider', clinic)?.circle_wallet_id ||
    db.getCircleAccountByEntity('provider', 'default')?.circle_wallet_id ||
    db.getCircleAccountByEntity('provider', 'clinic-default')?.circle_wallet_id ||
    null
  );
}

function parseUsdcBalance(balanceResult) {
  if (!balanceResult?.success || !balanceResult.balances?.length) return 0;
  const usdc =
    balanceResult.balances.find((b) => b.token?.symbol === 'USDC' || b.token?.symbol === 'USDC.e') ||
    balanceResult.balances[0];
  const raw = usdc?.amount ?? usdc?.balance ?? 0;
  const n = Number(raw);
  if (n > 1_000_000) return n / 1_000_000;
  return n;
}

function loadPaymentByToken(token) {
  ensureTables();
  const row = db.db
    .prepare(`SELECT * FROM rcm_payments WHERE pay_token = ?`)
    .get(String(token || '').trim());
  return row || null;
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}

const CIRCLE_OP_TIMEOUT_MS = Number(process.env.CIRCLE_OP_TIMEOUT_MS || 45000);

function withCircleTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${CIRCLE_OP_TIMEOUT_MS}ms`)), CIRCLE_OP_TIMEOUT_MS);
    }),
  ]);
}

async function getPaymentContext(token) {
  const row = loadPaymentByToken(token);
  if (!row) {
    return { success: false, error: 'Payment link not found or already paid', status: 404 };
  }
  if (row.status === 'paid') {
    return {
      success: true,
      alreadyPaid: true,
      payment: formatPayment(row),
      rails: { usdc: { available: false }, card: { available: false } },
    };
  }

  const fhirPatientId = resolveFhirPatientId(row.patient_id);
  const circleOk = CircleService && CircleService.isAvailable();
  const stripeOk = Boolean(process.env.STRIPE_SECRET_KEY);

  let usdc = {
    available: false,
    reason: circleOk ? null : 'Circle is not configured',
    balance: null,
    wallet_id: null,
  };

  if (circleOk && fhirPatientId) {
    const providerWallet = getProviderWalletId(row.clinic_id);
    if (!providerWallet) {
      usdc.reason = 'Provider clinic wallet is not set up';
    } else {
      usdc.available = true;
      usdc.reason = null;
      const probeBalance = process.env.RCM_PAY_PROBE_CIRCLE_BALANCE === '1';
      if (probeBalance) {
        const walletResult = await CircleService.getOrCreatePatientWallet(fhirPatientId, {
          createIfNotExists: true,
        });
        if (walletResult.success && walletResult.walletId) {
          const bal = await CircleService.getWalletBalance(walletResult.walletId);
          const balance = parseUsdcBalance(bal);
          usdc.balance = balance;
          usdc.wallet_id = walletResult.walletId;
          usdc.sufficient = balance >= Number(row.amount || 0);
        } else {
          usdc.reason = walletResult.error || 'Could not open patient wallet';
          usdc.available = false;
        }
      }
    }
  } else if (!fhirPatientId) {
    usdc.reason = 'Payment is missing patient_id for USDC settlement';
  }

  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';

  return {
    success: true,
    alreadyPaid: false,
    payment: formatPayment(row),
    rails: {
      usdc,
      card: {
        available: stripeOk,
        reason: stripeOk ? null : 'Card payments are not configured',
        publishable_key: stripeOk ? publishableKey : null,
      },
    },
  };
}

function formatPayment(row) {
  return {
    id: row.id,
    amount: row.amount,
    currency: row.currency || 'USD',
    status: row.status,
    clinic_id: row.clinic_id,
    journey_id: row.journey_id,
    patient_id: row.patient_id,
    method: row.method,
    paid_at: row.paid_at,
    circle_transfer_id: row.circle_transfer_id || null,
    stripe_payment_intent_id: row.stripe_payment_intent_id || null,
  };
}

function recordCopayAfterRcmPayment(row, paidMethod, referenceNumber) {
  try {
    if (!db.createCopayPayment) return;
    let claimId = null;
    let appointmentId = null;
    let invoiceId = null;
    let patientId = row.patient_id || null;

    if (row.journey_id) {
      const journey = db.db
        .prepare(`SELECT claim_id, patient_id FROM rcm_journeys WHERE id = ? LIMIT 1`)
        .get(row.journey_id);
      claimId = journey?.claim_id || null;
      patientId = patientId || journey?.patient_id || null;
    }

    if (claimId && db.getInvoicesByClaim) {
      const invoices = db.getInvoicesByClaim(claimId) || [];
      if (invoices[0]) {
        invoiceId = invoices[0].id;
        const amt = Number(row.amount || 0);
        if (amt > 0 && db.addInvoicePayment) {
          db.addInvoicePayment({
            invoice_id: invoiceId,
            payment_date: new Date().toISOString().split('T')[0],
            amount: amt,
            payment_method: paidMethod,
            reference_number: referenceNumber || row.id,
            notes: 'RCM public pay link',
          });
        }
      }
      if (claimId && !appointmentId) {
        const claim = db.getInsuranceClaim?.(claimId) || null;
        appointmentId = claim?.appointment_id || null;
      }
    }

    db.createCopayPayment({
      appointment_id: appointmentId,
      claim_id: claimId,
      invoice_id: invoiceId,
      patient_id: patientId,
      amount: Number(row.amount || 0),
      currency: row.currency || 'USD',
      payment_method: paidMethod,
      reference_number: referenceNumber || row.stripe_payment_intent_id || row.circle_transfer_id || row.id,
      notes: 'Recorded after RCM payment settlement',
      received_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[rcm] recordCopayAfterRcmPayment:', err.message);
  }
}

function sendRcmPaymentReceiptEmail(row, paidMethod) {
  try {
    const EmailService = require('./email-service');
    if (typeof EmailService.sendPaymentLinkEmail !== 'function') return;
    const fhirId = resolveFhirPatientId(row.patient_id);
    if (!fhirId) return;
    const patient = db.getFHIRPatient(fhirId);
    const email =
      patient?.email ||
      patient?.telecom?.find((t) => t.system === 'email')?.value ||
      null;
    if (!email) return;
    const base = publicPayBaseFromEnv();
    const receiptNote = `${base}/patients/wallet.html`;
    EmailService.sendPaymentLinkEmail(email, receiptNote, {
      product_name: 'Payment receipt — copay / balance',
      amount: Number(row.amount || 0),
    }).catch((err) => {
      console.warn('[rcm] receipt email failed:', err.message);
    });
  } catch (err) {
    console.warn('[rcm] sendRcmPaymentReceiptEmail:', err.message);
  }
}

function publicPayBaseFromEnv() {
  return String(
    process.env.PUBLIC_PAY_BASE_URL ||
      process.env.APP_PUBLIC_URL ||
      process.env.API_BASE_URL ||
      process.env.BASE_URL ||
      'http://localhost:4000'
  ).replace(/\/$/, '');
}

function markPaid(row, { method, circleTransferId, stripePaymentIntentId, note }) {
  if (row.status === 'paid') {
    return { success: true, payment_id: row.id, status: 'paid', alreadyPaid: true };
  }

  const paidMethod = method || 'manual';
  db.db
    .prepare(
      `UPDATE rcm_payments SET status = 'paid', paid_at = CURRENT_TIMESTAMP, method = ?,
       circle_transfer_id = COALESCE(?, circle_transfer_id),
       stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id)
       WHERE pay_token = ?`
    )
    .run(
      paidMethod,
      circleTransferId || null,
      stripePaymentIntentId || null,
      row.pay_token
    );

  db.db
    .prepare(
      `INSERT INTO rcm_ledger_entries (id, clinic_id, journey_id, direction, amount, category, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `led_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      row.clinic_id,
      row.journey_id || null,
      'incoming',
      row.amount,
      'patient_payment',
      note || `Public pay link (${paidMethod})`
    );

  if (row.journey_id) {
    try {
      orchestrator.advanceStage({
        journeyId: row.journey_id,
        clinicId: row.clinic_id,
        stageTo: 'bill',
        eventType: 'payment_received',
        payload: {
          payment_id: row.id,
          method: paidMethod,
          circle_transfer_id: circleTransferId || null,
          stripe_payment_intent_id: stripePaymentIntentId || null,
          public: true,
        },
        options: { skipGates: true },
      });
    } catch (_) {
      /* stage may already be bill */
    }
  }

  if (paidMethod !== 'manual') {
    recordCopayAfterRcmPayment(row, paidMethod, stripePaymentIntentId || circleTransferId);
    sendRcmPaymentReceiptEmail(row, paidMethod);
  }

  return { success: true, payment_id: row.id, status: 'paid', method: paidMethod };
}

async function ensurePatientBalance(fhirPatientId, walletId, amountNeeded) {
  if (process.env.CIRCLE_RCM_AUTO_FUND !== '1') return { ok: true };
  const bal = await withCircleTimeout(CircleService.getWalletBalance(walletId), 'Wallet balance');
  const balance = parseUsdcBalance(bal);
  if (balance >= amountNeeded) return { ok: true };
  const fund = await withCircleTimeout(
    CircleService.fundWallet(walletId, Math.max(amountNeeded - balance, amountNeeded)),
    'Fund patient wallet'
  );
  if (!fund.success) {
    return {
      ok: false,
      error: fund.error || 'Could not fund patient wallet for sandbox test',
      balance,
    };
  }
  return { ok: true, funded: true };
}

async function settleUsdc(token) {
  const row = loadPaymentByToken(token);
  if (!row) return { success: false, error: 'Payment not found', status: 404 };
  if (row.status === 'paid') return markPaid(row, { method: row.method || 'usdc' });

  if (!CircleService || !CircleService.isAvailable()) {
    return { success: false, error: 'Circle USDC is not configured', status: 503 };
  }

  const fhirPatientId = resolveFhirPatientId(row.patient_id);
  if (!fhirPatientId) {
    return { success: false, error: 'patient_id is required for USDC payment', status: 400 };
  }

  const providerWalletId = getProviderWalletId(row.clinic_id);
  if (!providerWalletId) {
    return {
      success: false,
      error: 'Provider clinic wallet not configured. Run scripts/seed-rcm-circle-test.cjs',
      status: 503,
    };
  }

  const walletResult = await withCircleTimeout(
    CircleService.getOrCreatePatientWallet(fhirPatientId, { createIfNotExists: true }),
    'Create patient wallet'
  );
  if (!walletResult.success || !walletResult.walletId) {
    return { success: false, error: walletResult.error || 'Patient wallet unavailable', status: 500 };
  }

  const amount = Number(row.amount || 0);
  const fundCheck = await ensurePatientBalance(fhirPatientId, walletResult.walletId, amount);
  if (!fundCheck.ok) {
    return {
      success: false,
      error: fundCheck.error,
      status: 400,
      current_balance: fundCheck.balance,
      required: amount,
    };
  }

  const transferResult = await withCircleTimeout(
    CircleService.createTransfer({
    fromWalletId: walletResult.walletId,
    toWalletId: providerWalletId,
    amount,
    currency: 'USDC',
    claimId: row.journey_id || row.id,
    description: `RCM patient payment ${row.id}`,
    }),
    'USDC transfer'
  );

  if (!transferResult.success) {
    return {
      success: false,
      error: transferResult.error || 'USDC transfer failed',
      status: 502,
    };
  }

  const transferId = `rcm_xfer_${uuidv4()}`;
  if (db.createCircleTransfer) {
    db.createCircleTransfer({
      id: transferId,
      claim_id: null,
      from_wallet_id: walletResult.walletId,
      to_wallet_id: providerWalletId,
      amount,
      currency: 'USDC',
      circle_transfer_id: transferResult.transferId || transferResult.transactionId,
      status: transferResult.status || 'pending',
      created_at: new Date().toISOString(),
    });
  }

  return markPaid(row, {
    method: 'usdc',
    circleTransferId: transferResult.transferId || transferResult.transactionId,
    note: 'USDC transfer from patient wallet to provider clinic wallet',
  });
}

async function createStripeIntent(token) {
  const row = loadPaymentByToken(token);
  if (!row) return { success: false, error: 'Payment not found', status: 404 };
  if (row.status === 'paid') {
    return { success: false, error: 'Payment already completed', status: 409 };
  }

  const stripe = stripeClient();
  if (!stripe) {
    return { success: false, error: 'Stripe is not configured', status: 503 };
  }

  const amountCents = Math.round(Number(row.amount || 0) * 100);
  if (!(amountCents > 0)) {
    return { success: false, error: 'Invalid payment amount', status: 400 };
  }

  const paymentIntent = await withCircleTimeout(
    stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: {
      rcm_payment_id: row.id,
      pay_token: row.pay_token,
      clinic_id: String(row.clinic_id || ''),
      journey_id: String(row.journey_id || ''),
    },
    description: `RCM balance payment ${row.id}`,
    }),
    'Stripe PaymentIntent create'
  );

  db.db
    .prepare(`UPDATE rcm_payments SET stripe_payment_intent_id = ? WHERE pay_token = ?`)
    .run(paymentIntent.id, row.pay_token);

  return {
    success: true,
    payment_intent_id: paymentIntent.id,
    client_secret: paymentIntent.client_secret,
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
  };
}

async function settleStripe(token, paymentIntentId) {
  const row = loadPaymentByToken(token);
  if (!row) return { success: false, error: 'Payment not found', status: 404 };
  if (row.status === 'paid') return markPaid(row, { method: row.method || 'stripe' });

  const stripe = stripeClient();
  if (!stripe) {
    return { success: false, error: 'Stripe is not configured', status: 503 };
  }

  const piId = paymentIntentId || row.stripe_payment_intent_id;
  if (!piId) {
    return { success: false, error: 'payment_intent_id is required', status: 400 };
  }

  const intent = await stripe.paymentIntents.retrieve(piId);
  if (intent.metadata?.rcm_payment_id && intent.metadata.rcm_payment_id !== row.id) {
    return { success: false, error: 'PaymentIntent does not match this pay link', status: 400 };
  }
  if (intent.metadata?.pay_token && intent.metadata.pay_token !== row.pay_token) {
    return { success: false, error: 'PaymentIntent token mismatch', status: 400 };
  }

  if (intent.status !== 'succeeded') {
    return {
      success: false,
      error: `Payment not completed (status: ${intent.status})`,
      status: 402,
      payment_status: intent.status,
    };
  }

  return markPaid(row, {
    method: 'stripe',
    stripePaymentIntentId: piId,
    note: 'Stripe card payment confirmed',
  });
}

function markPaidProvider(row, { method, note } = {}) {
  if (!row?.pay_token) {
    const err = new Error('Payment missing pay_token');
    err.status = 400;
    throw err;
  }
  return markPaid(row, { method: method || 'manual', note: note || 'Provider marked paid' });
}

module.exports = {
  getPaymentContext,
  settleUsdc,
  createStripeIntent,
  settleStripe,
  markPaidProvider,
  resolveFhirPatientId,
  getProviderWalletId,
};
