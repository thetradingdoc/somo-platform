#!/usr/bin/env node
'use strict';

const db = require('../database');
const { ensureCanonicalGeoTables } = require('../services/shared/geo-resolver-service');

const SOURCE_VERSION = String(process.env.GEO_SOURCE_VERSION || `geo-${new Date().toISOString().slice(0, 10)}`);

function run() {
  ensureCanonicalGeoTables();
  const tx = db.db.transaction(() => {
    db.db.prepare(
      `INSERT INTO geo_dataset_versions (source_version, is_active, notes)
       VALUES (?, 0, 'canonical build from legacy tables')
       ON CONFLICT(source_version) DO NOTHING`
    ).run(SOURCE_VERSION);

    // geo_zip/geo_county have PKs that are not version-scoped; replace the canonical surface fully each build.
    db.db.exec('DELETE FROM geo_zip_county_map;');
    db.db.exec('DELETE FROM geo_zip;');
    db.db.exec('DELETE FROM geo_county;');

    db.db.exec(`
      INSERT INTO geo_county (county_fips, county_name, state_abbr, source_version, updated_at)
      SELECT DISTINCT
        TRIM(zc.county_fips) AS county_fips,
        TRIM(zc.county_name) AS county_name,
        TRIM(COALESCE(sa.state_abbr, '')) AS state_abbr,
        '${SOURCE_VERSION}' AS source_version,
        datetime('now') AS updated_at
      FROM zip_county_crosswalk zc
      LEFT JOIN payor_plan_service_areas sa ON sa.county_fips = zc.county_fips
      WHERE zc.county_fips IS NOT NULL AND TRIM(zc.county_fips) != ''
        AND zc.county_name IS NOT NULL AND TRIM(zc.county_name) != ''
        AND COALESCE(sa.state_abbr, '') != ''
      GROUP BY TRIM(zc.county_fips), TRIM(zc.county_name), TRIM(COALESCE(sa.state_abbr, ''));
    `);

    db.db.exec(`
      INSERT INTO geo_zip (zip5, status, source_version, updated_at)
      SELECT DISTINCT
        TRIM(zc.zip_code) AS zip5,
        'active' AS status,
        '${SOURCE_VERSION}' AS source_version,
        datetime('now') AS updated_at
      FROM zip_county_crosswalk zc
      WHERE zc.zip_code IS NOT NULL AND TRIM(zc.zip_code) != '';
    `);

    db.db.exec(`
      INSERT INTO geo_zip_county_map (zip5, county_fips, priority_weight, source_version, updated_at)
      SELECT DISTINCT
        TRIM(zc.zip_code) AS zip5,
        TRIM(zc.county_fips) AS county_fips,
        1.0 AS priority_weight,
        '${SOURCE_VERSION}' AS source_version,
        datetime('now') AS updated_at
      FROM zip_county_crosswalk zc
      JOIN geo_county gc
        ON gc.county_fips = TRIM(zc.county_fips)
       AND gc.source_version = '${SOURCE_VERSION}'
      WHERE zc.zip_code IS NOT NULL AND TRIM(zc.zip_code) != ''
        AND zc.county_fips IS NOT NULL AND TRIM(zc.county_fips) != '';
    `);

    db.db.prepare('UPDATE geo_dataset_versions SET is_active = CASE WHEN source_version = ? THEN 1 ELSE 0 END').run(SOURCE_VERSION);
  });

  tx();

  const summary = {
    source_version: SOURCE_VERSION,
    geo_zip_count: Number(db.db.prepare('SELECT COUNT(*) AS c FROM geo_zip WHERE source_version = ?').get(SOURCE_VERSION)?.c || 0),
    geo_county_count: Number(db.db.prepare('SELECT COUNT(*) AS c FROM geo_county WHERE source_version = ?').get(SOURCE_VERSION)?.c || 0),
    geo_zip_county_map_count: Number(db.db.prepare('SELECT COUNT(*) AS c FROM geo_zip_county_map WHERE source_version = ?').get(SOURCE_VERSION)?.c || 0),
    states_count: Number(db.db.prepare('SELECT COUNT(DISTINCT state_abbr) AS c FROM geo_county WHERE source_version = ?').get(SOURCE_VERSION)?.c || 0)
  };
  console.log(JSON.stringify({ success: true, event: 'canonical_geo_built', summary }, null, 2));
}

run();
