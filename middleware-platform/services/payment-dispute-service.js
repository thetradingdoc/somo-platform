'use strict';

const db = require('../database');
const FinancialIntegrityService = require('./financial-integrity-service');
const { getPaymentExceptionOwners } = require('./payment-exception-ownership');

function getStripeClient() {
  const stripeConfig = require('../utils/stripe-config');
  return stripeConfig.initializeStripe();
}

function mapStripeToWorkflow(stripeStatus) {
  const s = String(stripeStatus || '').toLowerCase();
  if (['warning_needs_response', 'needs_response'].includes(s)) return 'needs_response';
  if (s === 'under_review') return 'under_review';
  if (s === 'won') return 'won';
  if (s === 'lost') return 'lost';
  if (s === 'charge_refunded' || s === 'warning_closed') return 'closed';
  return 'open';
}

function evidenceDueIso(dispute) {
  const due = dispute?.evidence_details?.due_by;
  if (!due) return null;
  if (typeof due === 'number') return new Date(due * 1000).toISOString();
  return String(due);
}

/**
 * Intake / update from Stripe dispute object (charge.dispute.* webhooks).
 */
function upsertFromStripeDispute(dispute) {
  if (!dispute || !dispute.id) return null;

  try {
    FinancialIntegrityService.recordStripeDisputeReconciliation(dispute);
  } catch (e) {
    console.warn('[PaymentDispute] financial integrity (non-fatal):', e.message);
  }

  const owners = getPaymentExceptionOwners();
  const workflow_status = mapStripeToWorkflow(dispute.status);
  const rawPi = dispute.payment_intent;
  const paymentIntentId = typeof rawPi === 'string' ? rawPi : rawPi?.id || null;
  const prior = db.getPaymentDisputeByStripeId(dispute.id);

  const row = {
    stripe_dispute_id: dispute.id,
    charge_id: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id || null,
    payment_intent_id: paymentIntentId,
    amount: (Number(dispute.amount || 0) || 0) / 100,
    currency: (dispute.currency || 'usd').toUpperCase(),
    stripe_status: dispute.status || null,
    workflow_status,
    owner: prior && prior.owner ? prior.owner : owners.primary || null,
    backup_owner: prior && prior.backup_owner ? prior.backup_owner : owners.backup || null,
    evidence_due_at: evidenceDueIso(dispute),
    metadata: {
      reason: dispute.reason || null,
      network_reason_code: dispute.network_reason_code || null,
      balance_transactions: dispute.balance_transactions || null
    }
  };

  return db.upsertPaymentDispute(row);
}

function listDisputes(options = {}) {
  return db.listPaymentDisputes(options);
}

function assignDispute(id, { owner, backup_owner, workflow_status } = {}) {
  return db.updatePaymentDispute(id, { owner, backup_owner, workflow_status });
}

/**
 * Submit evidence to Stripe and sync local workflow/state.
 */
async function submitDisputeEvidence(id, { evidence = {}, submit = false } = {}) {
  const row = db.getPaymentDispute(id);
  if (!row) {
    const err = new Error('Dispute not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const stripe = getStripeClient();
  const updatedStripe = await stripe.disputes.update(row.stripe_dispute_id, {
    evidence,
    submit: !!submit
  });

  const synced = upsertFromStripeDispute(updatedStripe);
  if (!synced) return null;

  let currentMeta = {};
  try {
    currentMeta = synced.metadata ? JSON.parse(synced.metadata) : {};
  } catch (_) {
    currentMeta = {};
  }

  db.updatePaymentDispute(synced.id, {
    workflow_status: submit ? 'under_review' : synced.workflow_status,
    metadata: {
      ...currentMeta,
      last_evidence_submit_at: new Date().toISOString(),
      last_evidence_submit: {
        keys: Object.keys(evidence || {}),
        submit: !!submit
      }
    }
  });

  return db.getPaymentDispute(synced.id);
}

module.exports = {
  upsertFromStripeDispute,
  mapStripeToWorkflow,
  listDisputes,
  assignDispute,
  submitDisputeEvidence
};
