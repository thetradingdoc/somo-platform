/**
 * Fee Schedule Service
 * Provides payer-specific allowed amounts for CPT codes.
 * Enables real-time adjudication when fee schedule data is available.
 *
 * Data sources (as they become available):
 * 1. Local DB (fee_schedules) - manual/bulk upload
 * 2. Future: Payer API adapters, 835 ERA import
 *
 * Phase 3.3: Results cached (payer guidelines 7d, pricing 24h).
 */

const db = require('../database');
const cache = require('./cache-service');

/**
 * Get allowed amount for a CPT code from payer fee schedule.
 *
 * @param {string} payerId - Payer ID (e.g. BCBS, AETNA)
 * @param {string} cptCode - CPT code
 * @param {string} dateOfService - YYYY-MM-DD (optional)
 * @returns {number|null} Allowed amount or null if not in fee schedule
 */
function getAllowedAmount(payerId, cptCode, dateOfService = null) {
  const row = db.getFeeScheduleRate?.(payerId, cptCode, dateOfService);
  if (!row || row.allowed_amount == null) return null;
  return parseFloat(row.allowed_amount);
}

/**
 * Get allowed amounts for multiple CPT codes (batch lookup).
 * Cached 24h by payer + sorted codes + date (Phase 3.3).
 *
 * @param {string} payerId - Payer ID
 * @param {string[]} cptCodes - CPT codes
 * @param {string} dateOfService - YYYY-MM-DD (optional)
 * @returns {Object} Map of cptCode -> allowedAmount (only for codes with data)
 */
function getAllowedAmountsForCodes(payerId, cptCodes = [], dateOfService = null) {
  const key = [payerId, [...cptCodes].sort().join(','), dateOfService || ''].join('|');
  const cached = cache.get('payer_pricing', key);
  if (cached) return cached;

  const result = {};
  for (const code of cptCodes) {
    const amt = getAllowedAmount(payerId, code, dateOfService);
    if (amt != null) result[code] = amt;
  }
  cache.set('payer_pricing', result, key);
  return result;
}

/**
 * Get allowed amounts and in-network status for multiple CPT codes (Tiba spec: f^P_i, n_i).
 * Used by coding pipeline when payerId provided.
 *
 * @param {string} payerId - Payer ID
 * @param {string[]} cptCodes - CPT codes
 * @param {string} dateOfService - YYYY-MM-DD (optional)
 * @param {Object} billedAmounts - Optional map cptCode -> billedAmount for fallback
 * @returns {Object} Map of cptCode -> { allowedAmount, inNetwork }
 */
function getAllowedAmountsAndNetworkForCodes(payerId, cptCodes = [], dateOfService = null, billedAmounts = {}) {
  const result = {};
  for (const code of cptCodes) {
    const row = db.getFeeScheduleRate?.(payerId, code, dateOfService);
    const billed = billedAmounts[code] || 0;
    if (row && row.allowed_amount != null && parseFloat(row.allowed_amount) >= 0) {
      result[code] = {
        allowedAmount: Math.round(parseFloat(row.allowed_amount) * 100) / 100,
        inNetwork: row.in_network !== false
      };
    } else if (billed > 0) {
      result[code] = {
        allowedAmount: Math.round(billed * 0.85 * 100) / 100,
        inNetwork: true
      };
    } else {
      result[code] = { allowedAmount: null, inNetwork: true };
    }
  }
  return result;
}

/**
 * Resolve allowed amount: fee schedule first, else fallback (billed * percentage).
 * Used by EOB calculation for real-time adjudication.
 *
 * @param {Object} params
 * @param {string} params.payerId - Payer ID
 * @param {string} params.cptCode - CPT code
 * @param {number} params.billedAmount - Billed amount
 * @param {string} params.dateOfService - YYYY-MM-DD (optional)
 * @param {boolean} params.inNetwork - In-network (default true)
 * @returns {number} Allowed amount
 */
function resolveAllowedAmount({ payerId, cptCode, billedAmount, dateOfService = null, inNetwork = true }) {
  const res = resolveAllowedAmountAndNetwork({ payerId, cptCode, billedAmount, dateOfService, inNetwork });
  return res.allowedAmount;
}

/**
 * Resolve allowed amount and in-network status: fee schedule first, else fallback.
 * Returns both for EOB balance-billing logic (Tiba spec: n_i).
 *
 * @param {Object} params
 * @param {string} params.payerId - Payer ID
 * @param {string} params.cptCode - CPT code
 * @param {number} params.billedAmount - Billed amount
 * @param {string} params.dateOfService - YYYY-MM-DD (optional)
 * @param {boolean} params.inNetwork - Default in-network when not in fee schedule (default true)
 * @returns {{ allowedAmount: number, inNetwork: boolean }}
 */
function resolveAllowedAmountAndNetwork({ payerId, cptCode, billedAmount, dateOfService = null, inNetwork = true }) {
  const row = db.getFeeScheduleRate?.(payerId, cptCode, dateOfService);
  if (row && row.allowed_amount != null && parseFloat(row.allowed_amount) >= 0) {
    const amt = Math.round(parseFloat(row.allowed_amount) * 100) / 100;
    const net = row.in_network !== false;
    return { allowedAmount: amt, inNetwork: net };
  }

  // Fallback: percentage of billed (legacy behavior)
  const pct = inNetwork ? 0.85 : 0.70;
  const amt = Math.round((billedAmount || 0) * pct * 100) / 100;
  return { allowedAmount: amt, inNetwork };
}

/**
 * Check if payer has fee schedule data.
 * Cached 7 days (Phase 3.3).
 */
function hasFeeScheduleForPayer(payerId) {
  const cached = cache.get('payer_guidelines', payerId);
  if (typeof cached === 'boolean') return cached;

  const rows = db.getFeeSchedulesByPayer?.(payerId, 1) || [];
  const has = rows.length > 0;
  cache.set('payer_guidelines', has, payerId);
  return has;
}

module.exports = {
  getAllowedAmount,
  getAllowedAmountsForCodes,
  getAllowedAmountsAndNetworkForCodes,
  resolveAllowedAmount,
  resolveAllowedAmountAndNetwork,
  hasFeeScheduleForPayer
};
