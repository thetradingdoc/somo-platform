'use strict';

const db = require('../database');

const DERM_SPECIALTY_GLOB = '207N*';
const PHYSICIAN_SPECIALTY_GLOB = '207*';
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 25;

function normalizeZip(zip) {
  const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
  return z.length >= 3 ? z : '';
}

function hasNppesTable() {
  try {
    const row = db.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='nppes_directory_providers'`
    ).get();
    return !!row;
  } catch (_) {
    return false;
  }
}

function hasSpecialistsView() {
  try {
    const row = db.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='view' AND name='nppes_v_physicians_specialists'`
    ).get();
    return !!row;
  } catch (_) {
    return false;
  }
}

function mapProviderRow(r) {
  return {
    npi: r.npi,
    name: r.display_name,
    credential: r.credential || null,
    specialty: r.specialty_display || r.specialty_code,
    city: r.city,
    state: r.state,
    zip: r.postal_code,
    phone: r.phone || null,
    address_line_1: r.address_line_1 || null,
    booking_available: false,
  };
}

/**
 * Search MD/DO specialists (nppes_v_physicians_specialists) near a US ZIP prefix.
 */
function searchSpecialistsByZip(opts = {}) {
  const zipPrefix = normalizeZip(opts.zip);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(opts.limit) || DEFAULT_LIMIT));

  if (!hasNppesTable()) {
    return { providers: [], zip_prefix: zipPrefix, total: 0, data_status: 'table_missing', scope: 'physician_specialist' };
  }

  if (!zipPrefix) {
    return { providers: [], zip_prefix: '', total: 0, data_status: 'zip_required', scope: 'physician_specialist' };
  }

  const likePattern = `${zipPrefix}%`;
  let rows = [];

  if (hasSpecialistsView()) {
    rows = db.db
      .prepare(
        `
        SELECT npi, display_name, credential, specialty_code, specialty_display,
               city, state, postal_code, phone, address_line_1
        FROM nppes_v_physicians_specialists
        WHERE postal_code LIKE ?
        ORDER BY display_name ASC
        LIMIT ?
      `
      )
      .all(likePattern, limit);
  } else {
    rows = db.db
      .prepare(
        `
        SELECT npi, display_name, credential, specialty_code, specialty_display,
               city, state, postal_code, phone, address_line_1
        FROM nppes_directory_providers
        WHERE specialty_code GLOB ?
          AND postal_code LIKE ?
          AND entity_type_code = '1'
        ORDER BY display_name ASC
        LIMIT ?
      `
      )
      .all(PHYSICIAN_SPECIALTY_GLOB, likePattern, limit);
  }

  const providers = rows.map(mapProviderRow);

  return {
    providers,
    zip_prefix: zipPrefix,
    total: providers.length,
    data_status: providers.length ? 'ok' : 'empty',
    scope: 'physician_specialist',
  };
}

/**
 * Search dermatology providers (NUCC 207N*) near a US ZIP prefix.
 */
function searchDermatologistsByZip(opts = {}) {
  const zipPrefix = normalizeZip(opts.zip);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(opts.limit) || DEFAULT_LIMIT));

  if (!hasNppesTable()) {
    return { providers: [], zip_prefix: zipPrefix, total: 0, data_status: 'table_missing', scope: 'dermatology' };
  }

  if (!zipPrefix) {
    return { providers: [], zip_prefix: '', total: 0, data_status: 'zip_required', scope: 'dermatology' };
  }

  const likePattern = `${zipPrefix}%`;
  const rows = db.db
    .prepare(
      `
      SELECT npi, display_name, credential, specialty_code, specialty_display,
             city, state, postal_code, phone, address_line_1
      FROM nppes_directory_providers
      WHERE specialty_code GLOB ?
        AND postal_code LIKE ?
        AND entity_type_code = '1'
      ORDER BY display_name ASC
      LIMIT ?
    `
    )
    .all(DERM_SPECIALTY_GLOB, likePattern, limit);

  const providers = rows.map(mapProviderRow);

  return {
    providers,
    zip_prefix: zipPrefix,
    total: providers.length,
    data_status: providers.length ? 'ok' : 'empty',
    scope: 'dermatology',
  };
}

module.exports = {
  searchSpecialistsByZip,
  searchDermatologistsByZip,
  normalizeZip,
  DERM_SPECIALTY_GLOB,
  PHYSICIAN_SPECIALTY_GLOB,
};
