'use strict';

/**
 * CDT placeholder descriptions from seed stubs (e.g. "diagnostic procedure D0100").
 * Non-placeholder = description does not match this pattern family.
 */
const CDT_PLACEHOLDER_RE = /^[a-z]+ procedure D\d{4}$/i;

/** Tier-2 synthesized range fill from import-cdt-codes.js (e.g. "Endodontics — ADA CDT D3310"). */
const CDT_SYNTHETIC_TIER2_RE = /^[A-Za-z ]+ — ADA CDT D\d{4}$/;

function isCdtPlaceholderDescription(description) {
  const desc = String(description || '').trim();
  if (!desc) return true;
  return CDT_PLACEHOLDER_RE.test(desc);
}

function isCdtSyntheticTier2Description(description) {
  const desc = String(description || '').trim();
  if (!desc) return false;
  return CDT_SYNTHETIC_TIER2_RE.test(desc);
}

function isCdtLicensedQualityDescription(description) {
  const desc = String(description || '').trim();
  if (!desc) return false;
  return !isCdtPlaceholderDescription(desc) && !isCdtSyntheticTier2Description(desc);
}

function cdtQualityFromRows(rows) {
  const total = rows.length;
  const placeholder = rows.filter((r) => isCdtPlaceholderDescription(r.description)).length;
  const syntheticTier2 = rows.filter((r) => isCdtSyntheticTier2Description(r.description)).length;
  const licensedQuality = rows.filter((r) => isCdtLicensedQualityDescription(r.description)).length;
  const nonPlaceholder = total - placeholder;
  const qualityRatio = total ? nonPlaceholder / total : 0;
  const licensedRatio = total ? licensedQuality / total : 0;
  return {
    total,
    placeholder,
    synthetic_tier2: syntheticTier2,
    licensed_quality: licensedQuality,
    non_placeholder: nonPlaceholder,
    quality_ratio: qualityRatio,
    licensed_quality_ratio: licensedRatio
  };
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
  CDT_SYNTHETIC_TIER2_RE,
  isCdtPlaceholderDescription,
  isCdtSyntheticTier2Description,
  isCdtLicensedQualityDescription,
  cdtQualityFromRows,
  cdtQualityFromDb
};
