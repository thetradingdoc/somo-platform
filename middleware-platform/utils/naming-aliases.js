/**
 * Naming alias helpers for safe migration:
 * merchant -> provider, product -> prescription
 */

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function resolveProviderId(input = {}) {
  return pickFirstDefined(input.provider_id, input.merchant_id);
}

function resolvePrescriptionId(input = {}) {
  return pickFirstDefined(input.prescription_id, input.product_id);
}

function withProviderAliases(payload = {}, providerId) {
  return {
    ...payload,
    provider_id: providerId ?? null,
    merchant_id: providerId ?? null
  };
}

function withPrescriptionAliases(payload = {}, prescriptionId) {
  return {
    ...payload,
    prescription_id: prescriptionId ?? null,
    product_id: prescriptionId ?? null
  };
}

function mapProductToPrescription(product = {}) {
  let tags = product.tags;
  if (typeof tags === 'string' && tags.trim().startsWith('[')) {
    try {
      tags = JSON.parse(tags);
    } catch (_) {
      /* keep string */
    }
  }
  return {
    ...product,
    tags,
    prescription_id: product.id,
    provider_id: product.merchant_id,
    prescription_name: product.name
  };
}

function mapProductsToPrescriptions(products = []) {
  return (products || []).map(mapProductToPrescription);
}

/**
 * Merchant order row (merchant_orders): adds provider/prescription aliases.
 */
function mapOrderRow(order = {}) {
  if (!order || typeof order !== 'object') return order;
  return {
    ...order,
    provider_id: order.merchant_id ?? null,
    merchant_id: order.merchant_id ?? null,
    prescription_id: order.product_id ?? null,
    product_id: order.product_id ?? null,
    prescription_name: order.product_name ?? null
  };
}

function mapOrdersRows(orders = []) {
  return (orders || []).map(mapOrderRow);
}

/**
 * Voice checkout row: adds provider/prescription aliases for payment UIs.
 */
function enrichVoiceCheckout(checkout = {}) {
  if (!checkout || typeof checkout !== 'object') return checkout;
  return {
    ...checkout,
    provider_id: checkout.merchant_id ?? null,
    merchant_id: checkout.merchant_id ?? null,
    prescription_id: checkout.product_id ?? null,
    product_id: checkout.product_id ?? null,
    prescription_name: checkout.product_name ?? null
  };
}

/**
 * Merge alias fields into arbitrary payment success payloads (non-destructive).
 */
function withCommercePaymentPayload(payload = {}, checkout = {}) {
  const enriched = enrichVoiceCheckout(checkout);
  const cid = payload.checkout_id ?? enriched.id ?? null;
  return {
    ...payload,
    checkout_id: cid,
    prescription_checkout_id: cid,
    provider_id: enriched.provider_id ?? payload.provider_id ?? null,
    merchant_id: enriched.merchant_id ?? payload.merchant_id ?? null,
    prescription_id: enriched.prescription_id ?? payload.prescription_id ?? null,
    product_id: enriched.product_id ?? payload.product_id ?? null
  };
}

function logAliasUsage(scope, req = {}) {
  const body = req.body || {};
  const query = req.query || {};
  const legacyMerchant = !!(body.merchant_id || query.merchant_id);
  const newProvider = !!(body.provider_id || query.provider_id);
  const legacyProduct = !!(body.product_id || query.product_id);
  const newPrescription = !!(body.prescription_id || query.prescription_id);
  if (!legacyMerchant && !newProvider && !legacyProduct && !newPrescription) return;
  console.log('[naming-aliases]', {
    scope,
    provider_fields: { provider_id: newProvider, merchant_id: legacyMerchant },
    prescription_fields: { prescription_id: newPrescription, product_id: legacyProduct }
  });
}

module.exports = {
  resolveProviderId,
  resolvePrescriptionId,
  withProviderAliases,
  withPrescriptionAliases,
  mapProductToPrescription,
  mapProductsToPrescriptions,
  mapOrderRow,
  mapOrdersRows,
  enrichVoiceCheckout,
  withCommercePaymentPayload,
  logAliasUsage
};
