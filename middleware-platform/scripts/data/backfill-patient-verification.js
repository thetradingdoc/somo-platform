#!/usr/bin/env node

/**
 * Backfill script:
 * - Safely set profile_verified / insurance_verified for trusted patients.
 * - Link older appointments to patient_id where possible via email/phone.
 *
 * Usage:
 *   NODE_ENV=development node scripts/data/backfill-patient-verification.js
 */

/* eslint-disable no-console */

const path = require('path');
const db = require('../../database');

function backfillPatientVerification() {
  console.log('🔄 Backfill: profile_verified / insurance_verified (DISABLED FOR DEMO)');
  try {
    console.log('ℹ️ Skipping automatic profile/insurance verification so onboarding can run normally.');
  } catch (e) {
    console.error('❌ Backfill profile_verified failed:', e.message);
  }
}

function backfillAppointmentPatientIds() {
  console.log('🔄 Backfill: appointments.patient_id via email/phone');
  try {
    const appts = db.db.prepare(`
      SELECT id, patient_email, patient_phone, patient_id
      FROM appointments
      WHERE patient_id IS NULL
        AND (patient_email IS NOT NULL OR patient_phone IS NOT NULL)
    `).all();

    const updateStmt = db.db.prepare(`
      UPDATE appointments
      SET patient_id = ?
      WHERE id = ?
    `);

    let linked = 0;
    for (const a of appts) {
      let patient = null;
      if (a.patient_email) {
        try {
          patient = db.getFHIRPatientByEmail && db.getFHIRPatientByEmail(a.patient_email);
        } catch (_) {}
      }
      if (!patient && a.patient_phone) {
        try {
          patient = db.getFHIRPatientByPhone && db.getFHIRPatientByPhone(a.patient_phone);
        } catch (_) {}
      }
      if (patient && patient.resource_id) {
        updateStmt.run(patient.resource_id, a.id);
        linked += 1;
      }
    }
    console.log(`✅ Backfill appointments.patient_id: linked ${linked} appointments`);
  } catch (e) {
    console.error('❌ Backfill appointments.patient_id failed:', e.message);
  }
}

function main() {
  console.log('🏁 Starting patient verification backfill');
  backfillPatientVerification();
  backfillAppointmentPatientIds();
  console.log('🏁 Backfill complete');
}

if (require.main === module) {
  main();
}

