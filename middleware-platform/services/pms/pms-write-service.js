'use strict';

const { PmsHub } = require('./pms-hub');
const {
  getPendingPmsWrites,
  bumpPmsWriteAttempt
} = require('./pms-store');

async function retryFailedWrites(limit = 20) {
  const pending = getPendingPmsWrites(limit);
  const results = [];
  for (const row of pending) {
    try {
      const hub = PmsHub.tryForClinic(row.clinic_id);
      if (!hub) {
        bumpPmsWriteAttempt(row.id, 'failed', 'PMS disabled');
        results.push({ id: row.id, ok: false, error: 'PMS disabled' });
        continue;
      }
      const payload = row.payload_json ? JSON.parse(row.payload_json) : {};
      if (row.action === 'write_note') {
        const r = await hub.writeNote(payload, { idempotency_key: row.idempotency_key });
        bumpPmsWriteAttempt(row.id, r.success ? 'success' : 'failed', r.error);
      } else if (row.action === 'book_appointment' && payload.date && payload.time) {
        const r = await hub.bookAppointment(payload, { idempotency_key: row.idempotency_key });
        bumpPmsWriteAttempt(row.id, r.success ? 'success' : 'failed', r.error);
      } else {
        bumpPmsWriteAttempt(row.id, 'failed', 'retry not supported for action');
      }
      results.push({ id: row.id, ok: true });
    } catch (e) {
      bumpPmsWriteAttempt(row.id, 'failed', e.message);
      results.push({ id: row.id, ok: false, error: e.message });
    }
  }
  return results;
}

async function writeCopayNote(clinicId, { appointment_id, patient_id, amount, reference, session_id } = {}) {
  const hub = PmsHub.tryForClinic(clinicId);
  if (!hub) return { success: false, skipped: true };
  const text = `Copay $${Number(amount).toFixed(2)} collected via Somo${reference ? ` ref ${reference}` : ''}${session_id ? ` session ${session_id}` : ''}`;
  return hub.writeNote(
    {
      appointment_id,
      patient_id,
      text,
      note_type: 'copay_collected'
    },
    { idempotency_key: reference ? `copay:${reference}` : undefined }
  );
}

async function writeEligibilityNote(clinicId, { appointment_id, patient_id, member_id, payer_id } = {}) {
  const hub = PmsHub.tryForClinic(clinicId);
  if (!hub) return { success: false, skipped: true };
  const text = `Eligibility verified via Somo. Member ${member_id || 'on file'}${payer_id ? ` payer ${payer_id}` : ''}`;
  return hub.writeNote(
    { appointment_id, patient_id, text, note_type: 'eligibility' },
    { idempotency_key: appointment_id ? `elig:${appointment_id}` : undefined }
  );
}

function startPmsWriteRetryWorker(intervalMs = 5 * 60 * 1000) {
  if (process.env.PMS_WRITE_RETRY_ENABLED === '0') return;
  setInterval(() => {
    retryFailedWrites(10).catch((e) => {
      console.warn('[PmsWriteRetry]', e.message);
    });
  }, intervalMs).unref?.();
}

module.exports = {
  retryFailedWrites,
  writeCopayNote,
  writeEligibilityNote,
  startPmsWriteRetryWorker
};
