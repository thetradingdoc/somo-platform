const db = require('../database');

function ensureCanonicalGeoTables() {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS geo_dataset_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_version TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      published_at TEXT DEFAULT (datetime('now')),
      notes TEXT,
      UNIQUE(source_version)
    );
    CREATE TABLE IF NOT EXISTS geo_county (
      county_fips TEXT PRIMARY KEY,
      county_name TEXT NOT NULL,
      state_abbr TEXT NOT NULL,
      source_version TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS geo_zip (
      zip5 TEXT PRIMARY KEY,
      status TEXT DEFAULT 'active',
      source_version TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS geo_zip_county_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zip5 TEXT NOT NULL,
      county_fips TEXT NOT NULL,
      priority_weight REAL DEFAULT 1,
      source_version TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(zip5, county_fips, source_version)
    );
    CREATE TABLE IF NOT EXISTS geo_city_zip_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      city_name TEXT NOT NULL,
      state_abbr TEXT NOT NULL,
      zip5 TEXT NOT NULL,
      source_version TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(city_name, state_abbr, zip5, source_version)
    );
    CREATE INDEX IF NOT EXISTS idx_geo_zip_county_map_zip ON geo_zip_county_map(zip5);
    CREATE INDEX IF NOT EXISTS idx_geo_zip_county_map_fips ON geo_zip_county_map(county_fips);
    CREATE INDEX IF NOT EXISTS idx_geo_county_state ON geo_county(state_abbr);
    CREATE INDEX IF NOT EXISTS idx_geo_city_zip_state_city ON geo_city_zip_map(state_abbr, city_name);
  `);
}

function getActiveGeoVersion() {
  ensureCanonicalGeoTables();
  const active = db.db
    .prepare('SELECT source_version FROM geo_dataset_versions WHERE is_active = 1 ORDER BY published_at DESC LIMIT 1')
    .get();
  if (active?.source_version) return String(active.source_version);
  const fallbackVersion = 'legacy-fips-v1';
  const upsertVersion = db.db.transaction(() => {
    db.db.prepare(
      `INSERT INTO geo_dataset_versions (source_version, is_active, notes)
       VALUES (?, 1, 'Auto-created fallback version')
       ON CONFLICT(source_version) DO NOTHING`
    ).run(fallbackVersion);
    db.db.prepare('UPDATE geo_dataset_versions SET is_active = CASE WHEN source_version = ? THEN 1 ELSE 0 END').run(fallbackVersion);
  });
  upsertVersion();
  return fallbackVersion;
}

function normalizeZip(rawZip) {
  return String(rawZip || '').replace(/[^\d]/g, '').slice(0, 5);
}

function readCanonicalZipCandidates(zip5, sourceVersion) {
  return db.db.prepare(
    `SELECT
       m.zip5 AS zip,
       c.state_abbr AS state,
       c.county_fips AS county_fips,
       c.county_name AS county
     FROM geo_zip_county_map m
     JOIN geo_county c ON c.county_fips = m.county_fips
     WHERE m.zip5 = ?
       AND m.source_version = ?
     ORDER BY m.priority_weight DESC, c.state_abbr, c.county_name`
  ).all(zip5, sourceVersion);
}

function readLegacyZipCandidates(zip5) {
  return db.db.prepare(
    `SELECT DISTINCT
       zc.zip_code AS zip,
       COALESCE(sa.state_abbr, '') AS state,
       zc.county_fips AS county_fips,
       zc.county_name AS county
     FROM zip_county_crosswalk zc
     LEFT JOIN payor_plan_service_areas sa ON sa.county_fips = zc.county_fips
     WHERE zc.zip_code = ?
     ORDER BY sa.state_abbr, zc.county_name`
  ).all(zip5);
}

function readCanonicalCounty(state, countyName, sourceVersion) {
  return db.db.prepare(
    `SELECT county_fips, county_name, state_abbr
     FROM geo_county
     WHERE state_abbr = ?
       AND county_name = ?
       AND source_version = ?
     LIMIT 1`
  ).get(state, countyName, sourceVersion);
}

function resolveLocation({ zip, state, county }) {
  ensureCanonicalGeoTables();
  const sourceVersion = getActiveGeoVersion();
  const normalizedZip = normalizeZip(zip);
  const normalizedState = String(state || '').trim().toUpperCase();
  const normalizedCounty = String(county || '').trim();

  if (/^\d{5}$/.test(normalizedZip)) {
    let rows = readCanonicalZipCandidates(normalizedZip, sourceVersion);
    if (!rows.length) {
      try {
        rows = readLegacyZipCandidates(normalizedZip);
      } catch (_) {
        rows = [];
      }
    }
    const candidates = rows.map((r) => ({
      zip: String(r.zip || '').trim(),
      state: String(r.state || '').trim().toUpperCase(),
      county_fips: String(r.county_fips || '').trim(),
      county: String(r.county || '').trim()
    })).filter((r) => r.zip && r.county_fips);
    const uniq = Array.from(new Set(candidates.map((c) => `${c.state}|${c.county_fips}|${c.county}`)));
    if (!candidates.length) {
      return {
        scope: 'zip_unmapped',
        zip: normalizedZip,
        state: '',
        county_fips: [],
        candidates: [],
        confidence: 'low',
        reason: 'zip_not_in_mapping',
        source_version: sourceVersion
      };
    }
    if (uniq.length === 1) {
      return {
        scope: 'zip_exact',
        zip: normalizedZip,
        state: candidates[0].state,
        county_fips: [candidates[0].county_fips],
        candidates,
        confidence: 'high',
        reason: 'single_county_match',
        source_version: sourceVersion
      };
    }
    return {
      scope: 'zip_ambiguous',
      zip: normalizedZip,
      state: '',
      county_fips: candidates.map((c) => c.county_fips),
      candidates,
      confidence: 'medium',
      reason: 'multiple_county_matches',
      source_version: sourceVersion
    };
  }

  if (normalizedState && normalizedCounty) {
    const countyRow = readCanonicalCounty(normalizedState, normalizedCounty, sourceVersion)
      || { county_fips: '', county_name: normalizedCounty, state_abbr: normalizedState };
    return {
      scope: 'county_exact',
      zip: '',
      state: normalizedState,
      county_fips: countyRow.county_fips ? [countyRow.county_fips] : [],
      candidates: countyRow.county_fips
        ? [{ zip: '', state: normalizedState, county_fips: countyRow.county_fips, county: countyRow.county_name }]
        : [],
      confidence: countyRow.county_fips ? 'high' : 'medium',
      reason: countyRow.county_fips ? 'state_county_match' : 'state_county_without_fips',
      source_version: sourceVersion
    };
  }

  if (normalizedState) {
    return {
      scope: 'state_fallback',
      zip: '',
      state: normalizedState,
      county_fips: [],
      candidates: [],
      confidence: 'medium',
      reason: 'state_only_scope',
      source_version: sourceVersion
    };
  }

  return {
    scope: 'zip_unmapped',
    zip: normalizedZip,
    state: '',
    county_fips: [],
    candidates: [],
    confidence: 'low',
    reason: 'insufficient_location_input',
    source_version: sourceVersion
  };
}

module.exports = {
  ensureCanonicalGeoTables,
  getActiveGeoVersion,
  resolveLocation
};
