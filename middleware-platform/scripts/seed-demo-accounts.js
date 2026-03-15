/**
 * Seed demo accounts and patients for local development.
 * Creates provider@doclittle.com, patient@doclittle.com, insurer@doclittle.com
 * with password: demo123
 *
 * Also creates FHIR patients (visible in provider portal) with eligibility data
 * (copay, deductible) from Stedi/simulation for medical billing demo.
 *
 * Usage:
 *   node scripts/seed-demo-accounts.js          # seed (creates or updates)
 *   node scripts/seed-demo-accounts.js --reset  # delete demo accounts, then seed
 */

require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

process.chdir(path.join(__dirname, '..'));
const db = require('../database');

const DEMO_PASSWORD = 'demo123';
const RESET = process.argv.includes('--reset');
const DEMO_ACCOUNTS = [
  { email: 'provider@doclittle.com', name: 'Healthcare Provider', role: 'Provider', customer_type: 'saas' },
  { email: 'patient@doclittle.com', name: 'Bala Jones', role: 'Patient', customer_type: 'saas' },
  { email: 'insurer@doclittle.com', name: 'Insurer Admin', role: 'Insurer Admin', customer_type: 'saas' },
];

// FHIR patients for provider portal + patient portal demo (copay, deductible from Stedi/simulation)
const DEMO_FHIR_PATIENTS = [
  {
    patientName: 'Bala Jones',
    email: 'patient@doclittle.com',
    phone: '+15550001001',
    dateOfBirth: '1985-03-15',
    memberId: 'TEST999888',
    payerId: 'UHC',
    // Links to patient@doclittle.com customer
    customerEmail: 'patient@doclittle.com',
  },
  {
    patientName: 'John Smith',
    email: 'john.smith@example.com',
    phone: '+15551234567',
    dateOfBirth: '1980-01-15',
    memberId: '123456789',
    payerId: 'BCBS',
    customerEmail: null,
  },
  {
    patientName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+15559876543',
    dateOfBirth: '1985-05-20',
    memberId: '987654321',
    payerId: 'AETNA',
    customerEmail: null,
  },
  {
    patientName: 'Robert Johnson',
    email: 'robert.johnson@example.com',
    phone: '+15555555555',
    dateOfBirth: '1990-08-10',
    memberId: '456789123',
    payerId: 'UHC',
    customerEmail: null,
  },
];

function getOrCreateDemoMerchant() {
  let merchant = db.getMerchantBySubdomain && db.getMerchantBySubdomain('demo');
  if (merchant) return merchant;

  const merchants = db.getAllMerchants && db.getAllMerchants();
  if (merchants && merchants.length > 0) return merchants[0];

  const merchantId = `merchant_${crypto.randomBytes(8).toString('hex')}`;
  db.createMerchant({
    id: merchantId,
    name: 'Demo Clinic',
    api_key: `managed-${crypto.randomBytes(8).toString('hex')}`,
    api_url: process.env.API_BASE_URL || 'http://localhost:4000',
    webhook_url: null,
    enabled_platforms: JSON.stringify(['voice']),
    status: 'active',
    subdomain: 'demo',
  });
  return db.getMerchantBySubdomain('demo') || db.getMerchant(merchantId);
}

function ensureInsurancePayers() {
  const payers = [
    { payer_id: 'UHC', payer_name: 'UnitedHealthcare' },
    { payer_id: 'BCBS', payer_name: 'Blue Cross Blue Shield' },
    { payer_id: 'AETNA', payer_name: 'Aetna' },
    { payer_id: 'CIGNA', payer_name: 'Cigna' },
  ];
  const sqlite = db.db || db;
  for (const p of payers) {
    const existing = sqlite.prepare('SELECT id FROM insurance_payers WHERE payer_id = ?').get(p.payer_id);
    if (!existing) {
      sqlite.prepare(`
        INSERT INTO insurance_payers (id, payer_id, payer_name, is_active, last_updated)
        VALUES (?, ?, ?, 1, datetime('now'))
      `).run(uuidv4(), p.payer_id, p.payer_name);
    }
  }
}

async function seedFhirPatientsAndEligibility() {
  const FHIRService = require('../services/fhir-service');
  const InsuranceService = require('../services/insurance-service');

  for (const p of DEMO_FHIR_PATIENTS) {
    try {
      const nameParts = p.patientName.split(' ');
      const lastName = nameParts.pop() || 'Unknown';
      const firstName = nameParts.join(' ') || p.patientName;

      let patientResult = await FHIRService.getOrCreatePatient({
        firstName,
        lastName,
        phone: p.phone,
        email: p.email,
        birthDate: p.dateOfBirth,
      }, false);

      if (!patientResult || !patientResult.patient) {
        console.warn('   ⚠️  Could not create FHIR patient:', p.patientName);
        continue;
      }

      const patient = patientResult.patient;
      const patientId = patient.id || patient.resource_id;
      console.log('   ✅ FHIR patient:', p.patientName, '(' + patientId + ')');

      // Ensure FHIR patient name is up to date (e.g. Patient Wallet → Bala Jones)
      const sqlite = db.db || db;
      const fp = sqlite.prepare('SELECT resource_id, name, resource_data FROM fhir_patients WHERE resource_id = ?').get(patientId);
      if (fp && fp.name !== p.patientName) {
        let resourceData = {};
        try { resourceData = typeof fp.resource_data === 'string' ? JSON.parse(fp.resource_data) : fp.resource_data; } catch (_) {}
        resourceData.name = [{ use: 'official', family: lastName, given: [firstName].filter(Boolean) }];
        sqlite.prepare('UPDATE fhir_patients SET name = ?, resource_data = ? WHERE resource_id = ?').run(p.patientName, JSON.stringify(resourceData), patientId);
        console.log('   📝 Updated FHIR patient name to:', p.patientName);
      }

      // Link customer to FHIR patient for patient@doclittle.com
      if (p.customerEmail) {
        const cust = db.getCustomerByEmail(p.customerEmail);
        if (cust && db.updateCustomer) {
          db.updateCustomer(cust.id, { fhir_patient_id: patientId });
          console.log('   🔗 Linked customer', p.customerEmail, '→ FHIR patient');
        }
      }

      // Run eligibility check (Stedi or simulation) to populate copay, deductible
      const eligibilityData = {
        patientName: p.patientName,
        dateOfBirth: p.dateOfBirth,
        memberId: p.memberId,
        payerId: p.payerId,
        serviceCode: '90834',
        dateOfService: new Date().toISOString().split('T')[0],
        patientId,
      };

      const eligResult = await InsuranceService.checkEligibility(eligibilityData);
      if (eligResult && eligResult.success) {
        console.log('   💰 Eligibility:', eligResult.eligible ? 'Yes' : 'No',
          '| Copay $' + (eligResult.copay ?? 0),
          '| Deductible $' + (eligResult.deductibleTotal ?? 'N/A'));
      }

      // Ensure patient_insurance record
      const payerRow = db.db?.prepare?.('SELECT payer_name FROM insurance_payers WHERE payer_id = ?').get(p.payerId);
      const payerName = payerRow?.payer_name || p.payerId;
      const existingPi = db.db?.prepare?.(
        'SELECT id FROM patient_insurance WHERE patient_id = ? AND payer_id = ?'
      ).get(patientId, p.payerId);
      if (!existingPi) {
        db.db?.prepare?.(`
          INSERT OR IGNORE INTO patient_insurance (id, patient_id, payer_id, payer_name, member_id, is_primary, is_verified)
          VALUES (?, ?, ?, ?, ?, 1, 1)
        `).run(uuidv4(), patientId, p.payerId, payerName, p.memberId);
      }
    } catch (err) {
      console.warn('   ⚠️  Error seeding', p.patientName + ':', err.message);
    }
  }
}

/**
 * Seed at least one upcoming Video Consultation appointment for Bala (patient@doclittle.com)
 * so she has a video visit to join from the patient portal / Expo app.
 */
async function seedBalaVideoAppointment() {
  try {
    const sqlite = db.db || db;

    // Find Bala's FHIR patient (created in seedFhirPatientsAndEligibility)
    const balaPatient = sqlite.prepare(
      'SELECT resource_id FROM fhir_patients WHERE name = ? LIMIT 1'
    ).get('Bala Jones');

    if (!balaPatient || !balaPatient.resource_id) {
      console.warn('   ⚠️  Bala FHIR patient not found. Skipping video appointment seed.');
      return;
    }

    const patientId = balaPatient.resource_id;

    // Check if a Video Consultation is already scheduled for Bala
    const existing = sqlite.prepare(`
      SELECT id FROM appointments
      WHERE patient_id = ? 
        AND appointment_type = 'Video Consultation'
        AND status IN ('scheduled', 'confirmed')
      LIMIT 1
    `).get(patientId);

    if (existing && existing.id) {
      console.log('   ✅ Existing Video Consultation for Bala found (appointment:', existing.id + '). Skipping creation.');
      return;
    }

    const now = new Date();
    // Schedule for today at 3:00 PM local (or in 1 hour if past 2:30 PM) so it shows on "today"
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const threePM = new Date(today.getTime() + 15 * 60 * 60 * 1000);
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const start = threePM > now ? threePM : oneHourFromNow;
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const dateStr = start.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = start.toISOString().substring(11, 16); // HH:MM

    const appointmentId = `appt-${crypto.randomBytes(8).toString('hex')}`;
    const clinicId = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID || 'clinic-default';

    const appointment = {
      id: appointmentId,
      clinic_id: clinicId,
      customer_id: null,
      patient_name: 'Bala Jones',
      patient_phone: '+15550001001',
      patient_email: 'patient@doclittle.com',
      patient_id: patientId,
      appointment_type: 'Video Consultation',
      date: dateStr,
      time: timeStr,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      duration_minutes: 30,
      provider: 'DocLittle Mental Health Team',
      status: 'scheduled',
      notes: 'Seeded demo video consultation for Bala (patient@doclittle.com)',
      calendar_event_id: null,
      calendar_link: null,
      video_room_name: `appt-${appointmentId}`,
      created_at: now.toISOString()
    };

    await db.createAppointment(appointment);
    console.log('   ✅ Seeded Video Consultation appointment for Bala (id:', appointmentId + ').');
  } catch (err) {
    console.warn('   ⚠️  Error seeding Bala video appointment:', err.message);
  }
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(RESET ? 'Reset & seed demo accounts (password: demo123)' : 'Seed demo accounts (password: demo123)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (RESET) {
    const sqlite = db.db || db;
    for (const acc of DEMO_ACCOUNTS) {
      const c = db.getCustomerByEmail(acc.email);
      if (c) {
        try {
          if (db.deleteCustomerSessions) db.deleteCustomerSessions(c.id);
          sqlite.prepare('DELETE FROM terms_acceptance WHERE customer_id = ?').run(c.id);
          sqlite.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(c.id);
        } catch (_) {}
        sqlite.prepare('DELETE FROM customers WHERE id = ?').run(c.id);
        console.log('Reset:', acc.email);
      }
    }
  }

  let passwordHash;
  try {
    const bcrypt = require('bcryptjs');
    passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  } catch (err) {
    console.error('bcryptjs required. Run: npm install bcryptjs');
    process.exit(1);
  }

  const merchant = getOrCreateDemoMerchant();
  if (!merchant) {
    console.error('Could not get or create merchant');
    process.exit(1);
  }
  console.log('Using merchant:', merchant.id, merchant.name || '');

  // Ensure clinic-default exists and is linked to merchant (for checkout/payment)
  const clinicId = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID || 'clinic-default';
  const clinic = db.getClinicById ? await db.getClinicById(clinicId) : null;
  if (!clinic) {
    try {
      if (db.createClinic) {
        await db.createClinic({
          clinic_id: clinicId,
          name: 'Default Clinic',
          slug: 'default',
          phone_number: process.env.DEFAULT_CLINIC_PHONE || '+15550000000',
          email: process.env.DEFAULT_CLINIC_EMAIL || 'clinic@doclittle.com',
          merchant_id: merchant.id,
        });
        console.log('Created clinic-default with merchant_id:', merchant.id);
      }
    } catch (e) {
      if (!e.message?.includes('UNIQUE') && !e.message?.includes('duplicate')) console.warn('Could not create clinic-default:', e.message);
    }
  } else if (!clinic.merchant_id && db.updateClinic) {
    db.updateClinic(clinicId, { merchant_id: merchant.id });
    console.log('Linked clinic-default to merchant:', merchant.id);
  }

  for (const acc of DEMO_ACCOUNTS) {
    const existing = db.getCustomerByEmail(acc.email);
    if (existing) {
      db.updateCustomer(existing.id, {
        password_hash: passwordHash,
        email_verified: 1,
        merchant_id: merchant.id,
        status: 'active',
        customer_type: acc.customer_type,
      });
      console.log('Created/Updated:', acc.email);
    } else {
      const customerId = `cust_${crypto.randomBytes(12).toString('hex')}`;
      db.createCustomer({
        id: customerId,
        name: acc.name,
        email: acc.email,
        status: 'active',
        email_verified: 1,
      });
      db.updateCustomer(customerId, {
        password_hash: passwordHash,
        merchant_id: merchant.id,
        customer_type: acc.customer_type,
      });
      console.log('Created:', acc.email);
    }
  }

  if (typeof db.acceptTerms === 'function') {
    for (const acc of DEMO_ACCOUNTS) {
      const c = db.getCustomerByEmail(acc.email);
      if (c) {
        try {
          db.acceptTerms(c.id, '1.0', 'system-seed', 'seed-demo-accounts');
        } catch (_) {}
      }
    }
  }

  if (typeof db.allocateFreeCredits === 'function') {
    for (const acc of DEMO_ACCOUNTS) {
      const c = db.getCustomerByEmail(acc.email);
      if (c) {
        try {
          db.allocateFreeCredits(c.id, 250);
        } catch (_) {}
      }
    }
  }

  console.log('\n🏥 Seeding FHIR patients (provider portal) + eligibility (copay, deductible)...');
  ensureInsurancePayers();
  await seedFhirPatientsAndEligibility();
  console.log('\n📅 Seeding demo Video Consultation appointment for Bala (patient@doclittle.com)...');
  await seedBalaVideoAppointment();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Demo accounts ready. Login with password: demo123');
  console.log('  • Provider → business dashboard (patients, claims)');
  console.log('  • Patient  → patient portal (wallet, copay, deductible)');
  console.log('  • Insurer  → insurer dashboard (claims approval)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
