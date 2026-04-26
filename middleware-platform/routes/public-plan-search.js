const express = require('express');
const router = express.Router();
const db = require('../database');

const NEED_TO_CATEGORY = {
  dental: 'b16_dental',
  hearing: 'b18_hearing_exams_aids',
  vision: 'b17_eye_exams_wear',
  physio: 'b13_other_services',
  chiro: 'b13_other_services',
  ambulance: 'b10_amb_trans',
  preventive: 'b14_preventive',
  specialist: 'b7_health_prof',
  emergency: 'b4_emerg_urgent',
  hospital: 'b1a_inpat_hosp',
  nursing_home: 'b2_snf',
  'nursing-home': 'b2_snf'
};

const NEED_LABELS = {
  dental: 'dental',
  hearing: 'hearing',
  vision: 'vision',
  physio: 'physio',
  chiro: 'chiro',
  ambulance: 'ambulance',
  preventive: 'preventive',
  specialist: 'specialist',
  emergency: 'emergency',
  hospital: 'hospital',
  nursing_home: 'nursing home'
};

function normalizeNeeds(rawNeeds) {
  const arr = Array.isArray(rawNeeds)
    ? rawNeeds
    : String(rawNeeds || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  const out = [];
  for (const n of arr) {
    const key = String(n || '').toLowerCase().replace(/\s+/g, '_');
    if (NEED_TO_CATEGORY[key]) out.push({ need: key, category: NEED_TO_CATEGORY[key] });
  }
  return out;
}

function resolveOrderBy(sortBy) {
  const key = String(sortBy || '').toLowerCase();
  if (key === 'highest_stars') return 'overall_star_rating DESC, monthly_premium ASC';
  if (key === 'lowest_moop') return 'moop_amount ASC, monthly_premium ASC';
  return 'monthly_premium ASC, overall_star_rating DESC';
}

function toBool(v) {
  return Number(v) === 1;
}

function buildNeedDetail(rollup) {
  if (!rollup) return { covered: null, copay_min: null, prior_auth: null, covered_source: 'inferred_null' };
  const covered =
    toBool(rollup.covered_yes) ? true :
      toBool(rollup.covered_no) ? false : null;
  return {
    covered,
    copay_min: rollup.copay_min == null ? null : Number(rollup.copay_min),
    prior_auth: rollup.prior_auth_required == null ? null : toBool(rollup.prior_auth_required),
    covered_source: rollup.covered_source || 'inferred_null'
  };
}

function reasonForNeed(needLabel, detail) {
  if (detail.covered !== true) return null;
  if (detail.copay_min != null) return `Covers ${needLabel} - $${detail.copay_min} copay`;
  return `Covers ${needLabel}`;
}

function buildConfidence(coverageDetailByNeed) {
  const details = Object.values(coverageDetailByNeed || {});
  if (details.some((d) => d.covered === true && d.covered_source === 'bendesc_yn_explicit_1' && d.copay_min != null)) {
    return 'high';
  }
  if (details.some((d) => d.covered === false && d.covered_source === 'bendesc_yn_blank_non_pace' && d.copay_min == null)) {
    return 'medium';
  }
  return 'low';
}

router.get('/search', (req, res) => {
  try {
    const zip = String(req.query.zip || '').trim();
    if (!/^\d{5}$/.test(zip)) {
      return res.status(400).json({ success: false, error: 'zip must be a 5-digit string' });
    }

    const needs = normalizeNeeds(req.query.needs);
    const categories = Array.from(new Set(needs.map((n) => n.category)));
    if (!categories.length) {
      return res.status(400).json({
        success: false,
        error: 'needs is required (e.g. dental,hearing)'
      });
    }

    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '25', 10) || 25, 100));
    const orderBy = resolveOrderBy(req.query.sort_by);

    const zipStateStopgap = zip === '33101' ? 'FL' : null;
    const stateFilterSql = zipStateStopgap ? 'AND sa.state_abbr = ?' : '';
    const categoryPlaceholders = categories.map(() => '?').join(', ');
    const candidateSql = `
      WITH zip_counties AS (
        SELECT DISTINCT county_fips
        FROM zip_county_crosswalk
        WHERE zip_code = ?
      ),
      benefit_any AS (
        SELECT
          contract_id,
          MAX(CASE WHEN covered = 1 THEN 1 ELSE 0 END) AS any_covered
        FROM payor_plan_benefits
        WHERE benefit_category IN (${categoryPlaceholders})
        GROUP BY contract_id
      )
      SELECT
        sa.contract_id,
        pr.org_name AS payer_name,
        pr.plan_name,
        pr.plan_type,
        pr.monthly_consolidated_premium AS monthly_premium,
        pr.overall_star_rating,
        pr.moop_amount,
        sa.state_abbr,
        sa.county_name
      FROM zip_counties zc
      JOIN payor_plan_service_areas sa ON sa.county_fips = zc.county_fips
      JOIN payor_plan_premiums pr ON pr.contract_id = sa.contract_id
      LEFT JOIN benefit_any ba ON ba.contract_id = sa.contract_id
      WHERE pr.monthly_consolidated_premium IS NOT NULL
      ${stateFilterSql}
        AND COALESCE(ba.any_covered, 0) = 1
      ORDER BY ${orderBy}
      LIMIT ?
    `;

    const params = [zip, ...categories];
    if (zipStateStopgap) params.push(zipStateStopgap);
    params.push(limit);
    const rows = db.db.prepare(candidateSql).all(...params);

    const contractIds = Array.from(new Set(rows.map((r) => r.contract_id).filter(Boolean)));
    let rollups = [];
    if (contractIds.length) {
      const contractPlaceholders = contractIds.map(() => '?').join(', ');
      const rollupSql = `
        WITH roll AS (
          SELECT
            contract_id,
            benefit_category,
            MAX(CASE WHEN covered = 1 THEN 1 ELSE 0 END) AS covered_yes,
            MAX(CASE WHEN covered = 0 THEN 1 ELSE 0 END) AS covered_no,
            MIN(copay_min) AS copay_min,
            MAX(CASE WHEN prior_auth_required = 1 THEN 1 ELSE 0 END) AS prior_auth_required,
            MAX(CASE WHEN covered_source = 'bendesc_yn_explicit_1' THEN 1 ELSE 0 END) AS has_explicit_1,
            MAX(CASE WHEN covered_source = 'bendesc_yn_blank_non_pace' THEN 1 ELSE 0 END) AS has_blank_non_pace
          FROM payor_plan_benefits
          WHERE contract_id IN (${contractPlaceholders})
            AND benefit_category IN (${categoryPlaceholders})
          GROUP BY contract_id, benefit_category
        )
        SELECT
          contract_id,
          benefit_category,
          covered_yes,
          covered_no,
          copay_min,
          prior_auth_required,
          CASE
            WHEN has_explicit_1 = 1 THEN 'bendesc_yn_explicit_1'
            WHEN has_blank_non_pace = 1 THEN 'bendesc_yn_blank_non_pace'
            ELSE 'inferred_null'
          END AS covered_source
        FROM roll
      `;
      rollups = db.db.prepare(rollupSql).all(...contractIds, ...categories);
    }

    const rollupByContract = new Map();
    for (const r of rollups) {
      if (!rollupByContract.has(r.contract_id)) rollupByContract.set(r.contract_id, new Map());
      rollupByContract.get(r.contract_id).set(r.benefit_category, r);
    }

    const plans = rows.map((row) => {
      const categoryMap = rollupByContract.get(row.contract_id) || new Map();
      const coverage_detail = {};
      const matched_needs = [];
      const unmatched_needs = [];
      const reasons = [];
      const warnings = [];

      for (const n of needs) {
        const detail = buildNeedDetail(categoryMap.get(n.category));
        coverage_detail[n.need] = {
          covered: detail.covered,
          copay_min: detail.copay_min,
          prior_auth: detail.prior_auth
        };
        if (detail.covered === true) {
          matched_needs.push(n.need);
          const reason = reasonForNeed(NEED_LABELS[n.need] || n.need, detail);
          if (reason) reasons.push(reason);
        } else {
          unmatched_needs.push(n.need);
          warnings.push(`${NEED_LABELS[n.need] || n.need} not covered by this plan.`);
        }
      }

      if (Number(row.monthly_premium) === 0) reasons.push('$0 monthly premium');
      if (row.overall_star_rating != null && Number(row.overall_star_rating) >= 4) {
        reasons.push(`${Number(row.overall_star_rating)}-star rated`);
      }

      const confidence = buildConfidence(
        Object.fromEntries(
          Object.entries(coverage_detail).map(([need, d]) => {
            const r = categoryMap.get(NEED_TO_CATEGORY[need]);
            return [need, { ...d, covered_source: r?.covered_source || 'inferred_null' }];
          })
        )
      );

      return {
        contract_id: row.contract_id,
        payer_name: row.payer_name,
        plan_name: row.plan_name,
        plan_type: row.plan_type,
        monthly_premium: row.monthly_premium == null ? null : Number(row.monthly_premium),
        star_rating: row.overall_star_rating == null ? null : Number(row.overall_star_rating),
        moop_amount: row.moop_amount == null ? null : Number(row.moop_amount),
        matched_needs,
        unmatched_needs,
        reasons: Array.from(new Set(reasons)),
        warnings,
        coverage_detail,
        data_source: 'CMS PBP 2026',
        confidence
      };
    });

    return res.json({
      success: true,
      input: { zip, needs: needs.map((n) => n.need), sort_by: req.query.sort_by || 'lowest_premium' },
      stopgap_state_filter: zipStateStopgap ? { zip, state_abbr: zipStateStopgap } : null,
      count: plans.length,
      plans
    });
  } catch (error) {
    console.error('[public-plan-search] error:', error.message);
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

module.exports = router;
