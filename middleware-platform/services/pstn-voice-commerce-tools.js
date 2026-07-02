'use strict';

const db = require('../database');
const VoiceAdapter = require('../adapters/voice-adapter');
const PaymentOrchestrator = require('./payment-orchestrator');
const PaymentMethodConfig = require('./payment-method-config');
const EmailVerificationService = require('./email-verification-service');
const TrackingService = require('./tracking-service');
const SMSService = require('./sms-service');
const KellyToolExecutor = require('./kelly-tool-executor');

function resolveMerchantId(args, context) {
  return (
    args?.merchant_id ||
    context?.merchantId ||
    KellyToolExecutor._getSessionMeta(context?.sessionId, 'pstn_merchant_id') ||
    null
  );
}

function paymentResponseToPlain(resp) {
  if (!resp) return { success: false, error: 'empty orchestrator response' };
  return {
    success: resp.success === true,
    checkout_id: resp.checkout_id || null,
    payment_token: resp.payment_token || null,
    payment_link: resp.payment_link || null,
    requires_verification: resp.requires_verification === true,
    requires_action: resp.requires_action === true,
    message: resp.message || null,
    error: resp.error || null,
    amount: resp.payment?.amount || null
  };
}

async function searchProducts(args, context) {
  const merchantId = resolveMerchantId(args, context);
  if (!merchantId) {
    return { success: false, error: 'merchant_id is required for product search' };
  }
  const query = String(args?.query || '').trim();
  const products = query
    ? db.searchProducts(query, merchantId)
    : db.getProductsByMerchant(merchantId);
  const voiceProducts = VoiceAdapter.toVoiceFormat(products || []);
  return {
    success: true,
    merchant_id: merchantId,
    query: query || 'all products',
    product_count: voiceProducts.length,
    products: voiceProducts
  };
}

async function createCheckout(args, context) {
  const merchantId = resolveMerchantId(args, context);
  const productId = args?.product_id;
  const customerEmail = args?.customer_email || args?.email;
  const customerName = args?.customer_name || 'Customer';
  const customerPhone = args?.customer_phone || context?.callerPhone || null;
  const quantity = args?.quantity || 1;

  if (!productId) return { success: false, error: 'product_id is required' };
  if (!customerEmail) {
    return {
      success: false,
      error: 'customer_email is required. Please provide your email address.',
      requires_email: true
    };
  }

  if (process.env.PSTN_REPLAY_COMMERCE === '1') {
    try {
      await EmailVerificationService.sendVerificationCode(customerEmail);
      const codeRow = db.db
        ?.prepare?.(
          'SELECT code FROM email_verification_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1'
        )
        ?.get(customerEmail.toLowerCase().trim());
      if (codeRow?.code) {
        await EmailVerificationService.verifyCode(customerEmail, codeRow.code);
      }
    } catch (_) {
      /* best-effort pre-verify for replay */
    }
  }

  const requestData = {
    merchant_id: merchantId,
    customer: {
      name: customerName,
      phone: customerPhone,
      email: customerEmail
    },
    items: [{ product_id: productId, quantity }],
    payment: {
      method: args?.payment_method || 'link',
      currency: 'USD'
    },
    source: {
      protocol: 'voice',
      platform: 'pstn_replay',
      input_type: 'voice'
    },
    metadata: {
      session_id: context?.sessionId || null,
      mandate_id: args?.mandate_id || null
    }
  };

  const resp = await PaymentOrchestrator.createCheckout(requestData);
  const plain = paymentResponseToPlain(resp);
  if (plain.payment_token && context?.sessionId) {
    KellyToolExecutor._setSessionMeta(context.sessionId, 'last_payment_token', plain.payment_token);
  }
  if (plain.checkout_id && context?.sessionId) {
    KellyToolExecutor._setSessionMeta(context.sessionId, 'last_checkout_id', plain.checkout_id);
  }
  if (plain.requires_verification) {
    return {
      ...plain,
      success: true,
      message:
        plain.message ||
        `A verification code has been sent to ${customerEmail}. Please verify your email to complete checkout.`
    };
  }
  return plain;
}

async function getAvailablePaymentMethods(args, context) {
  const merchantId = resolveMerchantId(args, context);
  const { methods, details } = PaymentMethodConfig.getAvailablePaymentMethods(merchantId);
  const labels = {
    link: 'payment link (email)',
    stripe: 'card (Stripe)',
    card_on_file: 'card on file',
    mastercard: 'Mastercard voice pay',
    visa: 'Visa voice pay'
  };
  let cardOnFile = null;
  try {
    const phone = context?.callerPhone || args?.customer_phone || null;
    const email = args?.customer_email || args?.email || null;
    if (phone && db.getCustomerByPhone) {
      const cust = db.getCustomerByPhone(phone);
      if (cust?.stripe_payment_method_id && cust.card_verified === 1) {
        cardOnFile = {
          brand: cust.card_brand || 'card',
          last4: cust.card_last4 || '****'
        };
      }
    }
    if (!cardOnFile && email && db.getCustomerByEmail) {
      const cust = db.getCustomerByEmail(String(email).trim().toLowerCase());
      if (cust?.stripe_payment_method_id && cust.card_verified === 1) {
        cardOnFile = { brand: cust.card_brand || 'card', last4: cust.card_last4 || '****' };
      }
    }
  } catch (_) {}

  const methodList = [...(methods || [])];
  if (cardOnFile && !methodList.includes('card_on_file')) {
    methodList.push('card_on_file');
  }
  const available = methodList.map((m) => {
    if (m === 'card_on_file' && cardOnFile) {
      return `${cardOnFile.brand} ending in ${cardOnFile.last4} on file`;
    }
    return labels[m] || m;
  });
  return {
    success: true,
    payment_methods: methodList,
    card_on_file: cardOnFile,
    available_options: available,
    message:
      available.length > 0
        ? `You can pay via: ${available.join(', ')}.`
        : 'Payment link will be sent to your email.',
    details
  };
}

async function verifyCheckoutCode(args, context) {
  const sessionId = context?.sessionId;
  let paymentToken =
    args?.payment_token ||
    KellyToolExecutor._getSessionMeta(sessionId, 'last_payment_token') ||
    null;
  if (!paymentToken) {
    const checkoutId = KellyToolExecutor._getSessionMeta(sessionId, 'last_checkout_id');
    if (checkoutId && db.getVoiceCheckout) {
      const row = db.getVoiceCheckout(checkoutId);
      paymentToken = row?.payment_token || null;
    }
  }
  const code = args?.verification_code || args?.code;
  if (!paymentToken || !code) {
    return {
      success: false,
      error: 'payment_token and verification_code are required',
      error_code: 'MISSING_VERIFY_FIELDS'
    };
  }

  const tokenRecord = db.getPaymentToken?.(paymentToken);
  if (!tokenRecord) {
    return { success: false, error: 'Invalid token', error_code: 'INVALID_PAYMENT_TOKEN' };
  }
  if ((tokenRecord.verification_code || '').trim() !== String(code).trim()) {
    return {
      success: false,
      error: 'Invalid verification code',
      error_code: 'INVALID_VERIFICATION_CODE'
    };
  }

  return {
    success: true,
    verified: true,
    payment_token: paymentToken,
    message: 'Email verified. Payment link will be sent.'
  };
}

async function getOrderTracking(args, context) {
  let order = null;
  const orderId = args?.order_id;
  const customerEmail = args?.customer_email;
  let customerPhone = args?.customer_phone;
  if (customerPhone) {
    try {
      customerPhone = SMSService.formatPhoneNumber(customerPhone);
    } catch (_) {}
  }

  if (orderId) {
    order = db.getOrder?.(orderId);
  }
  if (!order && (customerEmail || customerPhone)) {
    const allOrders = db.getAllOrders?.() || [];
    const matching = allOrders.filter((o) => {
      const emailMatch =
        customerEmail &&
        o.customer_email &&
        o.customer_email.toLowerCase() === customerEmail.toLowerCase();
      const phoneMatch =
        customerPhone &&
        o.customer_phone &&
        o.customer_phone.replace(/\D/g, '') === String(customerPhone).replace(/\D/g, '');
      return emailMatch || phoneMatch;
    });
    if (matching.length) {
      order = matching.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    }
  }

  if (!order) {
    return {
      success: true,
      found: false,
      message:
        "I couldn't find an order matching that information. Could you please provide your order number or email address?"
    };
  }

  let tracking = null;
  try {
    tracking = TrackingService.getTrackingSummary(order);
  } catch (_) {}

  return {
    success: true,
    found: true,
    order_id: order.id,
    message: tracking?.message || `Order ${order.id} status: ${order.delivery_status || order.status || 'processing'}`,
    delivery_status: order.delivery_status || order.status,
    driver_name: order.driver_name || null,
    estimated_arrival: order.estimated_arrival || null
  };
}

module.exports = {
  searchProducts,
  createCheckout,
  getAvailablePaymentMethods,
  verifyCheckoutCode,
  getOrderTracking,
  resolveMerchantId
};
