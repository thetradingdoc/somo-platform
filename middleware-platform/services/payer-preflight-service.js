'use strict';

/**
 * NYC pilot payer preflight — top-5 dental payers readiness (EO-P1-2).
 */

const { DENTAL_PAYERS } = require('../seeds/dental-payer-rules');

const TOP_N = Number(process.env.PAYER_PREFLIGHT_TOP_N || 5);

function getTopDentalPayers(limit = TOP_N) {
  return DENTAL_PAYERS.slice(0, limit);
}

function assessPayerReadiness(db, { clinicId, customerId } = {}) {
  const payers = getTopDentalPayers();
  return payers.map((payer) => {
    let recentChecks = 0;
    let thinCount = 0;
    if (db?.db && clinicId) {
      try {
        const row = db.db
          .prepare(
            `
            SELECT COUNT(*) AS total,
              SUM(CASE WHEN eligibility_quality = 'thin' THEN 1 ELSE 0 END) AS thin
            FROM eligibility_checks
            WHERE payer_id = ? AND created_at >= datetime('now', '-30 days')
          `
          )
          .get(payer.id);
        recentChecks = row?.total || 0;
        thinCount = row?.thin || 0;
      } catch (_) {}
    }
    const thinRate = recentChecks > 0 ? Math.round((thinCount / recentChecks) * 100) : null;
    return {
      payer_id: payer.id,
      payer_name: payer.name,
      enrolled: true,
      recent_checks_30d: recentChecks,
      thin_rate_pct: thinRate,
      status: recentChecks === 0 ? 'untested' : thinRate >= 20 ? 'watch' : 'ok',
      clinic_id: clinicId || null,
      customer_id: customerId || null
    };
  });
}

module.exports = { getTopDentalPayers, assessPayerReadiness, TOP_N };
