const { ensureCanonicalGeoTables, getActiveGeoVersion } = require('../services/geo-resolver-service');

function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function getGeoThresholds() {
  return {
    min_distinct_zip_count: toPositiveInt(process.env.PUBLIC_GEO_MIN_DISTINCT_ZIPS, 500),
    min_distinct_county_count: toPositiveInt(process.env.PUBLIC_GEO_MIN_DISTINCT_COUNTIES, 100),
    min_states_with_counties_count: toPositiveInt(process.env.PUBLIC_GEO_MIN_STATES_WITH_COUNTIES, 10)
  };
}

function getGeoCompletenessDiagnostics(sqliteDb, hasTableFn) {
  ensureCanonicalGeoTables();
  const activeGeoVersion = getActiveGeoVersion();
  const thresholds = getGeoThresholds();
  const diagnostics = {
    geo_version: activeGeoVersion,
    has_canonical_geo: false,
    has_zip_county_crosswalk: false,
    has_service_areas: false,
    zip_county_crosswalk_row_count: 0,
    distinct_zip_count: 0,
    distinct_county_count: 0,
    states_with_counties_count: 0,
    thresholds,
    is_complete: false,
    issues: []
  };

  if (!sqliteDb || typeof hasTableFn !== 'function') {
    diagnostics.issues.push('database_unavailable');
    return diagnostics;
  }

  diagnostics.has_zip_county_crosswalk = hasTableFn('zip_county_crosswalk');
  diagnostics.has_service_areas = hasTableFn('payor_plan_service_areas');
  diagnostics.has_canonical_geo = hasTableFn('geo_zip') && hasTableFn('geo_county') && hasTableFn('geo_zip_county_map');

  if (!diagnostics.has_zip_county_crosswalk) diagnostics.issues.push('missing_zip_county_crosswalk');
  if (!diagnostics.has_service_areas) diagnostics.issues.push('missing_payor_plan_service_areas');
  if (diagnostics.issues.length) return diagnostics;

  try {
    diagnostics.zip_county_crosswalk_row_count = Number(
      sqliteDb.prepare('SELECT COUNT(*) AS c FROM zip_county_crosswalk').get()?.c ?? 0
    );
    if (diagnostics.has_canonical_geo) {
      diagnostics.distinct_zip_count = Number(
        sqliteDb
          .prepare(
            `SELECT COUNT(DISTINCT zip5) AS c
             FROM geo_zip
             WHERE source_version = ?`
          )
          .get(activeGeoVersion)?.c ?? 0
      );
      diagnostics.distinct_county_count = Number(
        sqliteDb
          .prepare(
            `SELECT COUNT(DISTINCT county_fips) AS c
             FROM geo_county
             WHERE source_version = ?`
          )
          .get(activeGeoVersion)?.c ?? 0
      );
    } else {
      diagnostics.distinct_zip_count = Number(
        sqliteDb
          .prepare(
            `SELECT COUNT(DISTINCT zip_code) AS c
             FROM zip_county_crosswalk
             WHERE zip_code IS NOT NULL AND TRIM(zip_code) != ''`
          )
          .get()?.c ?? 0
      );
      diagnostics.distinct_county_count = Number(
        sqliteDb
          .prepare(
            `SELECT COUNT(DISTINCT county_fips) AS c
             FROM zip_county_crosswalk
             WHERE county_fips IS NOT NULL AND TRIM(county_fips) != ''`
          )
          .get()?.c ?? 0
      );
    }
    diagnostics.states_with_counties_count = Number(
      sqliteDb
        .prepare(
          `SELECT COUNT(DISTINCT sa.state_abbr) AS c
           FROM payor_plan_service_areas sa
           JOIN zip_county_crosswalk zc ON zc.county_fips = sa.county_fips
           WHERE sa.state_abbr IS NOT NULL AND TRIM(sa.state_abbr) != ''`
        )
        .get()?.c ?? 0
    );
  } catch (error) {
    diagnostics.issues.push('diagnostics_query_failed');
    diagnostics.error = String(error?.message || 'diagnostics_query_failed');
    return diagnostics;
  }

  if (diagnostics.distinct_zip_count < thresholds.min_distinct_zip_count) {
    diagnostics.issues.push('distinct_zip_count_below_threshold');
  }
  if (diagnostics.distinct_county_count < thresholds.min_distinct_county_count) {
    diagnostics.issues.push('distinct_county_count_below_threshold');
  }
  if (diagnostics.states_with_counties_count < thresholds.min_states_with_counties_count) {
    diagnostics.issues.push('states_with_counties_count_below_threshold');
  }

  diagnostics.is_complete = diagnostics.issues.length === 0;
  return diagnostics;
}

module.exports = {
  getGeoCompletenessDiagnostics
};
