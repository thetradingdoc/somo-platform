const LedgerService = require('./ledger-service');
const db = require('../database');

const RAIL_TYPES = {
  CASH: 'cash',
  HYBRID: 'hybrid',
  INSURANCE: 'insurance'
};

const RAIL_STATE = {
  INTENT_CREATED: 'intent_created',
  AUTHORIZED: 'authorized',
  PENDING: 'pending',
  SETTLED: 'settled',
  FAILED: 'failed',
  REFUNDED: 'refunded'
};

class PaymentRailsService {
  /**
   * Cash rail: patient pays provider via Stripe card.
   * Creates patient/provider ledger accounts (railType=stripe) and posts pending entries.
   */
  static createCashRailIntent({ patientId, providerId, amount, currency = 'USD', stripePaymentIntentId }) {
    const patientAcct = LedgerService.ensureAccount({
      ownerType: 'patient',
      ownerId: patientId,
      currency,
      railType: 'stripe'
    });
    const providerAcct = LedgerService.ensureAccount({
      ownerType: 'provider',
      ownerId: providerId,
      currency,
      railType: 'stripe'
    });

    const externalRefType = 'stripe_payment_intent';
    const externalRefId = stripePaymentIntentId;
    const description = `Cash rail (Stripe) payment intent ${stripePaymentIntentId}`;

    const { debitEntry, creditEntry } = LedgerService.transfer({
      fromAccount: patientAcct,
      toAccount: providerAcct,
      amount,
      currency,
      externalRefType,
      externalRefId,
      description
    });

    db.insertFinancialEvent({
      event_type: 'payment_intent',
      actor_type: 'patient',
      actor_id: patientId,
      amount,
      currency,
      rail_type: RAIL_TYPES.CASH,
      status: RAIL_STATE.INTENT_CREATED,
      cause: 'voice_or_web_checkout',
      metadata: { stripe_payment_intent_id: stripePaymentIntentId, provider_id: providerId }
    });

    return { patientAcct, providerAcct, debitEntry, creditEntry, state: RAIL_STATE.INTENT_CREATED };
  }

  /**
   * Hybrid rail: copay via Stripe, insurer portion via Circle.
   * Returns ledger entries for both segments; actual rail calls happen elsewhere.
   */
  static createHybridRailIntent({ patientId, providerId, insurerId, copayAmount, insurerAmount, currency = 'USD', stripePaymentIntentId, circleClaimRef }) {
    const results = {};

    if (copayAmount && copayAmount > 0) {
      results.copay = this.createCashRailIntent({
        patientId,
        providerId,
        amount: copayAmount,
        currency,
        stripePaymentIntentId
      });
    }

    if (insurerAmount && insurerAmount > 0) {
      const insurerAcct = LedgerService.ensureAccount({
        ownerType: 'insurer',
        ownerId: insurerId,
        currency,
        railType: 'circle'
      });
      const providerAcctCircle = LedgerService.ensureAccount({
        ownerType: 'provider',
        ownerId: providerId,
        currency,
        railType: 'circle'
      });

      const externalRefType = 'circle_transfer';
      const externalRefId = circleClaimRef;
      const description = `Hybrid rail insurer portion for claim ${circleClaimRef}`;

      const { debitEntry, creditEntry } = LedgerService.transfer({
        fromAccount: insurerAcct,
        toAccount: providerAcctCircle,
        amount: insurerAmount,
        currency,
        externalRefType,
        externalRefId,
        description
      });

      db.insertFinancialEvent({
        event_type: 'circle_transfer',
        actor_type: 'insurer',
        actor_id: insurerId,
        amount: insurerAmount,
        currency,
        rail_type: RAIL_TYPES.HYBRID,
        status: RAIL_STATE.INTENT_CREATED,
        cause: 'pre_adjudication_settlement',
        metadata: { provider_id: providerId, claim_ref: circleClaimRef }
      });

      results.insurer = { insurerAcct, providerAcctCircle, debitEntry, creditEntry, state: RAIL_STATE.INTENT_CREATED };
    }

    return results;
  }

  /**
   * Insurance-only rail: insurer pays provider (optionally via escrow) using Circle.
   */
  static createInsuranceRailIntent({ insurerId, providerId, amount, currency = 'USD', claimRef }) {
    const insurerAcct = LedgerService.ensureAccount({
      ownerType: 'insurer',
      ownerId: insurerId,
      currency,
      railType: 'circle'
    });
    const providerAcct = LedgerService.ensureAccount({
      ownerType: 'provider',
      ownerId: providerId,
      currency,
      railType: 'circle'
    });

    const externalRefType = 'circle_transfer';
    const externalRefId = claimRef;
    const description = `Insurance-only rail payment for claim ${claimRef}`;

    const { debitEntry, creditEntry } = LedgerService.transfer({
      fromAccount: insurerAcct,
      toAccount: providerAcct,
      amount,
      currency,
      externalRefType,
      externalRefId,
      description
    });

    db.insertFinancialEvent({
      event_type: 'circle_transfer',
      actor_type: 'insurer',
      actor_id: insurerId,
      amount,
      currency,
      rail_type: RAIL_TYPES.INSURANCE,
      status: RAIL_STATE.INTENT_CREATED,
      cause: 'pre_adjudication_settlement',
      metadata: { provider_id: providerId, claim_ref: claimRef }
    });

    return { insurerAcct, providerAcct, debitEntry, creditEntry, state: RAIL_STATE.INTENT_CREATED };
  }

  /**
   * Mark a rail intent as settled when the underlying rail confirms.
   */
  static markSettled(externalRefType, externalRefId, statusMeta) {
    const count = LedgerService.settleByExternalRef(externalRefType, externalRefId);
    db.insertFinancialEvent({
      event_type: externalRefType,
      actor_type: statusMeta?.actor_type || null,
      actor_id: statusMeta?.actor_id || null,
      amount: statusMeta?.amount || null,
      currency: statusMeta?.currency || null,
      rail_type: statusMeta?.rail_type || null,
      status: RAIL_STATE.SETTLED,
      cause: 'rail_confirmation',
      metadata: { external_ref_id: externalRefId, settled_entries: count }
    });
    return count;
  }
}

module.exports = {
  PaymentRailsService,
  RAIL_TYPES,
  RAIL_STATE
};

