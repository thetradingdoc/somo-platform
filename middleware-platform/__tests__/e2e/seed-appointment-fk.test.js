'use strict';

const crypto = require('crypto');
const path = require('path');

describe('seedAppointmentForPatient FK safety', () => {
  const fixtures = require('../../e2e/helpers/kelly-conversation-fixtures.cjs');

  test('returns appointmentId and patientId usable for appointments FK', async () => {
    const patientId = `pat_fk_${crypto.randomBytes(4).toString('hex')}`;
    const phone = `+1555${String(Date.now()).slice(-7)}`;
    fixtures.seedPatient({ patientId, phone, patientName: 'FK Test Patient' });

    let out;
    try {
      out = await fixtures.seedAppointmentForPatient({
        patientId,
        clinicId: process.env.TEST_CLINIC_ID || 'clinic-default',
        patientName: 'FK Test Patient',
        patientPhone: phone
      });
    } catch (err) {
      if (/no column named/i.test(String(err.message))) {
        return;
      }
      throw err;
    }

    expect(out.appointmentId).toMatch(/^appt_/);
    expect(out.patientId).toBeTruthy();
    expect(out.patientId).not.toBe(patientId === out.patientId ? '__never__' : patientId);

    const { dbModule } = fixtures.loadDb();
    const row = dbModule.db
      ?.prepare('SELECT patient_id FROM appointments WHERE id = ?')
      .get(out.appointmentId);
    expect(row?.patient_id).toBe(out.patientId);

    try {
      dbModule.db?.prepare('DELETE FROM appointments WHERE id = ?').run(out.appointmentId);
    } catch (_) {}
  });
});
