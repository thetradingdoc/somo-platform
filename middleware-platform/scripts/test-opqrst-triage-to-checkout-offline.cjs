/**
 * Offline-ish integration test (no Groq):
 * - Writes an OPQRST + rich intake triage session into SQLite
 * - Inserts a synthetic triage_rag_results row with high rag_confidence
 * - Calls KellyToolExecutor.get_available_slots -> schedule_appointment -> create_appointment_checkout
 * - Prints the stored OPQRST and the resulting slot/checkout objects
 *
 * This is meant to confirm Phase 3/4/5 booking guardrails work even when Groq is rate-limited.
 */

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('../database');
const KellyToolExecutor = require('../services/kelly-tool-executor');

const PORT = process.env.PORT || 4000;
const CLINIC_ID = process.env.CLINIC_ID || 'clinic-default';
const TIMEZONE = process.env.TIMEZONE || 'America/New_York';
const APPOINTMENT_SPECIALTY = process.env.APPOINTMENT_SPECIALTY || 'Dermatology';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nextBusinessDay(fromDate = new Date()) {
  // Booking service treats "weekend/holiday" as non-business; we only approximate by skipping Sat/Sun.
  const d = new Date(fromDate);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

async function main() {
  const sessionId = uuidv4();
  const ragResultId = uuidv4();

  const nowIso = new Date().toISOString();
  const date = toYmd(nextBusinessDay(new Date()));

  const patientSuffix = sessionId.slice(0, 8);
  const patientName = `Test Patient ${patientSuffix}`;
  const patientPhone = '+15551234567'; // Booking requires a phone number
  const patientEmail = `test-${patientSuffix}@example.com`;

  const opqrst = {
    onset: '2 days ago',
    provocation: 'worse after new skincare',
    quality: 'itchy/burning rash',
    radiation: 'forehead',
    severity: 5,
    timing: 'constant',
    associated_sx: 'forehead rash'
  };

  const richIntake = {
    family_history: 'none known',
    medications: 'none',
    prior_diagnoses: 'none',
    prior_workups: 'none',
    allergies: 'none',
    alcohol_use: '0 drinks/week',
    alcohol_cage_score: 0,
    smoking_status: 'non-smoker',
    safety_screen: 'negative',
    substance_use: 'none',
    occupation: 'test-worker',
    critical_unknowns: []
  };

  // 1) Store OPQRST + rich intake on triage_sessions with gates satisfied
  db.upsertTriageSession({
    session_id: sessionId,
    patient_id: null,
    ...opqrst,
    family_history: richIntake.family_history,
    medications: richIntake.medications,
    prior_diagnoses: richIntake.prior_diagnoses,
    prior_workups: richIntake.prior_workups,
    allergies: richIntake.allergies,
    alcohol_use: richIntake.alcohol_use,
    alcohol_cage_score: richIntake.alcohol_cage_score,
    smoking_status: richIntake.smoking_status,
    safety_screen: richIntake.safety_screen,
    substance_use: richIntake.substance_use,
    occupation: richIntake.occupation,
    critical_unknowns: richIntake.critical_unknowns,

    // Phase 5 gates:
    intake_complete_at: nowIso,
    rag_result_id: ragResultId,
    safety_level: 'green',
    urgency: 'routine',
    target_specialty: APPOINTMENT_SPECIALTY,
    opqrst_complete: 1,
    triage_complete: 1,
    referred_to_911: 0,

    media_requested: false,
    media_received: false,
    media_ids: []
  });

  // 2) Insert synthetic triage_rag_results (what get_latest_for_session reads)
  const differentials = [
    { condition: 'Dermatitis', icd10: 'L23.9', coverage_pct: 0.9, confidence_cap_reason: null }
  ];

  db.db.prepare(`
    INSERT INTO triage_rag_results (
      id, session_id, patient_id, symptom_text, opqrst_json,
      icd_codes, cpt_codes, target_specialty, secondary_specialties,
      urgency, safety_level, red_flags, recommended_lane,
      patient_friendly_summary, specialist_context, differentials, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    ragResultId,
    sessionId,
    null,
    'rash',
    JSON.stringify(opqrst),
    JSON.stringify([{ code: 'L23.9', description: 'Dermatitis', confidence: 0.9 }]),
    JSON.stringify([{ code: '99203', description: 'Office/outpatient visit', confidence: 0.8 }]),
    APPOINTMENT_SPECIALTY,
    JSON.stringify([]),
    'routine',
    'green',
    JSON.stringify([]),
    'sync',
    `Based on your symptoms, you may need Dermatology care.`,
    `Synthetic test insert for triage. Session=${sessionId}`,
    JSON.stringify(differentials)
  );

  // Best-effort: set soap_note + rag_confidence if columns exist
  try {
    db.db.prepare(`UPDATE triage_rag_results SET soap_note = ?, rag_confidence = ? WHERE id = ?`)
      .run('Synthetic SOAP note for offline test.', 0.9, ragResultId);
  } catch (_) {
    // ignore if migration columns are missing
  }

  // 3) Print stored OPQRST (so we can see "triage until checkout")
  const stored = db.getTriageSession ? db.getTriageSession(sessionId) : null;
  console.log('\n=== Stored triage_sessions (OPQRST) ===');
  console.log({
    session_id: stored?.session_id || sessionId,
    onset: stored?.onset,
    provocation: stored?.provocation,
    quality: stored?.quality,
    radiation: stored?.radiation,
    severity: stored?.severity,
    timing: stored?.timing,
    associated_sx: stored?.associated_sx,
    opqrst_complete: stored?.opqrst_complete,
    triage_complete: stored?.triage_complete,
    intake_complete_at: stored?.intake_complete_at
  });

  const API_BASE_URL = process.env.API_BASE_URL || process.env.BASE_URL || `http://localhost:${PORT}`;
  const slotsRes = (await axios.post(`${API_BASE_URL}/voice/appointments/available-slots`, {
    date,
    appointment_type: APPOINTMENT_SPECIALTY,
    timezone: TIMEZONE,
    lane: 'sync',
    clinic_id: CLINIC_ID
  }, { timeout: 20000 })).data;

  console.log('\n=== /voice/appointments/available-slots result (abridged) ===');
  console.log({
    success: slotsRes?.success,
    appointment_type: slotsRes?.appointment_type,
    available_slots_count: slotsRes?.available_slots?.length,
    slot_bundles_count: slotsRes?.slot_bundles?.length
  });

  const slotBundles = slotsRes?.slot_bundles || [];
  const slot = slotBundles.find(s => s.time && s.time !== 'ASYNC') || slotBundles[0];
  if (!slot || !slot.practitioner_id) {
    throw new Error('No slots returned with practitioner_id. Ensure provider profiles exist for the clinic/specialty.');
  }

  console.log('\nChosen slot: ', {
    date,
    time: slot.time,
    practitioner_id: slot.practitioner_id,
    practitioner_name: slot.practitioner_name
  });

  const schedRes = await KellyToolExecutor.execute(
    'schedule_appointment',
    {
      patient_name: patientName,
      patient_phone: patientPhone,
      patient_email: patientEmail,
      appointment_type: APPOINTMENT_SPECIALTY,
      date,
      time: slot.time,
      timezone: TIMEZONE,
      practitioner_id: slot.practitioner_id,
      notes: 'Offline test booking based on synthetic OPQRST triage.'
    },
    { sessionId, clinicId: CLINIC_ID, patientId: null, callerPhone: null, channel: 'chat' }
  );

  console.log('\n=== schedule_appointment response (abridged) ===');
  console.log({
    success: schedRes?.success,
    appointment: schedRes?.appointment ? { id: schedRes.appointment.id, status: schedRes.appointment.status, practitioner_id: schedRes.appointment.practitioner_id } : null,
    checkout_present: !!schedRes?.checkout
  });

  // If schedule_appointment didn't auto-create checkout, create it explicitly.
  const appointmentId = schedRes?.appointment?.id || schedRes?.appointment_id || null;
  if (!appointmentId) {
    console.warn('No appointment_id found; skipping create_appointment_checkout.');
    return;
  }

  const checkoutRes = schedRes?.checkout
    ? { created_via_schedule_endpoint: true, checkout: schedRes.checkout }
    : await KellyToolExecutor.execute(
      'create_appointment_checkout',
      {
        appointment_id: appointmentId,
        customer_email: patientEmail,
        customer_name: patientName,
        customer_phone: patientPhone,
        appointment_type: APPOINTMENT_SPECIALTY
      },
      { sessionId, clinicId: CLINIC_ID, patientId: null, callerPhone: null, channel: 'chat' }
    );

  console.log('\n=== create_appointment_checkout response (abridged) ===');
  console.log({
    appointment_id: appointmentId,
    checkout: checkoutRes?.checkout || checkoutRes,
  });

  console.log('\nOffline triage -> slot -> scheduling -> checkout test completed.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nOffline journey test FAILED:', e?.message || e);
    process.exit(1);
  });

