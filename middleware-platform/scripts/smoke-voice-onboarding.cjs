/* eslint-disable no-console */
/**
 * Smoke test: voice onboarding intake end-to-end.
 *
 * What it does:
 * - (Best-effort) schedules a voice appointment (requires SMOKE_CLINIC_ID or DEFAULT_CLINIC_ID on server)
 * - submits DOB + country + city via POST /voice/patient/intake
 * - verifies onboarding completeness via POST /voice/patient/intake/status
 *
 * Usage:
 *   API_BASE_URL=http://localhost:4000 node scripts/smoke-voice-onboarding.cjs
 */

const axios = require('axios');

function tomorrowYYYYMMDD() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main() {
  const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
  const uniq = Date.now();
  const patient = {
    patient_name: `Smoke Test ${uniq}`,
    patient_email: `smoke.voice.onb.${uniq}@example.com`,
    patient_phone: '+1555555' + String(uniq).slice(-4),
    first_name: 'Smoke',
    last_name: `Test${uniq}`,
    dob: '1990-01-02',
    country: 'United States',
    city: 'Austin'
  };

  console.log(`Base URL: ${baseUrl}`);

  // Step 1 (best-effort): schedule an appointment so the booking path is exercised too.
  try {
    const scheduleRes = await axios.post(`${baseUrl}/voice/appointments/schedule`, {
      patient_name: patient.patient_name,
      patient_phone: patient.patient_phone,
      patient_email: patient.patient_email,
      appointment_type: 'Mental Health Consultation',
      date: tomorrowYYYYMMDD(),
      time: '10:00',
      timezone: 'America/New_York'
    }, { timeout: 20000 });

    if (scheduleRes.data?.success) {
      console.log(`✅ Scheduled appointment: ${scheduleRes.data.appointment?.id || '(no id)'}`);
    } else {
      console.warn(`⚠️  Schedule appointment did not succeed (continuing): ${scheduleRes.data?.error || 'unknown error'}`);
    }
  } catch (e) {
    console.warn(`⚠️  Schedule appointment step failed (continuing): ${e.response?.data?.error || e.message}`);
  }

  // Step 2: submit onboarding intake
  const intakeRes = await axios.post(`${baseUrl}/voice/patient/intake`, {
    patient_email: patient.patient_email,
    patient_phone: patient.patient_phone,
    first_name: patient.first_name,
    last_name: patient.last_name,
    dob: patient.dob,
    country: patient.country,
    city: patient.city
  }, { timeout: 20000 });

  if (!intakeRes.data?.success) {
    throw new Error(`Intake failed: ${intakeRes.data?.error || 'unknown error'}`);
  }
  console.log(`✅ Saved intake for patient_id=${intakeRes.data.patient_id}`);

  // Step 3: verify onboarding status (voice-friendly endpoint)
  const statusRes = await axios.post(`${baseUrl}/voice/patient/intake/status`, {
    patient_id: intakeRes.data.patient_id,
    patient_email: patient.patient_email,
    patient_phone: patient.patient_phone
  }, { timeout: 20000 });

  if (!statusRes.data?.success) {
    throw new Error(`Status failed: ${statusRes.data?.error || 'unknown error'}`);
  }

  const complete = !!statusRes.data.onboarding_complete;
  const missing = Array.isArray(statusRes.data.missing_fields) ? statusRes.data.missing_fields : [];

  if (!complete) {
    throw new Error(`Expected onboarding_complete=true, got false. missing_fields=${JSON.stringify(missing)}`);
  }

  console.log('✅ onboarding_complete=true');
  console.log('Done.');
}

main().catch((e) => {
  console.error('❌ Smoke test failed:', e.message);
  process.exit(1);
});

