'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const FHIRResources = require('../models/fhir-resources');

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone ? String(phone).trim() : null;
}

function findPatientsByPhone(clinicId, phone) {
  if (!clinicId || !phone || !db.db) return [];
  const normalized = normalizePhone(phone);
  const rows = db.db
    .prepare(
      `
      SELECT * FROM fhir_patients
      WHERE is_deleted = 0 AND clinic_id = ? AND phone = ?
      ORDER BY created_at DESC
    `
    )
    .all(clinicId, normalized);
  return rows.map((row) => ({
    ...row,
    resource_data: typeof row.resource_data === 'string' ? JSON.parse(row.resource_data) : row.resource_data
  }));
}

function matchPatient({ clinicId, phone, dob, name } = {}) {
  const candidates = findPatientsByPhone(clinicId, phone);
  if (!candidates.length) {
    return { status: 'no_match', patient: null, candidates: [] };
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous', patient: null, candidates };
  }
  const patient = candidates[0];
  if (name && patient.name) {
    const n1 = String(name).toLowerCase().replace(/\s+/g, ' ').trim();
    const n2 = String(patient.name).toLowerCase().replace(/\s+/g, ' ').trim();
    if (n1 && n2 && !n1.includes(n2.split(' ')[0])) {
      return { status: 'ambiguous', patient: null, candidates: [patient] };
    }
  }
  return { status: 'matched', patient, candidates: [patient] };
}

function createPatientForClinic({ clinicId, merchantId, name, phone, dob, externalId, rosterImportKey } = {}) {
  if (!clinicId || !name) {
    throw new Error('clinic_id and name required');
  }
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone) {
    const existing = matchPatient({ clinicId, phone: normalizedPhone });
    if (existing.status === 'matched') return { created: false, patient: existing.patient };
    if (existing.status === 'ambiguous') {
      return { created: false, ambiguous: true, candidates: existing.candidates };
    }
  }
  const parts = String(name).trim().split(/\s+/);
  const given = parts.slice(0, -1).join(' ') || parts[0];
  const family = parts.length > 1 ? parts[parts.length - 1] : 'Unknown';
  const resourceId = `Patient/${uuidv4()}`;
  const resource = FHIRResources.createPatient({
    id: resourceId.replace(/^Patient\//, ''),
    firstName: given,
    lastName: family,
    birthDate: dob || undefined,
    phone: normalizedPhone || undefined
  });
  resource.merchant_id = merchantId || null;
  const externalIds = externalId ? { pms: externalId } : {};
  if (!db.db) throw new Error('Database unavailable');
  db.db
    .prepare(
      `
      INSERT INTO fhir_patients (
        resource_id, resource_data, phone, email, name, merchant_id, clinic_id,
        external_ids_json, roster_import_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `
    )
    .run(
      resource.id,
      JSON.stringify(resource),
      normalizedPhone,
      null,
      `${given} ${family}`.trim(),
      merchantId || null,
      clinicId,
      Object.keys(externalIds).length ? JSON.stringify(externalIds) : null,
      rosterImportKey || null
    );
  const row = db.db.prepare('SELECT * FROM fhir_patients WHERE resource_id = ?').get(resource.id);
  return {
    created: true,
    patient: {
      ...row,
      resource_data: resource
    }
  };
}

function enqueuePmsSyncJob({ clinicId, action, resourceType, resourceId, payload } = {}) {
  if (!db.db || !clinicId) return null;
  const id = `psq_${uuidv4()}`;
  db.db
    .prepare(
      `
      INSERT INTO pms_sync_queue (
        id, clinic_id, action, resource_type, resource_id, payload_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(id, clinicId, action, resourceType || null, resourceId || null, payload ? JSON.stringify(payload) : null);
  return id;
}

module.exports = {
  normalizePhone,
  findPatientsByPhone,
  matchPatient,
  createPatientForClinic,
  enqueuePmsSyncJob
};
