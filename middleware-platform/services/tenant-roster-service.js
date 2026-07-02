'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { normalizePhone, createPatientForClinic } = require('./patient-match-service');

const CSV_TEMPLATE = 'full_name,phone,date_of_birth,external_id,email\nJane Doe,+15551234567,1985-03-15,PMS-001,jane@example.com\n';

function parseCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line, idx) => {
    const cols = line.split(',').map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] || '';
    });
    row._line = idx + 2;
    return row;
  });
}

function rosterImportKey(clinicId, row) {
  const ext = row.external_id || row.externalid;
  if (ext) return `${clinicId}:ext:${ext}`;
  const phone = normalizePhone(row.phone);
  if (phone) return `${clinicId}:phone:${phone}`;
  return `${clinicId}:name:${String(row.full_name || row.name || '').toLowerCase()}:${row._line}`;
}

function upsertRosterRow(clinicId, merchantId, row) {
  const name = row.full_name || row.name;
  if (!name) return { ok: false, error: 'missing full_name', line: row._line };
  const importKey = rosterImportKey(clinicId, row);
  if (!db.db) return { ok: false, error: 'db unavailable', line: row._line };

  const existing = db.db
    .prepare(
      `
      SELECT resource_id FROM fhir_patients
      WHERE clinic_id = ? AND roster_import_key = ? AND is_deleted = 0
      LIMIT 1
    `
    )
    .get(clinicId, importKey);

  if (existing) {
    const phone = normalizePhone(row.phone);
    db.db
      .prepare(
        `
        UPDATE fhir_patients
        SET name = ?, phone = COALESCE(?, phone), updated_at = datetime('now'),
            external_ids_json = COALESCE(?, external_ids_json)
        WHERE resource_id = ?
      `
      )
      .run(
        name,
        phone,
        row.external_id ? JSON.stringify({ pms: row.external_id }) : null,
        existing.resource_id
      );
    return { ok: true, action: 'updated', resource_id: existing.resource_id, line: row._line };
  }

  try {
    const result = createPatientForClinic({
      clinicId,
      merchantId,
      name,
      phone: row.phone,
      dob: row.date_of_birth || row.dob,
      externalId: row.external_id,
      rosterImportKey: importKey
    });
    if (result.ambiguous) {
      return { ok: false, error: 'ambiguous_phone_match', line: row._line };
    }
    return {
      ok: true,
      action: result.created ? 'created' : 'existing',
      resource_id: result.patient?.resource_id,
      line: row._line
    };
  } catch (e) {
    return { ok: false, error: e.message, line: row._line };
  }
}

function importRosterCsv(clinicId, merchantId, csvText) {
  const rows = parseCsv(csvText);
  const batchId = `roster_${uuidv4()}`;
  const results = rows.map((row) => upsertRosterRow(clinicId, merchantId, row));
  const summary = {
    batch_id: batchId,
    total: results.length,
    created: results.filter((r) => r.action === 'created').length,
    updated: results.filter((r) => r.action === 'updated').length,
    failed: results.filter((r) => !r.ok).length,
    results
  };
  if (db.db) {
    try {
      db.db
        .prepare(`UPDATE clinics SET pms_last_sync_at = datetime('now') WHERE clinic_id = ?`)
        .run(clinicId);
    } catch (_) {}
  }
  return summary;
}

module.exports = {
  CSV_TEMPLATE,
  parseCsv,
  importRosterCsv,
  rosterImportKey
};
