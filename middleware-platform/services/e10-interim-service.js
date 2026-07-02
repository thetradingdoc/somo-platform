'use strict';

const db = require('../database');
const { getClinicPmsSettings } = require('./pms/pms-store');

function getSyncStatus(clinicId) {
  const settings = getClinicPmsSettings(clinicId);
  if (!settings) return null;
  let pendingWrites = 0;
  let pendingQueue = 0;
  let recentAppointments = 0;
  if (db.db) {
    try {
      pendingWrites =
        db.db
          .prepare(
            `SELECT COUNT(*) AS c FROM pms_write_log WHERE clinic_id = ? AND status != 'success'`
          )
          .get(clinicId)?.c || 0;
      pendingQueue =
        db.db
          .prepare(`SELECT COUNT(*) AS c FROM pms_sync_queue WHERE clinic_id = ? AND status = 'pending'`)
          .get(clinicId)?.c || 0;
      recentAppointments =
        db.db
          .prepare(
            `
            SELECT COUNT(*) AS c FROM appointments
            WHERE clinic_id = ? AND created_at >= datetime('now', '-7 days')
          `
          )
          .get(clinicId)?.c || 0;
    } catch (_) {}
  }
  const row = db.db?.prepare('SELECT office_type, e10_digest_last_sent_at FROM clinics WHERE clinic_id = ?').get(clinicId);
  return {
    clinic_id: clinicId,
    pms_type: settings.pms_type,
    pms_enabled: settings.pms_enabled,
    pms_last_sync_at: settings.pms_last_sync_at,
    pms_last_error: settings.pms_last_error,
    e10_mode: settings.pms_type === 'somo',
    pending_pms_writes: pendingWrites,
    pending_sync_queue: pendingQueue,
    appointments_last_7d: recentAppointments,
    digest_last_sent_at: row?.e10_digest_last_sent_at || null,
    office_type: row?.office_type || null
  };
}

function buildDigestCsv(clinicId, sinceIso) {
  if (!db.db) return '';
  const since = sinceIso || new Date(Date.now() - 7 * 86400000).toISOString();
  const appts = db.db
    .prepare(
      `
      SELECT id, patient_name, date, time, status, pms_sync_status, appointment_type, created_at
      FROM appointments
      WHERE clinic_id = ? AND datetime(created_at) >= datetime(?)
      ORDER BY created_at DESC
    `
    )
    .all(clinicId, since);
  const lines = [
    'appointment_id,patient_name,date,time,status,pms_sync_status,type,created_at'
  ];
  for (const a of appts) {
    lines.push(
      [
        a.id,
        `"${String(a.patient_name || '').replace(/"/g, '""')}"`,
        a.date,
        a.time,
        a.status,
        a.pms_sync_status,
        a.appointment_type,
        a.created_at
      ].join(',')
    );
  }
  return lines.join('\n');
}

async function sendDigestEmail(clinicId, { to, sinceIso } = {}) {
  const clinic = db.db?.prepare('SELECT name, email FROM clinics WHERE clinic_id = ?').get(clinicId);
  const recipient = to || clinic?.email;
  if (!recipient) {
    return { success: false, error: 'no_recipient' };
  }
  const csv = buildDigestCsv(clinicId, sinceIso);
  const status = getSyncStatus(clinicId);
  const subject = `[Somo] Weekly appointment digest — ${clinic?.name || clinicId}`;
  const body = `PMS sync status (E10 interim):\n\n${JSON.stringify(status, null, 2)}\n\nAppointments CSV attached inline:\n\n${csv}`;
  try {
    const EmailService = require('./email-service');
    if (typeof EmailService.sendEmail === 'function') {
      await EmailService.sendEmail({ to: recipient, subject, text: body });
    } else {
      console.log(JSON.stringify({ component: 'e10_digest', clinic_id: clinicId, to: recipient, subject }));
    }
    db.db?.prepare(`UPDATE clinics SET e10_digest_last_sent_at = datetime('now') WHERE clinic_id = ?`).run(clinicId);
    return { success: true, to: recipient, rows: csv.split('\n').length - 1 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { getSyncStatus, buildDigestCsv, sendDigestEmail };
