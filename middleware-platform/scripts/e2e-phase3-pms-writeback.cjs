#!/usr/bin/env node
'use strict';

/**
 * Phase 3 E2E scenario 6 — schedule via hub + copay note write-back (Somo adapter).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const PmsBooking = require('../services/pms/pms-booking');
const { writeCopayNote } = require('../services/pms/pms-write-service');

const CLINIC =
  process.env.PHASE3_PILOT_CLINIC_ID ||
  process.env.PHASE2_PILOT_CLINIC_ID ||
  'clinic-da8523ab-ab4b-4da8-b9c0-4694850a3f34';

function weekdayDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function fallbackTimes(seed) {
  const base = 9 + (seed % 6);
  const min = (seed * 7) % 50 + 10;
  const h12 = base > 12 ? base - 12 : base;
  const ampm = base >= 12 ? 'PM' : 'AM';
  return [`${h12}:${String(min).padStart(2, '0')} ${ampm}`];
}

async function bookWithRetries(sessionKey, uniqueName, phone) {
  for (let dayOffset = 14; dayOffset <= 28; dayOffset++) {
    const date = weekdayDate(dayOffset);
    const slots = await PmsBooking.getAvailableSlots(
      date,
      null,
      'General Consult',
      'America/New_York',
      CLINIC,
      null
    );
    const slotList = slots?.available_slots || slots?.slots || [];
    const candidates = slotList.length ? slotList : fallbackTimes(dayOffset + Date.now() % 5);

    for (let i = 0; i < candidates.length; i++) {
      const time = candidates[i];
      const booked = await PmsBooking.scheduleAppointment(
        {
          clinic_id: CLINIC,
          patient_name: uniqueName,
          patient_phone: phone,
          patient_email: `phase3-e2e-${sessionKey}@example.com`,
          appointment_type: 'General Consult',
          date,
          time,
          timezone: 'America/New_York'
        },
        { idempotency_key: `book:${sessionKey}:${date}:${i}` }
      );
      if (booked?.success) return booked;
    }
  }
  return { success: false, error: 'no slot after retries' };
}

async function main() {
  process.chdir(path.join(__dirname, '..'));
  const db = require('../database');
  const mig = require('../migrations/099_phase3_pms_connect');
  if (mig?.up && db.db) mig.up(db.db);

  const sessionKey = `e2e6-${uuidv4()}`;
  const uniqueName = `Phase3 E2E ${sessionKey.slice(-8)}`;
  const phone = `+1555${Date.now().toString().slice(-7)}`;

  const booked = await bookWithRetries(sessionKey, uniqueName, phone);

  if (!booked?.success) {
    console.error('❌ book failed:', booked?.error || booked);
    process.exit(1);
  }

  const apptId = booked.appointment?.id || booked.pms_external_id;
  const note = await writeCopayNote(CLINIC, {
    appointment_id: apptId,
    amount: 25,
    reference: sessionKey,
    session_id: sessionKey
  });

  if (!note?.success) {
    console.error('❌ copay note failed:', note);
    process.exit(1);
  }

  const log = db.db.prepare(`
    SELECT * FROM pms_write_log WHERE clinic_id = ? AND action = 'write_note' ORDER BY created_at DESC LIMIT 1
  `).get(CLINIC);

  const out = {
    pass: true,
    clinic_id: CLINIC,
    appointment_id: apptId,
    note,
    pms_write_log: log ? { id: log.id, status: log.status } : null,
    at: new Date().toISOString()
  };

  const fs = require('fs');
  const outDir = path.join(__dirname, '..', 'var', 'evidence', 'phase3');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'sandbox-acceptance.json'), JSON.stringify(out, null, 2));

  console.log('✅ Phase 3 E2E scenario 6 pass', apptId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
