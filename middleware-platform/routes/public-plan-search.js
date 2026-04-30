const express = require('express');
const router = express.Router();
const db = require('../database');
const { getGeoCompletenessDiagnostics } = require('./geo-diagnostics');
const { normalizeZip, normalizeCountyName } = require('../services/geo-normalize');
const {
  ensureCanonicalGeoTables,
  getActiveGeoVersion,
  resolveLocation
} = require('../services/geo-resolver-service');

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
  const accepted = [];
  const ignored = [];
  const seenAccepted = new Set();
  const seenIgnored = new Set();
  for (const n of arr) {
    const key = String(n || '').toLowerCase().replace(/[\s-]+/g, '_');
    const canonical = key === 'chiropractic' ? 'chiro' : key;
    if (NEED_TO_CATEGORY[canonical]) {
      if (seenAccepted.has(canonical)) continue;
      seenAccepted.add(canonical);
      accepted.push({ need: canonical, category: NEED_TO_CATEGORY[canonical] });
      continue;
    }
    if (canonical && !seenIgnored.has(canonical)) {
      seenIgnored.add(canonical);
      ignored.push(canonical);
    }
  }
  return { accepted, ignored };
}

function resolveOrderBy(sortBy) {
  const key = String(sortBy || '').toLowerCase();
  if (key === 'highest_stars') return 'overall_star_rating DESC, monthly_premium ASC';
  if (key === 'lowest_moop') return 'moop_amount ASC, monthly_premium ASC';
  if (key === 'highest_premium') return 'monthly_premium DESC, overall_star_rating DESC';
  return 'monthly_premium ASC, overall_star_rating DESC';
}

function hasZipCountyCrosswalkTable() {
  try {
    const row = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='zip_county_crosswalk'")
      .get();
    return Boolean(row && row.name === 'zip_county_crosswalk');
  } catch (_) {
    return false;
  }
}

function hasTable(tableName) {
  try {
    const row = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(String(tableName || ''));
    return Boolean(row && row.name === tableName);
  } catch (_) {
    return false;
  }
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

/**
 * GET /api/public/plans/meta
 * Row counts and distinct keys from the loaded SQLite CMS plan tables (no fabricated marketing numbers).
 * `payor_plan_premiums_row_count` = rows in `payor_plan_premiums` (Landscape ingest: one row per MA plan with premium).
 * `distinct_contract_ids` = unique `contract_id` values (often equals row count when `contract_id` is the primary key).
 * `cms_data_updated_label` = optional display string from env `CMS_DATA_UPDATED` (e.g. April 2026) for hosted UIs.
 */
router.get('/meta', (req, res) => {
  try {
    ensureCanonicalGeoTables();
    const geoVersion = getActiveGeoVersion();
    const requiredTables = ['payor_plan_premiums', 'payor_plan_benefits'];
    const missingTables = requiredTables.filter((t) => !hasTable(t));
    const dataReady = missingTables.length === 0;
    const payload = {
      success: true,
      data_ready: dataReady,
      missing_tables: missingTables,
      payor_plan_benefits_row_count: null,
      payor_plan_premiums_row_count: null,
      distinct_contract_ids: null,
      distinct_org_names: null,
      zip_county_crosswalk_row_count: null,
      payor_plan_service_areas_row_count: null,
      /** Optional human label for UI (set on GCP/middleware, e.g. `April 2026`). */
      cms_data_updated_label: String(process.env.CMS_DATA_UPDATED || '').trim() || null
    };
    /** Populate each metric when its table exists so the UI can show real counts even if one ingest is missing. */
    if (hasTable('payor_plan_benefits')) {
      try {
        payload.payor_plan_benefits_row_count = Number(
          db.db.prepare('SELECT COUNT(*) AS c FROM payor_plan_benefits').get()?.c ?? 0
        );
      } catch (_) {
        payload.payor_plan_benefits_row_count = null;
      }
    }
    if (hasTable('payor_plan_premiums')) {
      try {
        payload.payor_plan_premiums_row_count = Number(
          db.db.prepare('SELECT COUNT(*) AS c FROM payor_plan_premiums').get()?.c ?? 0
        );
        payload.distinct_contract_ids = Number(
          db.db
            .prepare(
              `SELECT COUNT(DISTINCT contract_id) AS c
               FROM payor_plan_premiums
               WHERE contract_id IS NOT NULL AND TRIM(contract_id) != ''`
            )
            .get()?.c ?? 0
        );
        payload.distinct_org_names = Number(
          db.db
            .prepare(
              `SELECT COUNT(DISTINCT TRIM(org_name)) AS c
               FROM payor_plan_premiums
               WHERE org_name IS NOT NULL AND TRIM(org_name) != ''`
            )
            .get()?.c ?? 0
        );
      } catch (_) {
        payload.payor_plan_premiums_row_count = null;
        payload.distinct_contract_ids = null;
        payload.distinct_org_names = null;
      }
    }
    if (hasTable('zip_county_crosswalk')) {
      try {
        payload.zip_county_crosswalk_row_count = Number(
          db.db.prepare('SELECT COUNT(*) AS c FROM zip_county_crosswalk').get()?.c ?? 0
        );
      } catch (_) {
        payload.zip_county_crosswalk_row_count = null;
      }
    }
    if (hasTable('payor_plan_service_areas')) {
      try {
        payload.payor_plan_service_areas_row_count = Number(
          db.db.prepare('SELECT COUNT(*) AS c FROM payor_plan_service_areas').get()?.c ?? 0
        );
      } catch (_) {
        payload.payor_plan_service_areas_row_count = null;
      }
    }
    payload.geo_diagnostics = getGeoCompletenessDiagnostics(db.db, hasTable);
    payload.geo_dataset_complete = Boolean(payload.geo_diagnostics?.is_complete);
    payload.geo_version = geoVersion;
    return res.json(payload);
  } catch (error) {
    console.error('[public-plan-search] meta error:', error.message);
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

router.get('/search', (req, res) => {
  try {
    ensureCanonicalGeoTables();
    const geoVersion = getActiveGeoVersion();
    const locationType = String(req.query.location_type || 'zip').trim().toLowerCase();
    const zip = String(req.query.zip || '').trim();
    const normalizedZip = normalizeZip(zip);
    const state = String(req.query.state || '').trim().toUpperCase();
    const county = String(req.query.county || '').trim();
    const normalizedCounty = normalizeCountyName(county);
    if (!['zip', 'county', 'state'].includes(locationType)) {
      return res.status(400).json({ success: false, error: 'location_type must be one of zip|county|state', geo_version: geoVersion });
    }
    if (locationType === 'zip' && !/^\d{5}$/.test(normalizedZip)) {
      return res.status(400).json({ success: false, error: 'zip must be a 5-digit string', geo_version: geoVersion });
    }
    if (locationType === 'county' && (!state || !county)) {
      return res.status(400).json({
        success: false,
        error: 'state and county are required for location_type=county',
        geo_version: geoVersion
      });
    }
    if (locationType === 'state' && !state) {
      return res.status(400).json({ success: false, error: 'state is required for location_type=state', geo_version: geoVersion });
    }

    const { accepted: needs, ignored: ignoredNeeds } = normalizeNeeds(req.query.needs);
    const categories = Array.from(new Set(needs.map((n) => n.category)));
    if (!categories.length) {
      return res.status(400).json({
        success: false,
        error: 'needs is required (e.g. dental,hearing)',
        ignored_needs: ignoredNeeds,
        geo_version: geoVersion
      });
    }

    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '25', 10) || 25, 100));
    const orderBy = resolveOrderBy(req.query.sort_by);

    const requiredTables = ['payor_plan_premiums', 'payor_plan_benefits'];
    const missingRequiredTables = requiredTables.filter((t) => !hasTable(t));
    if (missingRequiredTables.length) {
      return res.json({
        success: true,
        input: { zip, state, county, location_type: locationType, needs: needs.map((n) => n.need), sort_by: req.query.sort_by || 'lowest_premium' },
        ignored_needs: ignoredNeeds,
        zip_filter_applied: false,
        scope_requested: locationType,
        scope_used: null,
        precision: 'fallback',
        geo_version: geoVersion,
        data_ready: false,
        message: `Plan data is not loaded yet. Missing tables: ${missingRequiredTables.join(', ')}`,
        count: 0,
        plans: []
      });
    }

    const categoryPlaceholders = categories.map(() => '?').join(', ');
    const hasServiceAreas = hasTable('payor_plan_service_areas');
    const hasGeoTables = hasZipCountyCrosswalkTable() && hasServiceAreas;
    const geoDiagnostics = getGeoCompletenessDiagnostics(db.db, hasTable);
    let canApplyZipCountyFilter = false;
    let zipCountyRowsForZip = 0;
    let candidateSql = '';
    let params = [];
    let scopeUsed = locationType;
    let resolvedCountyFips = '';

    const warnings = [];
    if (locationType === 'zip') {
      const locationResolution = resolveLocation({ zip: normalizedZip });
      zipCountyRowsForZip = Array.isArray(locationResolution?.county_fips) ? locationResolution.county_fips.length : 0;
      canApplyZipCountyFilter = hasGeoTables && locationResolution?.scope !== 'zip_unmapped' && zipCountyRowsForZip > 0;
      if (!canApplyZipCountyFilter) {
        return res.status(422).json({
          success: false,
          error: 'zip_unmapped',
          message: `ZIP ${zip} is not mapped yet. Choose state/county to continue.`,
          scope_requested: 'zip',
          scope_used: null,
          precision: 'fallback',
          geo_version: geoVersion,
          geo_diagnostics: geoDiagnostics,
          normalized_zip: normalizedZip
        });
      }
      if (state && locationResolution?.state && locationResolution.state !== state) {
        warnings.push(`State ${state} conflicts with ZIP ${normalizedZip} mapping (${locationResolution.state}); ZIP mapping used.`);
      }
      if (normalizedCounty && Array.isArray(locationResolution?.candidates) && locationResolution.candidates.length > 0) {
        const zipHasCounty = locationResolution.candidates.some((c) => normalizeCountyName(c.county) === normalizedCounty);
        if (!zipHasCounty) {
          warnings.push(`County "${county}" does not match ZIP ${normalizedZip} mapping; ZIP mapping used.`);
        }
      }
      candidateSql = `
        WITH zip_counties AS (
          SELECT DISTINCT county_fips
          FROM zip_county_crosswalk
          WHERE zip_code = ?
        ),
        benefit_any AS (
          SELECT
            contract_id,
            plan_id,
            COALESCE(segment_id, '') AS segment_id,
            MAX(CASE WHEN covered = 1 THEN 1 ELSE 0 END) AS any_covered
          FROM payor_plan_benefits
          WHERE benefit_category IN (${categoryPlaceholders})
          GROUP BY contract_id, plan_id, COALESCE(segment_id, '')
        )
        SELECT
          sa.contract_id,
          pr.plan_id,
          COALESCE(pr.segment_id, '') AS segment_id,
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
        LEFT JOIN benefit_any ba
          ON ba.contract_id = pr.contract_id
         AND ba.plan_id = pr.plan_id
         AND ba.segment_id = COALESCE(pr.segment_id, '')
        WHERE pr.monthly_consolidated_premium IS NOT NULL
          AND upper(COALESCE(pr.state_abbr, '')) = upper(COALESCE(sa.state_abbr, ''))
          AND lower(trim(replace(replace(replace(COALESCE(pr.county_name, ''), '.', ''), ' County', ''), ' county', '')))
            = lower(trim(replace(replace(replace(COALESCE(sa.county_name, ''), '.', ''), ' County', ''), ' county', '')))
          AND COALESCE(ba.any_covered, 0) = 1
        ORDER BY ${orderBy}
        LIMIT ?
      `;
      params = [normalizedZip, ...categories, limit];
      scopeUsed = 'zip';
    } else if (locationType === 'county') {
      if (!hasServiceAreas) {
        return res.status(422).json({
          success: false,
          error: 'location_scope_unavailable',
          message: 'County-level scope unavailable because service area tables are missing.',
          scope_requested: 'county',
          scope_used: null,
          precision: 'fallback',
          geo_version: geoVersion
        });
      }
      if (hasTable('geo_county')) {
        const countyRow = db.db.prepare(
          `SELECT county_fips
           FROM geo_county
           WHERE source_version = ?
             AND state_abbr = ?
             AND (
               county_name = ?
               OR lower(trim(replace(replace(replace(county_name, '.', ''), ' County', ''), ' county', ''))) = ?
             )
           LIMIT 1`
        ).get(geoVersion, state, county, normalizedCounty);
        resolvedCountyFips = String(countyRow?.county_fips || '').trim();
      }
      if (/^\d{5}$/.test(normalizedZip)) {
        const zipLocation = resolveLocation({ zip: normalizedZip });
        const zipFips = Array.isArray(zipLocation?.county_fips) ? zipLocation.county_fips.filter(Boolean) : [];
        if (zipFips.length && resolvedCountyFips && !zipFips.includes(resolvedCountyFips)) {
          warnings.push(`ZIP ${normalizedZip} and county "${county}" conflict; county filter used for location_type=county.`);
        }
      }
      candidateSql = `
        WITH benefit_any AS (
          SELECT
            contract_id,
            plan_id,
            COALESCE(segment_id, '') AS segment_id,
            MAX(CASE WHEN covered = 1 THEN 1 ELSE 0 END) AS any_covered
          FROM payor_plan_benefits
          WHERE benefit_category IN (${categoryPlaceholders})
          GROUP BY contract_id, plan_id, COALESCE(segment_id, '')
        )
        SELECT DISTINCT
          sa.contract_id,
          pr.plan_id,
          COALESCE(pr.segment_id, '') AS segment_id,
          pr.org_name AS payer_name,
          pr.plan_name,
          pr.plan_type,
          pr.monthly_consolidated_premium AS monthly_premium,
          pr.overall_star_rating,
          pr.moop_amount,
          sa.state_abbr,
          sa.county_name
        FROM payor_plan_service_areas sa
        JOIN payor_plan_premiums pr ON pr.contract_id = sa.contract_id
        LEFT JOIN benefit_any ba
          ON ba.contract_id = pr.contract_id
         AND ba.plan_id = pr.plan_id
         AND ba.segment_id = COALESCE(pr.segment_id, '')
        WHERE sa.state_abbr = ?
          AND (
            (? != '' AND sa.county_fips = ?)
            OR (
              ? = ''
              AND (
                sa.county_name = ?
                OR lower(trim(replace(replace(replace(sa.county_name, '.', ''), ' County', ''), ' county', ''))) = ?
              )
            )
          )
          AND pr.monthly_consolidated_premium IS NOT NULL
          AND upper(COALESCE(pr.state_abbr, '')) = upper(COALESCE(sa.state_abbr, ''))
          AND lower(trim(replace(replace(replace(COALESCE(pr.county_name, ''), '.', ''), ' County', ''), ' county', '')))
            = lower(trim(replace(replace(replace(COALESCE(sa.county_name, ''), '.', ''), ' County', ''), ' county', '')))
          AND COALESCE(ba.any_covered, 0) = 1
        ORDER BY ${orderBy}
        LIMIT ?
      `;
      params = [...categories, state, resolvedCountyFips, resolvedCountyFips, resolvedCountyFips, county, normalizedCounty, limit];
      scopeUsed = 'county';
    } else {
      if (!hasServiceAreas) {
        return res.status(422).json({
          success: false,
          error: 'location_scope_unavailable',
          message: 'State-level scope unavailable because service area tables are missing.',
          scope_requested: 'state',
          scope_used: null,
          precision: 'fallback',
          geo_version: geoVersion
        });
      }
      candidateSql = `
        WITH benefit_any AS (
          SELECT
            contract_id,
            plan_id,
            COALESCE(segment_id, '') AS segment_id,
            MAX(CASE WHEN covered = 1 THEN 1 ELSE 0 END) AS any_covered
          FROM payor_plan_benefits
          WHERE benefit_category IN (${categoryPlaceholders})
          GROUP BY contract_id, plan_id, COALESCE(segment_id, '')
        )
        SELECT DISTINCT
          sa.contract_id,
          pr.plan_id,
          COALESCE(pr.segment_id, '') AS segment_id,
          pr.org_name AS payer_name,
          pr.plan_name,
          pr.plan_type,
          pr.monthly_consolidated_premium AS monthly_premium,
          pr.overall_star_rating,
          pr.moop_amount,
          sa.state_abbr,
          sa.county_name
        FROM payor_plan_service_areas sa
        JOIN payor_plan_premiums pr ON pr.contract_id = sa.contract_id
        LEFT JOIN benefit_any ba
          ON ba.contract_id = pr.contract_id
         AND ba.plan_id = pr.plan_id
         AND ba.segment_id = COALESCE(pr.segment_id, '')
        WHERE sa.state_abbr = ?
          AND pr.monthly_consolidated_premium IS NOT NULL
          AND upper(COALESCE(pr.state_abbr, '')) = upper(COALESCE(sa.state_abbr, ''))
          AND COALESCE(ba.any_covered, 0) = 1
        ORDER BY ${orderBy}
        LIMIT ?
      `;
      params = [...categories, state, limit];
      scopeUsed = 'state';
    }
    const rows = db.db.prepare(candidateSql).all(...params);

    const planKeys = Array.from(
      new Set(
        rows
          .map((r) => `${String(r.contract_id || '').trim()}|${String(r.plan_id || '').trim()}|${String(r.segment_id || '').trim()}`)
          .filter((k) => !k.startsWith('||'))
      )
    ).map((k) => {
      const [contract_id, plan_id, segment_id] = k.split('|');
      return { contract_id, plan_id, segment_id: segment_id || '' };
    });
    let rollups = [];
    if (planKeys.length) {
      const keyPlaceholders = planKeys.map(() => '(?, ?, ?)').join(', ');
      const keyParams = planKeys.flatMap((k) => [k.contract_id, k.plan_id, k.segment_id]);
      const rollupSql = `
        WITH key_set(contract_id, plan_id, segment_id) AS (
          VALUES ${keyPlaceholders}
        ),
        roll AS (
          SELECT
            pb.contract_id,
            pb.plan_id,
            COALESCE(pb.segment_id, '') AS segment_id,
            pb.benefit_category,
            MAX(CASE WHEN covered = 1 THEN 1 ELSE 0 END) AS covered_yes,
            MAX(CASE WHEN covered = 0 THEN 1 ELSE 0 END) AS covered_no,
            MIN(copay_min) AS copay_min,
            MAX(CASE WHEN prior_auth_required = 1 THEN 1 ELSE 0 END) AS prior_auth_required,
            MAX(CASE WHEN covered_source = 'bendesc_yn_explicit_1' THEN 1 ELSE 0 END) AS has_explicit_1,
            MAX(CASE WHEN covered_source = 'bendesc_yn_blank_non_pace' THEN 1 ELSE 0 END) AS has_blank_non_pace
          FROM payor_plan_benefits pb
          JOIN key_set ks
            ON ks.contract_id = pb.contract_id
           AND ks.plan_id = pb.plan_id
           AND ks.segment_id = COALESCE(pb.segment_id, '')
          WHERE pb.benefit_category IN (${categoryPlaceholders})
          GROUP BY pb.contract_id, pb.plan_id, COALESCE(pb.segment_id, ''), pb.benefit_category
        )
        SELECT
          contract_id,
          plan_id,
          segment_id,
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
      rollups = db.db.prepare(rollupSql).all(...keyParams, ...categories);
    }

    const rollupByPlan = new Map();
    for (const r of rollups) {
      const key = `${String(r.contract_id || '').trim()}|${String(r.plan_id || '').trim()}|${String(r.segment_id || '').trim()}`;
      if (!rollupByPlan.has(key)) rollupByPlan.set(key, new Map());
      rollupByPlan.get(key).set(r.benefit_category, r);
    }

    const plans = rows.map((row) => {
      const planKey = `${String(row.contract_id || '').trim()}|${String(row.plan_id || '').trim()}|${String(row.segment_id || '').trim()}`;
      const categoryMap = rollupByPlan.get(planKey) || new Map();
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
        state_abbr: row.state_abbr == null ? null : String(row.state_abbr).trim().toUpperCase(),
        county_name: row.county_name == null ? null : String(row.county_name).trim(),
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
      input: { zip: normalizedZip, state, county, location_type: locationType, needs: needs.map((n) => n.need), sort_by: req.query.sort_by || 'lowest_premium' },
      ignored_needs: ignoredNeeds,
      zip_filter_applied: canApplyZipCountyFilter,
      zip_geo_fallback: locationType === 'zip' && hasGeoTables && !canApplyZipCountyFilter
        ? { zip: normalizedZip, reason: 'zip_not_in_crosswalk' }
        : null,
      scope_requested: locationType,
      scope_used: scopeUsed,
      precision: scopeUsed === locationType ? 'exact' : 'fallback',
      stopgap_state_filter: null,
      geo_version: geoVersion,
      geo_dataset_complete: geoDiagnostics.is_complete,
      geo_diagnostics: geoDiagnostics,
      location_warnings: warnings,
      count: plans.length,
      plans
    });
  } catch (error) {
    console.error('[public-plan-search] error:', error.message);
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

module.exports = router;
