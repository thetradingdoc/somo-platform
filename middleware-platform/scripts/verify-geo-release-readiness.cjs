#!/usr/bin/env node
'use strict';

const db = require('../database');
const { ensureCanonicalGeoTables, getActiveGeoVersion, resolveLocation } = require('../services/geo-resolver-service');

function fail(message, details = {}) {
  console.error(JSON.stringify({ success: false, message, details }, null, 2));
  process.exit(1);
}

function main() {
  ensureCanonicalGeoTables();
  const geoVersion = getActiveGeoVersion();

  const zipCount = Number(db.db.prepare('SELECT COUNT(*) AS c FROM geo_zip WHERE source_version = ?').get(geoVersion)?.c || 0);
  const countyCount = Number(db.db.prepare('SELECT COUNT(*) AS c FROM geo_county WHERE source_version = ?').get(geoVersion)?.c || 0);
  const mapCount = Number(db.db.prepare('SELECT COUNT(*) AS c FROM geo_zip_county_map WHERE source_version = ?').get(geoVersion)?.c || 0);
  const statesCount = Number(db.db.prepare('SELECT COUNT(DISTINCT state_abbr) AS c FROM geo_county WHERE source_version = ?').get(geoVersion)?.c || 0);

  const orphanServiceAreas = Number(
    db.db.prepare(
      `SELECT COUNT(*) AS c
       FROM payor_plan_service_areas sa
       LEFT JOIN geo_county gc ON gc.county_fips = sa.county_fips AND gc.source_version = ?
       WHERE sa.county_fips IS NOT NULL AND TRIM(sa.county_fips) != ''
         AND gc.county_fips IS NULL`
    ).get(geoVersion)?.c || 0
  );

  const sampleZips = ['10456', '10001', '30301', '60601', '77001', '94105', '33101', '85001', '98101', '20001'];
  const scopeBreakdown = sampleZips.reduce((acc, zip) => {
    const r = resolveLocation({ zip });
    acc[r.scope] = (acc[r.scope] || 0) + 1;
    return acc;
  }, {});

  const minZip = Number.parseInt(process.env.GEO_GUARD_MIN_ZIPS || '30000', 10);
  const minCounty = Number.parseInt(process.env.GEO_GUARD_MIN_COUNTIES || '2500', 10);
  const minStates = Number.parseInt(process.env.GEO_GUARD_MIN_STATES || '51', 10);

  if (zipCount < minZip) fail('geo_zip_count_below_guard', { zipCount, minZip, geoVersion });
  if (countyCount < minCounty) fail('geo_county_count_below_guard', { countyCount, minCounty, geoVersion });
  if (statesCount < minStates) fail('geo_states_count_below_guard', { statesCount, minStates, geoVersion });
  if (mapCount < zipCount) fail('geo_zip_county_map_too_small', { mapCount, zipCount, geoVersion });
  if (orphanServiceAreas > 0) fail('service_area_orphan_counties_detected', { orphanServiceAreas, geoVersion });

  console.log(JSON.stringify({
    success: true,
    geoVersion,
    zipCount,
    countyCount,
    mapCount,
    statesCount,
    orphanServiceAreas,
    scopeBreakdown
  }, null, 2));
}

main();
