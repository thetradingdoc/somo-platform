'use strict';

const db = require('../database');
const { getClinicPmsSettings } = require('./pms/pms-store');
const { escapeHtml } = require('../lib/somo-email-layout');

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

function buildDigestHtml(clinic, status, appointments) {
  const practice = escapeHtml(clinic?.name || 'Your practice');
  const rows = (appointments || [])
    .map(
      (a) =>
        `<tr><td>${escapeHtml(a.patient_name || '—')}</td><td>${escapeHtml(a.date || '')}</td><td>${escapeHtml(a.time || '')}</td><td>${escapeHtml(a.status || '')}</td><td>${escapeHtml(a.pms_sync_status || 'pending')}</td></tr>`
    )
    .join('');
  const pending = Number(status?.pending_pms_writes || 0) + Number(status?.pending_sync_queue || 0);
  const settingsUrl = escapeHtml(
    `${String(process.env.BASE_URL || 'https://app.somo.health').replace(/\/$/, '')}/business/settings.html#connected`
  );
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;color:#1a1a1a;max-width:640px;margin:0 auto;padding:24px;">
  <h1 style="font-size:20px;margin-bottom:8px;">Somo appointment digest</h1>
  <p style="color:#555;">${practice} — manual PMS sync mode</p>
  <p><strong>${pending}</strong> appointment(s) pending PMS entry.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;" cellpadding="8">
    <thead><tr style="background:#f4f4f5;text-align:left;">
      <th>Patient</th><th>Date</th><th>Time</th><th>Status</th><th>PMS sync</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No recent appointments</td></tr>'}</tbody>
  </table>
  <p style="margin-top:24px;"><a href="${settingsUrl}">Open Settings → Connected systems</a></p>
</body></html>`;
}

function listRecentAppointments(clinicId, sinceIso) {
  if (!db.db) return [];
  const since = sinceIso || new Date(Date.now() - 7 * 86400000).toISOString();
  return db.db
    .prepare(
      `SELECT id, patient_name, date, time, status, pms_sync_status, appointment_type, created_at
       FROM appointments
       WHERE clinic_id = ? AND datetime(created_at) >= datetime(?)
       ORDER BY created_at DESC
       LIMIT 50`
    )
    .all(clinicId, since);
}

async function sendDigestEmail(clinicId, { to, sinceIso } = {}) {
  const clinic = db.db?.prepare('SELECT name, email FROM clinics WHERE clinic_id = ?').get(clinicId);
  const recipient = to || clinic?.email;
  if (!recipient) {
    return { success: false, error: 'no_recipient' };
  }
  const csv = buildDigestCsv(clinicId, sinceIso);
  const status = getSyncStatus(clinicId);
  const appointments = listRecentAppointments(clinicId, sinceIso);
  const subject = `[Somo] Daily appointment digest — ${clinic?.name || clinicId}`;
  const html = buildDigestHtml(clinic, status, appointments);
  const text = `PMS sync status (E10 interim):\n\n${JSON.stringify(status, null, 2)}\n\nAppointments CSV:\n\n${csv}`;
  try {
    const EmailService = require('./email-service');
    if (typeof EmailService.sendEmail === 'function') {
      await EmailService.sendEmail({ to: recipient, subject, text, html });
    } else {
      console.log(JSON.stringify({ component: 'e10_digest', clinic_id: clinicId, to: recipient, subject }));
    }
    db.db?.prepare(`UPDATE clinics SET e10_digest_last_sent_at = datetime('now') WHERE clinic_id = ?`).run(clinicId);
    return { success: true, to: recipient, rows: csv.split('\n').length - 1 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function maybeTriggerDigestOnBooking(clinicId) {
  if (String(process.env.E10_DIGEST_ON_BOOKING || '') !== '1') return;
  const sync = getSyncStatus(clinicId);
  if (!sync) return;
  if (sync.pms_enabled && sync.pms_type !== 'somo') return;

  const row = db.db?.prepare('SELECT e10_digest_last_sent_at FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (row?.e10_digest_last_sent_at) {
    const last = new Date(row.e10_digest_last_sent_at);
    const now = new Date();
    if (last.toDateString() === now.toDateString()) return;
  }

  setImmediate(() => {
    sendDigestEmail(clinicId).catch((err) => {
      console.warn('[e10_digest] booking trigger failed:', err.message);
    });
  });
}

module.exports = { getSyncStatus, buildDigestCsv, sendDigestEmail, maybeTriggerDigestOnBooking };
