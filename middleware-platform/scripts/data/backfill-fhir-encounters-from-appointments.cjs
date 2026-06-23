/**
 * Batch 5 migration: backfill fhir_encounters from legacy appointments table.
 *
 * We align Encounter.id = appointment.id so existing portal links and DiagnosticReportForAppointment work.
 *
 * Usage:
 *   node scripts/data/backfill-fhir-encounters-from-appointments.cjs
 *
 * Env:
 *   DB_PATH=./middleware-dev.db
 */

const db = require('../../database');
const FHIRResources = require('../../models/fhir-resources');

function encStatusFromAppt(status) {
  return status === 'completed' ? 'finished'
    : status === 'canceled' ? 'cancelled'
    : status === 'live' ? 'in-progress'
    : 'planned';
}

function isoFromStartTime(appt) {
  if (appt.start_time) return appt.start_time;
  if (appt.date && appt.time) {
    try {
      const s = `${appt.date}T${String(appt.time).padStart(5, '0')}:00.000Z`;
      return new Date(s).toISOString();
    } catch (_) {}
  }
  return new Date().toISOString();
}

async function main() {
  const cols = db.db.prepare(`PRAGMA table_info(appointments)`).all().map(c => c.name);
  const has = (c) => cols.includes(c);
  const selectCols = [
    'id',
    'patient_id',
    'patient_name',
    'appointment_type',
    'status',
    has('payment_status') ? 'payment_status' : null,
    'start_time',
    'end_time',
    'date',
    'time',
    has('created_at') ? 'created_at' : null
  ].filter(Boolean).join(', ');

  const appts = db.db.prepare(`
    SELECT ${selectCols}
    FROM appointments
    WHERE deleted_at IS NULL
    ORDER BY datetime(COALESCE(start_time, created_at)) ASC
  `).all();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const a of appts) {
    if (!a.patient_id) { skipped++; continue; }
    const encId = a.id;
    const existing = db.getFHIREncounter ? db.getFHIREncounter(encId) : null;

    const resource = FHIRResources.createEncounter({
      id: encId,
      patientId: a.patient_id,
      patientName: a.patient_name || '',
      callId: encId,
      status: encStatusFromAppt(a.status),
      type: a.appointment_type || 'Telehealth visit',
      startTime: isoFromStartTime(a),
      ...(a.end_time ? { endTime: a.end_time } : {})
    });
    resource.extension = Array.isArray(resource.extension) ? resource.extension : [];
    resource.extension.push({ url: require('../../lib/fhir-brand-identifiers').extensionUrl('appointment-status'), valueString: a.status || 'unknown' });
    if (a.payment_status) resource.extension.push({ url: require('../../lib/fhir-brand-identifiers').extensionUrl('payment-status'), valueString: a.payment_status });

    if (!existing && db.createFHIREncounter) {
      db.createFHIREncounter(resource);
      created++;
    } else if (existing && db.updateFHIREncounter) {
      db.updateFHIREncounter(encId, resource);
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(JSON.stringify({ ok: true, total_appointments: appts.length, created, updated, skipped }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

