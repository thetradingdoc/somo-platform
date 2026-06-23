/**
 * Mastercard Agent Pay Service (PAYMENT_ARCHITECTURE TODO 2)
 *
 * Voice commerce payment protocol from Mastercard.
 * Requires: Mastercard Agent Pay API credentials, partner enrollment.
 *
 * Environment variables (2.1 - credentials):
 *   MASTERCARD_AGENT_PAY_API_URL     - API base URL (sandbox/production)
 *   MASTERCARD_AGENT_PAY_API_KEY     - API key
 *   MASTERCARD_AGENT_PAY_MERCHANT_ID - Merchant ID
 *   MASTERCARD_AGENT_PAY_PARTNER_ID  - Partner ID (if required)
 *
 * Docs: https://developer.mastercard.com/mastercard-checkout-solutions/documentation/use-cases/agent-pay/
 * 2.8 Sandbox: set MASTERCARD_AGENT_PAY_API_URL to Mastercard sandbox base URL
 */

function isConfigured() {
  return !!(
    process.env.MASTERCARD_AGENT_PAY_API_URL &&
    process.env.MASTERCARD_AGENT_PAY_API_KEY
  );
}

/**
 * 2.3 Mandate verification - verify voice commerce mandate for customer
 * @param {Object} params - { customerId, mandateId, customerPhone, customerEmail }
 * @returns {{ valid: boolean, error?: string }}
 */
async function verifyMandate(params = {}) {
  if (!isConfigured()) {
    return { valid: false, error: 'Mastercard Agent Pay not configured. Set MASTERCARD_AGENT_PAY_* env vars.' };
  }

  const apiUrl = process.env.MASTERCARD_AGENT_PAY_API_URL;
  const apiKey = process.env.MASTERCARD_AGENT_PAY_API_KEY;

  try {
    // Mastercard Agent Pay mandate verification endpoint
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/mandates/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Merchant-Id': process.env.MASTERCARD_AGENT_PAY_MERCHANT_ID || ''
      },
      body: JSON.stringify({
        mandate_id: params.mandateId,
        customer_id: params.customerId,
        customer_phone: params.customerPhone,
        customer_email: params.customerEmail
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.warn('⚠️  Mastercard mandate verification failed:', response.status, errBody);
      return { valid: false, error: `Mandate verification failed: ${response.status}` };
    }

    const data = await response.json().catch(() => ({}));
    const valid = data.status === 'active' || data.valid === true || data.mandate_status === 'verified';
    return { valid, mandateDetails: data };
  } catch (err) {
    console.error('❌ Mastercard mandate verification error:', err.message);
    return { valid: false, error: err.message };
  }
}

/**
 * 2.4 Create payment authorization
 * @param {Object} params - { checkoutId, amount, currency, mandateId, merchantId }
 * @returns {{ success: boolean, authorizationId?: string, error?: string }}
 */
async function createAuthorization(params = {}) {
  if (!isConfigured()) {
    return { success: false, error: 'Mastercard Agent Pay not configured' };
  }

  const apiUrl = process.env.MASTERCARD_AGENT_PAY_API_URL;
  const apiKey = process.env.MASTERCARD_AGENT_PAY_API_KEY;
  const merchantId = params.merchantId || process.env.MASTERCARD_AGENT_PAY_MERCHANT_ID;

  const amountCents = Math.round((params.amount || 0) * 100);
  if (amountCents < 1) {
    return { success: false, error: 'Invalid amount' };
  }

  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/authorizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Merchant-Id': merchantId || ''
      },
      body: JSON.stringify({
        mandate_id: params.mandateId,
        amount: amountCents,
        currency: (params.currency || 'USD').toUpperCase(),
        merchant_reference: params.checkoutId,
        metadata: {
          checkout_id: params.checkoutId,
          merchant_id: merchantId
        }
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error || `Authorization failed: ${response.status}`
      };
    }

    return {
      success: true,
      authorizationId: data.authorization_id || data.id,
      status: data.status
    };
  } catch (err) {
    console.error('❌ Mastercard authorization error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 2.5 Process payment - submit transaction via Mastercard API
 * @param {Object} params - { authorizationId, checkoutId, amount, merchantId }
 * @returns {{ success: boolean, transactionId?: string, error?: string }}
 */
async function processPayment(params = {}) {
  if (!isConfigured()) {
    return { success: false, error: 'Mastercard Agent Pay not configured' };
  }

  const apiUrl = process.env.MASTERCARD_AGENT_PAY_API_URL;
  const apiKey = process.env.MASTERCARD_AGENT_PAY_API_KEY;
  const merchantId = params.merchantId || process.env.MASTERCARD_AGENT_PAY_MERCHANT_ID;

  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Merchant-Id': merchantId || ''
      },
      body: JSON.stringify({
        authorization_id: params.authorizationId,
        merchant_reference: params.checkoutId,
        amount: Math.round((params.amount || 0) * 100),
        currency: (params.currency || 'USD').toUpperCase(),
        metadata: {
          checkout_id: params.checkoutId,
          merchant_id: merchantId
        }
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error || `Payment failed: ${response.status}`
      };
    }

    return {
      success: true,
      transactionId: data.transaction_id || data.id,
      status: data.status
    };
  } catch (err) {
    console.error('❌ Mastercard payment error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Full flow: verify mandate -> authorize -> process
 * Use when mandateId is provided (e.g. from voice agent)
 */
async function authorizeAndPay(checkout, merchant, paymentRequest) {
  const mandateId = paymentRequest.metadata?.mandate_id || paymentRequest.payment?.mandate_id;
  const customerPhone = checkout.customer_phone || paymentRequest.customer?.phone;
  const customerEmail = checkout.customer_email || paymentRequest.customer?.email;

  if (!mandateId) {
    return {
      success: false,
      error: 'Mastercard mandate required for voice commerce. Customer must set up voice payment mandate first.'
    };
  }

  const mandateResult = await verifyMandate({
    mandateId,
    customerPhone,
    customerEmail
  });

  if (!mandateResult.valid) {
    return {
      success: false,
      error: mandateResult.error || 'Mandate verification failed'
    };
  }

  const authResult = await createAuthorization({
    checkoutId: checkout.id,
    amount: checkout.amount,
    currency: 'USD',
    mandateId,
    merchantId: merchant?.id
  });

  if (!authResult.success) {
    return { success: false, error: authResult.error };
  }

  const payResult = await processPayment({
    authorizationId: authResult.authorizationId,
    checkoutId: checkout.id,
    amount: checkout.amount,
    merchantId: merchant?.id
  });

  return payResult;
}

module.exports = {
  isConfigured,
  verifyMandate,
  createAuthorization,
  processPayment,
  authorizeAndPay
};
