/**
 * Heuristics for turning on live camera barcode tracking.
 * Must NOT match normal ingredient-analysis questions (e.g. "are these ingredients good for me?").
 */
export function isProductTrackingIntent(text) {
  const t = String(text || '').toLowerCase();
  if (/\bscan\s+(my|the|your)?\s*(face|skin|selfie|complexion)\b/.test(t)) return false;
  return (
    /\b(scan|barcode|ean|upc)\b/.test(t) ||
    /\bingredients?\s+list\b/.test(t) ||
    /\blist\s+of\s+ingredients\b/.test(t) ||
    /\b(review this product|check this product|analyze this product|what product is this)\b/.test(t)
  );
}
