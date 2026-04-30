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

function pickGeoVersion(sqliteDb) {
  const active = sqliteDb
    .prepare('SELECT source_version FROM geo_dataset_versions WHERE is_active = 1 ORDER BY published_at DESC LIMIT 1')
    .get();
  const activeVersion = String(active?.source_version || '').trim();
  if (!activeVersion) {
    const fallback = sqliteDb
      .prepare(
        `SELECT source_version
         FROM geo_zip_county_map
         GROUP BY source_version
         ORDER BY COUNT(*) DESC, source_version DESC
         LIMIT 1`
      )
      .get();
    return String(fallback?.source_version || 'legacy-crosswalk');
  }

  const activeMapCount = Number(sqliteDb.prepare(
    'SELECT COUNT(*) AS c FROM geo_zip_county_map WHERE source_version = ?'
  ).get(activeVersion)?.c ?? 0);
  if (activeMapCount > 0) return activeVersion;

  const best = sqliteDb
    .prepare(
      `SELECT source_version
       FROM geo_zip_county_map
       GROUP BY source_version
       ORDER BY COUNT(*) DESC, source_version DESC
       LIMIT 1`
    )
    .get();
  return String(best?.source_version || activeVersion);
}

function countCanonicalForVersion(sqliteDb, sourceVersion) {
  return {
    zipCount: Number(
      sqliteDb.prepare('SELECT COUNT(DISTINCT zip5) AS c FROM geo_zip WHERE source_version = ?').get(sourceVersion)?.c ?? 0
    ),
    countyCount: Number(
      sqliteDb.prepare('SELECT COUNT(DISTINCT county_fips) AS c FROM geo_county WHERE source_version = ?').get(sourceVersion)?.c ?? 0
    )
  };
}

function getGeoCompletenessDiagnostics(sqliteDb, hasTableFn) {
  const thresholds = getGeoThresholds();
  const diagnostics = {
    geo_version: null,
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
    let activeGeoVersion = pickGeoVersion(sqliteDb);
    diagnostics.geo_version = activeGeoVersion;
    diagnostics.zip_county_crosswalk_row_count = Number(
      sqliteDb.prepare('SELECT COUNT(*) AS c FROM zip_county_crosswalk').get()?.c ?? 0
    );
    if (diagnostics.has_canonical_geo) {
      let canonicalCounts = countCanonicalForVersion(sqliteDb, activeGeoVersion);
      if (
        canonicalCounts.zipCount < thresholds.min_distinct_zip_count ||
        canonicalCounts.countyCount < thresholds.min_distinct_county_count
      ) {
        const best = sqliteDb
          .prepare(
            `SELECT source_version
             FROM geo_zip_county_map
             GROUP BY source_version
             ORDER BY COUNT(*) DESC, source_version DESC
             LIMIT 1`
          )
          .get();
        const bestVersion = String(best?.source_version || '');
        if (bestVersion && bestVersion !== activeGeoVersion) {
          const bestCounts = countCanonicalForVersion(sqliteDb, bestVersion);
          if (bestCounts.zipCount > canonicalCounts.zipCount || bestCounts.countyCount > canonicalCounts.countyCount) {
            activeGeoVersion = bestVersion;
            diagnostics.geo_version = bestVersion;
            canonicalCounts = bestCounts;
          }
        }
      }
      diagnostics.distinct_zip_count = canonicalCounts.zipCount;
      diagnostics.distinct_county_count = canonicalCounts.countyCount;
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
