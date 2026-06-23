/**
 * Seed local patient demo data focused on the LittleLab landing + patient portal journey.
 *
 * Usage:
 *   DB_PATH=./middleware-dev.db node scripts/data/seed-patient-demo.js
 *
 * This is intentionally scoped to:
 * - One canonical demo patient (Bala Jones / patient@callsomo.com)
 * - One upcoming appointment
 * - Optional stub voice_checkout + patient_documents
 */

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

process.chdir(path.join(__dirname, '..'));
const db = require('../../database');

function getOrCreateDemoMerchant() {
  const sqlite = db.db || db;
  const getBySubdomain = db.getMerchantBySubdomain || (() => null);
  let merchant = getBySubdomain('demo');
  if (merchant) return merchant;

  const getAll = db.getAllMerchants || (() => []);
  const merchants = getAll();
  if (merchants && merchants.length > 0) return merchants[0];

  const merchantId = `merchant_${crypto.randomBytes(8).toString('hex')}`;
  sqlite
    .prepare(
      `
      INSERT INTO merchants (id, name, api_key, api_url, webhook_url, enabled_platforms, status, subdomain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      merchantId,
      'Demo Clinic',
      `managed-${crypto.randomBytes(8).toString('hex')}`,
      process.env.API_BASE_URL || 'http://localhost:4000',
      null,
      JSON.stringify(['voice']),
      'active',
      'demo'
    );

  return getBySubdomain('demo') || db.getMerchant(merchantId);
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Seed patient demo data for LittleLab landing → portal journey');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const sqlite = db.db || db;
  const merchant = getOrCreateDemoMerchant();
  if (!merchant) {
    console.error('❌ Could not get or create demo merchant');
    process.exit(1);
  }

  // Reuse existing FHIR + appointment seeding logic via services where possible
  const FHIRService = require('../../services/shared/fhir-service');

  const email = 'patient@callsomo.com';
  const phone = '+15550001001';
  const patientName = 'Bala Jones';
  const [firstName, ...rest] = patientName.split(' ');
  const lastName = rest.join(' ') || 'Jones';

  console.log('🔎 Ensuring FHIR patient exists for', patientName);

  const patientResult = await FHIRService.getOrCreatePatient(
    {
      firstName,
      lastName,
      phone,
      email,
      birthDate: '1985-03-15',
    },
    false
  );

  if (!patientResult || !patientResult.patient) {
    console.error('❌ Could not create or fetch FHIR patient for', patientName);
    process.exit(1);
  }

  const patient = patientResult.patient;
  const patientId = patient.id || patient.resource_id;
  console.log('✅ FHIR patient id:', patientId);

  // Seed one upcoming appointment if none exists
  console.log('🔎 Checking for existing upcoming appointments for Bala...');
  const existing = sqlite
    .prepare(
      `
      SELECT id FROM appointments
      WHERE patient_id = ?
        AND status IN ('scheduled', 'confirmed')
        AND date >= date('now')
      LIMIT 1
    `
    )
    .get(patientId);

  if (existing && existing.id) {
    console.log('✅ Existing upcoming appointment found:', existing.id);
  } else {
    console.log('🆕 Creating new upcoming appointment for Bala...');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(today.getTime() + 24 * 60 * 60 * 1000); // tomorrow
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const dateStr = start.toISOString().split('T')[0];
    const timeStr = start.toISOString().substring(11, 16);

    const appointmentId = `appt-${crypto.randomBytes(8).toString('hex')}`;
    const clinicId =
      process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID || 'clinic-default';

    const appointment = {
      id: appointmentId,
      clinic_id: clinicId,
      customer_id: null,
      patient_name: patientName,
      patient_phone: phone,
      patient_email: email,
      patient_id: patientId,
      appointment_type: 'Video Consultation',
      date: dateStr,
      time: timeStr,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      duration_minutes: 30,
      provider: 'LittleLab Telemedicine',
      status: 'scheduled',
      notes: 'Seeded demo appointment for landing → portal journey',
      calendar_event_id: null,
      calendar_link: null,
      video_room_name: `appt-${appointmentId}`,
      created_at: now.toISOString(),
    };

    await db.createAppointment(appointment);
    console.log('✅ Created appointment:', appointmentId);

    // Optionally create a stub voice_checkout linked to this appointment
    try {
      console.log('🧾 Creating stub voice_checkout for demo appointment...');
      const checkoutId = `vchk_${crypto.randomBytes(8).toString('hex')}`;
      sqlite
        .prepare(
          `
        INSERT INTO voice_checkouts (
          id,
          clinic_id,
          merchant_id,
          product_id,
          product_name,
          quantity,
          amount,
          customer_phone,
          customer_name,
          customer_email,
          appointment_id,
          status,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `
        )
        .run(
          checkoutId,
          clinicId,
          merchant.id,
          'telemed-visit',
          'Telemedicine consultation',
          1,
          150.0,
          phone,
          patientName,
          email,
          appointmentId,
          'authorized'
        );
      console.log('✅ Stub voice_checkout created:', checkoutId);
    } catch (e) {
      console.warn('⚠️  Could not create stub voice_checkout:', e.message);
    }
  }

  // Optional: seed one example patient_document row so records tab is not empty
  try {
    console.log('📄 Ensuring at least one patient_document exists...');
    const docExisting = sqlite
      .prepare(
        'SELECT id FROM patient_documents WHERE patient_id = ? LIMIT 1'
      )
      .get(patientId);
    if (!docExisting) {
      sqlite
        .prepare(
          `
        INSERT INTO patient_documents (
          id, patient_id, file_name, file_type, storage_path, created_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
      `
        )
        .run(
          uuidv4(),
          patientId,
          'insurance-card-demo.png',
          'image/png',
          '/demo/insurance-card-demo.png'
        );
      console.log('✅ Seeded example patient_document row');
    } else {
      console.log('✅ Existing patient_document found, leaving as-is');
    }
  } catch (e) {
    console.warn('⚠️  Could not seed patient_documents:', e.message);
  }

  console.log('✨ Patient demo seed complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed patient demo failed:', err);
  process.exit(1);
});

