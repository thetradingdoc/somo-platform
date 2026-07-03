'use strict';

const db = require('../../database');
const orchestrator = require('../../services/rcm-journey-orchestrator');
const settlement = require('../../services/rcm-payment-settlement');

describe('rcm payment settlement', () => {
  beforeAll(() => {
    orchestrator.ensureKellyRcmTables();
  });

  test('markPaidProvider advances journey to bill', () => {
    const clinicId = 'clinic-pay-test';
    const { journey } = orchestrator.startJourney({
      clinicId,
      skipGates: true,
      stage: 'patient_collection',
    });
    const payToken = `tok_${Date.now()}`;
    const payId = `pay_${Date.now()}`;
    db.db
      .prepare(
        `INSERT INTO rcm_payments (id, clinic_id, journey_id, amount, status, pay_token) VALUES (?, ?, ?, ?, 'requested', ?)`
      )
      .run(payId, clinicId, journey.id, 10, payToken);

    const row = db.db.prepare(`SELECT * FROM rcm_payments WHERE id = ?`).get(payId);
    const result = settlement.markPaidProvider(row, { method: 'manual' });
    expect(result.success).toBe(true);
    expect(result.status).toBe('paid');

    const updated = orchestrator.getJourney(clinicId, journey.id);
    expect(updated.stage).toBe('bill');
  });

  test('createStripeIntent reuses existing PaymentIntent when retryable', async () => {
    const clinicId = 'clinic-pay-retry';
    const { journey } = orchestrator.startJourney({
      clinicId,
      skipGates: true,
      stage: 'patient_collection'
    });
    const payToken = `tok_retry_${Date.now()}`;
    const payId = `pay_retry_${Date.now()}`;
    const piId = 'pi_test_retry_existing';
    db.db
      .prepare(
        `INSERT INTO rcm_payments (id, clinic_id, journey_id, amount, status, pay_token, stripe_payment_intent_id)
         VALUES (?, ?, ?, ?, 'requested', ?, ?)`
      )
      .run(payId, clinicId, journey.id, 25, payToken, piId);

    const mockRetrieve = jest.fn().mockResolvedValue({
      id: piId,
      status: 'requires_payment_method',
      client_secret: 'cs_test_retry'
    });
    const mockCreate = jest.fn();
    const stripeConfig = require('../../utils/stripe-config');
    const origInit = stripeConfig.initializeStripe;
    stripeConfig.initializeStripe = () => ({
      paymentIntents: { retrieve: mockRetrieve, create: mockCreate }
    });
    stripeConfig.getStripePublishableKey = () => 'pk_test';

    try {
      const result = await settlement.createStripeIntent(payToken);
      expect(result.success).toBe(true);
      expect(result.reused).toBe(true);
      expect(result.payment_intent_id).toBe(piId);
      expect(mockRetrieve).toHaveBeenCalledWith(piId);
      expect(mockCreate).not.toHaveBeenCalled();
    } finally {
      stripeConfig.initializeStripe = origInit;
    }
  });

  test('createStripeIntent fails closed when PI retrieve throws', async () => {
    const clinicId = 'clinic-pay-retrieve-fail';
    const { journey } = orchestrator.startJourney({
      clinicId,
      skipGates: true,
      stage: 'patient_collection'
    });
    const payToken = `tok_retrieve_fail_${Date.now()}`;
    const payId = `pay_retrieve_fail_${Date.now()}`;
    const piId = 'pi_test_retrieve_fail';
    db.db
      .prepare(
        `INSERT INTO rcm_payments (id, clinic_id, journey_id, amount, status, pay_token, stripe_payment_intent_id)
         VALUES (?, ?, ?, ?, 'requested', ?, ?)`
      )
      .run(payId, clinicId, journey.id, 30, payToken, piId);

    const mockRetrieve = jest.fn().mockRejectedValue(new Error('stripe unavailable'));
    const mockCreate = jest.fn();
    const stripeConfig = require('../../utils/stripe-config');
    const origInit = stripeConfig.initializeStripe;
    stripeConfig.initializeStripe = () => ({
      paymentIntents: { retrieve: mockRetrieve, create: mockCreate }
    });
    stripeConfig.getStripePublishableKey = () => 'pk_test';

    try {
      const result = await settlement.createStripeIntent(payToken);
      expect(result.success).toBe(false);
      expect(result.status).toBe(503);
      expect(result.error).toMatch(/verify existing payment intent/i);
      expect(mockRetrieve).toHaveBeenCalledWith(piId);
      expect(mockCreate).not.toHaveBeenCalled();
    } finally {
      stripeConfig.initializeStripe = origInit;
    }
  });
});
