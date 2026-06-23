'use strict';

const { fetchBeautyFactsByBarcode } = require('./open-beauty-facts-service');

/**
 * Resolve a retail barcode to Open Beauty Facts normalized product (primary free identity source).
 */
async function resolveProductIdentityFromBarcode(barcode) {
  const out = await fetchBeautyFactsByBarcode(barcode);
  if (!out.success || !out.normalized?.found) {
    return { success: false, error: out.error || 'not_found', normalized: null };
  }
  return { success: true, normalized: out.normalized, raw: out.raw };
}

module.exports = { resolveProductIdentityFromBarcode };
