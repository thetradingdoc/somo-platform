'use strict';

/**
 * CDT placeholder descriptions from seed stubs (e.g. "diagnostic procedure D0100").
 * Non-placeholder = description does not match this pattern family.
 */
const CDT_PLACEHOLDER_RE = /^[a-z]+ procedure D\d{4}$/i;

function isCdtPlaceholderDescription(description) {
  const desc = String(description || '').trim();
  if (!desc) return true;
  return CDT_PLACEHOLDER_RE.test(desc);
}

function cdtQualityFromRows(rows) {
  const total = rows.length;
  const placeholder = rows.filter((r) => isCdtPlaceholderDescription(r.description)).length;
  const nonPlaceholder = total - placeholder;
  const qualityRatio = total ? nonPlaceholder / total : 0;
  return { total, placeholder, non_placeholder: nonPlaceholder, quality_ratio: qualityRatio };
}

function cdtQualityFromDb(db) {
  let rows = [];
  try {
    rows = db.prepare('SELECT description FROM cdt_codes').all();
  } catch (_) {
    rows = [];
  }
  return cdtQualityFromRows(rows);
}

module.exports = {
  CDT_PLACEHOLDER_RE,
  isCdtPlaceholderDescription,
  cdtQualityFromRows,
  cdtQualityFromDb
};
