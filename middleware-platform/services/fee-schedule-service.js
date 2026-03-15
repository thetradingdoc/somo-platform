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
 * 
 * Fee Schedule Freshness:
 * - Tracks staleness via updated_at timestamp
 * - Flags stale rates (>90 days old) for refresh
 * - Prevents silent EOB corruption from outdated rates
 */

const db = require('../database');
const cache = require('./cache-service');

// Staleness threshold: rates older than this are considered stale (configurable)
const FEE_SCHEDULE_STALE_DAYS = parseFloat(process.env.FEE_SCHEDULE_STALE_DAYS || '90');

/**
 * Check if a fee schedule rate is stale (older than threshold).
 *
 * @param {Object} rate - Fee schedule row from database
 * @returns {boolean} True if rate is stale
 */
function isRateStale(rate) {
  if (!rate || !rate.updated_at) return false;
  const updatedDate = new Date(rate.updated_at);
  const staleThreshold = new Date(Date.now() - FEE_SCHEDULE_STALE_DAYS * 24 * 60 * 60 * 1000);
  return updatedDate < staleThreshold;
}

/**
 * Get allowed amount for a CPT code from payer fee schedule.
 * Warns if rate is stale to prevent silent EOB corruption.
 *
 * @param {string} payerId - Payer ID (e.g. BCBS, AETNA)
 * @param {string} cptCode - CPT code
 * @param {string} dateOfService - YYYY-MM-DD (optional)
 * @returns {number|null} Allowed amount or null if not in fee schedule
 */
function getAllowedAmount(payerId, cptCode, dateOfService = null) {
  const row = db.getFeeScheduleRate?.(payerId, cptCode, dateOfService);
  if (!row || row.allowed_amount == null) return null;
  
  // Check for staleness
  if (isRateStale(row)) {
    console.warn(`⚠️  Stale fee schedule rate detected: ${payerId}/${cptCode} (last updated: ${row.updated_at})`);
    console.warn(`   Consider refreshing fee schedule to prevent EOB calculation errors`);
  }
  
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
    
    // Warn if using stale rate (prevents silent EOB corruption)
    if (isRateStale(row)) {
      console.warn(`⚠️  Using stale fee schedule rate for EOB calculation: ${payerId}/${cptCode} (updated: ${row.updated_at})`);
    }
    
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

/**
 * Find stale fee schedules (rates older than threshold).
 * Used by refresh jobs and admin endpoints.
 *
 * @param {string} [payerId] - Optional payer ID filter
 * @param {number} [olderThanDays] - Staleness threshold (default: FEE_SCHEDULE_STALE_DAYS)
 * @returns {Array} Array of stale fee schedule records
 */
function getStaleFeeSchedules(payerId = null, olderThanDays = FEE_SCHEDULE_STALE_DAYS) {
  try {
    const staleThreshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    
    let query = `
      SELECT * FROM fee_schedules
      WHERE datetime(updated_at) < datetime(?)
    `;
    const params = [staleThreshold];
    
    if (payerId) {
      query += ` AND payer_id = ?`;
      params.push(payerId.toUpperCase());
    }
    
    query += ` ORDER BY updated_at ASC`;
    
    const stmt = db.prepare(query);
    return stmt.all(...params);
  } catch (error) {
    console.error('❌ Error finding stale fee schedules:', error);
    return [];
  }
}

/**
 * Get freshness summary for a payer's fee schedule.
 *
 * @param {string} payerId - Payer ID
 * @returns {Object} { totalRates, staleRates, oldestUpdate, newestUpdate, freshnessStatus }
 */
function getFeeScheduleFreshness(payerId) {
  try {
    const allRates = db.getFeeSchedulesByPayer?.(payerId, 10000) || [];
    const staleRates = allRates.filter(rate => isRateStale(rate));
    
    const updateDates = allRates
      .map(r => r.updated_at ? new Date(r.updated_at) : null)
      .filter(d => d !== null);
    
    const oldestUpdate = updateDates.length > 0 ? new Date(Math.min(...updateDates.map(d => d.getTime()))) : null;
    const newestUpdate = updateDates.length > 0 ? new Date(Math.max(...updateDates.map(d => d.getTime()))) : null;
    
    const stalePercent = allRates.length > 0 ? (staleRates.length / allRates.length) * 100 : 0;
    const freshnessStatus = stalePercent > 50 ? 'critical' : stalePercent > 25 ? 'warning' : 'fresh';
    
    return {
      payerId: payerId,
      totalRates: allRates.length,
      staleRates: staleRates.length,
      stalePercent: Math.round(stalePercent * 100) / 100,
      oldestUpdate: oldestUpdate?.toISOString() || null,
      newestUpdate: newestUpdate?.toISOString() || null,
      freshnessStatus: freshnessStatus,
      needsRefresh: staleRates.length > 0
    };
  } catch (error) {
    console.error(`❌ Error getting fee schedule freshness for ${payerId}:`, error);
    return {
      payerId: payerId,
      totalRates: 0,
      staleRates: 0,
      freshnessStatus: 'unknown',
      error: error.message
    };
  }
}

/**
 * Mark fee schedule rates as refreshed (update updated_at timestamp).
 * Used after bulk refresh operations.
 *
 * @param {string} payerId - Payer ID
 * @param {Array} cptCodes - CPT codes that were refreshed (optional, if empty updates all for payer)
 * @returns {number} Number of rates updated
 */
function markFeeScheduleRefreshed(payerId, cptCodes = []) {
  try {
    const now = new Date().toISOString();
    let query = `UPDATE fee_schedules SET updated_at = ? WHERE payer_id = ?`;
    const params = [now, payerId.toUpperCase()];
    
    if (cptCodes.length > 0) {
      const placeholders = cptCodes.map(() => '?').join(',');
      query += ` AND cpt_code IN (${placeholders})`;
      params.push(...cptCodes.map(c => c.toUpperCase()));
    }
    
    const stmt = db.prepare(query);
    const result = stmt.run(...params);
    return result.changes || 0;
  } catch (error) {
    console.error(`❌ Error marking fee schedule refreshed:`, error);
    return 0;
  }
}

module.exports = {
  getAllowedAmount,
  getAllowedAmountsForCodes,
  getAllowedAmountsAndNetworkForCodes,
  resolveAllowedAmount,
  resolveAllowedAmountAndNetwork,
  hasFeeScheduleForPayer,
  getStaleFeeSchedules,
  getFeeScheduleFreshness,
  markFeeScheduleRefreshed,
  isRateStale,
  FEE_SCHEDULE_STALE_DAYS
};
