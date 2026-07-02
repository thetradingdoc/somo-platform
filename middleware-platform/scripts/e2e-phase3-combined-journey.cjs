#!/usr/bin/env node
'use strict';

/**
 * Thin Phase 3 combined journey: book via hub → eligibility note → pending copay note.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const PmsBooking = require('../services/pms/pms-booking');
const { writeCopayNote, writeEligibilityNote } = require('../services/pms/pms-write-service');

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
  const base = 10 + (seed % 5);
  const min = (seed * 11) % 45 + 15;
  const h12 = base > 12 ? base - 12 : base;
  const ampm = base >= 12 ? 'PM' : 'AM';
  return [`${h12}:${String(min).padStart(2, '0')} ${ampm}`];
}

async function bookWithRetries(sessionKey, uniqueName, phone) {
  for (let dayOffset = 21; dayOffset <= 35; dayOffset++) {
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
    const candidates = slotList.length ? slotList : fallbackTimes(dayOffset);

    for (let i = 0; i < candidates.length; i++) {
      const booked = await PmsBooking.scheduleAppointment(
        {
          clinic_id: CLINIC,
          patient_name: uniqueName,
          patient_phone: phone,
          patient_email: `combined-${sessionKey}@example.com`,
          appointment_type: 'General Consult',
          date,
          time: candidates[i],
          timezone: 'America/New_York'
        },
        { idempotency_key: `combined-book:${sessionKey}:${date}:${i}` }
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

  const sessionKey = `combined-${uuidv4()}`;
  const phone = `+1555${Date.now().toString().slice(-7)}`;
  const uniqueName = `Combined E2E ${sessionKey.slice(-6)}`;

  const booked = await bookWithRetries(sessionKey, uniqueName, phone);
  if (!booked?.success) {
    console.error('❌ book failed:', booked?.error || booked);
    process.exit(1);
  }

  const apptId = booked.appointment?.id || booked.pms_external_id;
  const patientId = booked.appointment?.patient_id || booked.patient_id || null;

  const elig = await writeEligibilityNote(CLINIC, {
    appointment_id: apptId,
    patient_id: patientId,
    member_id: 'MOCK-MEMBER-001',
    payer_id: 'MOCK-PAYER'
  });
  if (!elig?.success) {
    console.error('❌ eligibility note failed:', elig);
    process.exit(1);
  }

  const payToken = `pay-${sessionKey}`;
  const pending = await writeCopayNote(CLINIC, {
    appointment_id: apptId,
    patient_id: patientId,
    amount: 30,
    reference: `pending:${payToken}`,
    session_id: sessionKey
  });
  if (!pending?.success) {
    console.error('❌ pending copay note failed:', pending);
    process.exit(1);
  }

  console.log('✅ Combined journey: book + eligibility note + pending copay note');
  console.log(`   appointment_id=${apptId} session=${sessionKey}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
