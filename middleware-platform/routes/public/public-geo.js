const express = require('express');
const router = express.Router();
const db = require('../../database');
const fs = require('fs');
const path = require('path');
const { getGeoCompletenessDiagnostics } = require('../geo-diagnostics');
const { normalizeZip } = require('../../services/shared/geo-normalize');
const { getActiveGeoVersion, resolveLocation, ensureCanonicalGeoTables } = require('../../services/shared/geo-resolver-service');
const US_STATE_ABBRS = Object.freeze([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC'
]);

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

const EPA_COUNTY_FALLBACK_CSV = path.join(__dirname, '..', 'data', 'geo', 'states_and_counties.csv');
let countyFallbackCache = null;

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function loadCountyFallbackByState() {
  if (countyFallbackCache) return countyFallbackCache;
  try {
    const text = fs.readFileSync(EPA_COUNTY_FALLBACK_CSV, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    const byState = {};
    for (let i = 1; i < lines.length; i += 1) {
      const row = parseCsvLine(lines[i]);
      const stateAbbr = String(row[2] || '').trim().toUpperCase();
      const countyNameBase = String(row[4] || '').trim();
      if (!stateAbbr || !countyNameBase || !US_STATE_ABBRS.includes(stateAbbr)) continue;
      const countyName = countyNameBase.endsWith(' County') || countyNameBase.endsWith(' Parish') || countyNameBase.endsWith(' Borough')
        ? countyNameBase
        : `${countyNameBase} County`;
      if (!byState[stateAbbr]) byState[stateAbbr] = [];
      if (!byState[stateAbbr].includes(countyName)) byState[stateAbbr].push(countyName);
    }
    Object.keys(byState).forEach((state) => byState[state].sort());
    countyFallbackCache = byState;
  } catch (_) {
    countyFallbackCache = {};
  }
  return countyFallbackCache;
}

router.get('/options', (req, res) => {
  try {
    ensureCanonicalGeoTables();
    const geoDiagnostics = getGeoCompletenessDiagnostics(db.db, hasTable);
    const geoVersion = getActiveGeoVersion();
    const fallbackCountyByState = loadCountyFallbackByState();
    const fallbackStateOptions = US_STATE_ABBRS.slice().sort();
    const fallbackCountyOptions = Array.from(
      new Set(Object.values(fallbackCountyByState).flat().map((name) => String(name || '').trim()).filter(Boolean))
    ).sort();
    if (!hasTable('zip_county_crosswalk')) {
      return res.json({
        success: true,
        data_ready: false,
        geo_version: geoVersion,
        message: 'zip_county_crosswalk table is missing.',
        zip_options: [],
        state_options: fallbackStateOptions,
        county_options: fallbackCountyOptions,
        county_by_state: fallbackCountyByState,
        geo_diagnostics: geoDiagnostics
      });
    }
    const zipRows = db.db
      .prepare("SELECT DISTINCT zip_code AS zip FROM zip_county_crosswalk WHERE zip_code IS NOT NULL AND TRIM(zip_code) != '' ORDER BY zip_code")
      .all();
    const countyRows = db.db
      .prepare("SELECT DISTINCT county_name FROM zip_county_crosswalk WHERE county_name IS NOT NULL AND TRIM(county_name) != '' ORDER BY county_name")
      .all();

    let stateRows = [];
    let countyByStateRows = [];
    if (hasTable('payor_plan_service_areas')) {
      stateRows = db.db
        .prepare("SELECT DISTINCT state_abbr FROM payor_plan_service_areas WHERE state_abbr IS NOT NULL AND TRIM(state_abbr) != '' ORDER BY state_abbr")
        .all();
      countyByStateRows = db.db.prepare(
        `SELECT DISTINCT sa.state_abbr AS state_abbr, zc.county_name AS county_name
         FROM zip_county_crosswalk zc
         JOIN payor_plan_service_areas sa ON sa.county_fips = zc.county_fips
         WHERE sa.state_abbr IS NOT NULL
           AND TRIM(sa.state_abbr) != ''
           AND zc.county_name IS NOT NULL
           AND TRIM(zc.county_name) != ''
         ORDER BY sa.state_abbr, zc.county_name`
      ).all();
    }

    const countyByState = {};
    countyByStateRows.forEach((row) => {
      const state = String(row.state_abbr || '').trim().toUpperCase();
      const county = String(row.county_name || '').trim();
      if (!state || !county) return;
      if (!countyByState[state]) countyByState[state] = [];
      if (!countyByState[state].includes(county)) countyByState[state].push(county);
    });
    const fallbackCountyByStateWithData = loadCountyFallbackByState();
    // Prefer service-area counties, then union in full US county list so every state has a complete selector set.
    Object.entries(fallbackCountyByStateWithData).forEach(([state, counties]) => {
      if (!countyByState[state]) countyByState[state] = [];
      counties.forEach((county) => {
        if (!countyByState[state].includes(county)) countyByState[state].push(county);
      });
      countyByState[state].sort();
    });
    const dynamicStates = stateRows.map((r) => String(r.state_abbr || '').trim().toUpperCase()).filter(Boolean);
    const stateOptions = Array.from(new Set([...US_STATE_ABBRS, ...dynamicStates])).sort();
    const countyOptions = Array.from(
      new Set(Object.values(countyByState).flat().map((name) => String(name || '').trim()).filter(Boolean))
    ).sort();

    return res.json({
      success: true,
      data_ready: true,
      geo_version: geoVersion,
      geo_dataset_complete: geoDiagnostics.is_complete,
      zip_options: zipRows.map((r) => String(r.zip || '').trim()).filter(Boolean),
      state_options: stateOptions,
      county_options: countyOptions.length
        ? countyOptions
        : countyRows.map((r) => String(r.county_name || '').trim()).filter(Boolean),
      county_by_state: countyByState,
      geo_diagnostics: geoDiagnostics
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

router.get('/zip/:zip', (req, res) => {
  try {
    ensureCanonicalGeoTables();
    const geoVersion = getActiveGeoVersion();
    const geoDiagnostics = getGeoCompletenessDiagnostics(db.db, hasTable);
    const resolvedLocation = resolveLocation({ zip: req.params.zip });
    if (!hasTable('zip_county_crosswalk')) {
      return res.json({
        success: true,
        data_ready: false,
        geo_version: geoVersion,
        message: 'zip_county_crosswalk table is missing.',
        zip: normalizeZip(req.params.zip),
        resolved: null,
        candidates: [],
        geo_diagnostics: geoDiagnostics
      });
    }
    const zip = normalizeZip(req.params.zip);
    if (!/^\d{5}$/.test(zip)) {
      return res.status(400).json({ success: false, error: 'zip must be a 5-digit string' });
    }

    const candidates = Array.isArray(resolvedLocation?.candidates) ? resolvedLocation.candidates : [];
    const unique = new Set(candidates.map((c) => `${c.state}|${c.county_fips}|${c.county}`));
    const resolved = resolvedLocation?.scope === 'zip_exact' && candidates.length ? candidates[0] : null;
    return res.json({
      success: true,
      data_ready: true,
      geo_version: geoVersion,
      zip,
      ambiguous: unique.size > 1,
      resolved,
      candidates,
      geo_diagnostics: geoDiagnostics
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

router.get('/health', (req, res) => {
  try {
    ensureCanonicalGeoTables();
    const geoVersion = getActiveGeoVersion();
    const diagnostics = getGeoCompletenessDiagnostics(db.db, hasTable);
    const payload = {
      success: true,
      geo_version: geoVersion,
      geo_dataset_complete: diagnostics.is_complete,
      geo_diagnostics: diagnostics
    };
    if (!diagnostics.is_complete) {
      return res.status(503).json(payload);
    }
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

module.exports = router;
