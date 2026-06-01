'use strict';

const CLINIC = process.env.TEST_CLINIC_ID || 'clinic-default';

const CARD_SUCCESS = '4242424242424242';
const CARD_3DS = '4000002500003155';
const CARD_DECLINE = '4000000000000002';

function getBaseUrl() {
  return (process.env.PW_API_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
}

function payUrl(token, base = getBaseUrl()) {
  return `${base.replace(/\/$/, '')}/patients/pay.html?token=${encodeURIComponent(token)}`;
}

async function createPaymentViaKelly({ amount = 25, journeyId, patientId, clinicId = CLINIC } = {}) {
  const KellyToolExecutor = require('../../services/kelly-tool-executor');
  const result = await KellyToolExecutor.execute(
    'request_patient_payment',
    {
      amount,
      journey_id: journeyId,
      patient_id: patientId,
      delivery: 'email',
    },
    {
      sessionId: `e2e_${Date.now()}`,
      clinicId,
      patientId: patientId || null,
      callerPhone: null,
      channel: 'voice',
    }
  );
  if (!result?.success || !result.pay_token) {
    throw new Error(result?.error || 'Kelly request_patient_payment failed');
  }
  return result;
}

async function fillStripeCard(page, cardNumber = CARD_SUCCESS) {
  await page.waitForSelector('iframe[name^="__privateStripeFrame"]', { timeout: 15_000 });

  for (const frame of page.frames()) {
    try {
      const cardInput = frame.locator('input[placeholder="1234 1234 1234 1234"]');
      if (await cardInput.isVisible({ timeout: 500 }).catch(() => false)) {
        await cardInput.fill(cardNumber);
        await frame.locator('input[placeholder="MM / YY"]').fill('12/34');
        await frame.locator('input[placeholder="CVC"]').fill('123');
        await frame.locator('input[placeholder="ZIP"]').fill('10001').catch(() => {});
        return;
      }
    } catch (_) {}
  }

  throw new Error('Stripe card input not found');
}

module.exports = {
  CLINIC,
  CARD_SUCCESS,
  CARD_3DS,
  CARD_DECLINE,
  getBaseUrl,
  payUrl,
  createPaymentViaKelly,
  fillStripeCard,
};
