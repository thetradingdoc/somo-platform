'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');
const { decryptPmsConfig } = require('./pms-config');

function getClinicPmsRow(clinicId) {
  if (!clinicId || !db.db) return null;
  return db.db.prepare('SELECT clinic_id, pms_type, pms_enabled, pms_config, pms_connected_at, pms_last_sync_at, pms_last_error FROM clinics WHERE clinic_id = ?').get(clinicId);
}

function getClinicPmsSettings(clinicId) {
  const row = getClinicPmsRow(clinicId);
  if (!row) return null;
  return {
    clinic_id: row.clinic_id,
    pms_type: row.pms_type || 'somo',
    pms_enabled: row.pms_enabled !== 0 && row.pms_enabled !== false,
    pms_config: decryptPmsConfig(row.pms_config),
    pms_connected_at: row.pms_connected_at || null,
    pms_last_sync_at: row.pms_last_sync_at || null,
    pms_last_error: row.pms_last_error || null
  };
}

function updateClinicPms(clinicId, updates) {
  if (!clinicId || !db.updateClinic) return null;
  return db.updateClinic(clinicId, updates);
}

function setAppointmentPmsFields(appointmentId, { pms_source, pms_external_id, pms_sync_status } = {}) {
  if (!appointmentId || !db.db) return;
  const fields = [];
  const values = [];
  if (pms_source !== undefined) {
    fields.push('pms_source = ?');
    values.push(pms_source);
  }
  if (pms_external_id !== undefined) {
    fields.push('pms_external_id = ?');
    values.push(pms_external_id);
  }
  if (pms_sync_status !== undefined) {
    fields.push('pms_sync_status = ?');
    values.push(pms_sync_status);
  }
  if (!fields.length) return;
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(appointmentId);
  db.db.prepare(`UPDATE appointments SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function findIdempotentWrite(idempotencyKey) {
  if (!idempotencyKey || !db.db) return null;
  return db.db.prepare(`
    SELECT * FROM pms_write_log
    WHERE idempotency_key = ? AND status = 'success'
    LIMIT 1
  `).get(idempotencyKey);
}

function insertPmsWriteLog(entry) {
  if (!db.db) return null;
  const id = entry.id || `pmsw_${uuidv4()}`;
  db.db.prepare(`
    INSERT INTO pms_write_log (
      id, clinic_id, action, resource_type, resource_id, status, error,
      idempotency_key, payload_json, attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    id,
    entry.clinic_id,
    entry.action,
    entry.resource_type || null,
    entry.resource_id || null,
    entry.status,
    entry.error || null,
    entry.idempotency_key || null,
    entry.payload_json ? JSON.stringify(entry.payload_json) : null,
    entry.attempt_count || 1
  );
  if (db.incrementOpsCounter) {
    const counter = entry.status === 'success' ? 'pms_write_success' : 'pms_write_fail';
    try { db.incrementOpsCounter(counter); } catch (_) {}
  }
  return id;
}

function getPendingPmsWrites(limit = 50) {
  if (!db.db) return [];
  return db.db.prepare(`
    SELECT * FROM pms_write_log
    WHERE status = 'failed' AND attempt_count < 3
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit);
}

function bumpPmsWriteAttempt(id, status, error) {
  if (!db.db) return;
  db.db.prepare(`
    UPDATE pms_write_log
    SET status = ?, error = ?, attempt_count = attempt_count + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, error || null, id);
}

function getPmsHealthSummary(clinicId) {
  if (!db.db) return { failures: 0, last_error: null };
  const row = db.db.prepare(`
    SELECT COUNT(*) AS failures FROM pms_write_log
    WHERE clinic_id = ? AND status = 'failed' AND created_at > datetime('now', '-24 hours')
  `).get(clinicId);
  const settings = getClinicPmsSettings(clinicId);
  return {
    failures_24h: row?.failures || 0,
    last_error: settings?.pms_last_error || null,
    pms_type: settings?.pms_type || 'none',
    pms_enabled: !!settings?.pms_enabled
  };
}

module.exports = {
  getClinicPmsRow,
  getClinicPmsSettings,
  updateClinicPms,
  setAppointmentPmsFields,
  findIdempotentWrite,
  insertPmsWriteLog,
  getPendingPmsWrites,
  bumpPmsWriteAttempt,
  getPmsHealthSummary
};
