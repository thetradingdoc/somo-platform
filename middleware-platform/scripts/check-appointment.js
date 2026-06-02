#!/usr/bin/env node
/**
 * Check for appointments between a specific patient and provider
 * Usage: node scripts/check-appointment.js "Jeremiah Richard" "provider@doclittle.com"
 */

require('dotenv').config();
const db = require('../database');

const patientName = process.argv[2] || 'Jeremiah Richard';
const providerEmail = process.argv[3] || 'provider@doclittle.com';

function main() {
  console.log('\n🔍 Appointment search');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Patient name: ${patientName}`);
  console.log(`Provider: ${providerEmail}\n`);

  try {
    // Get all appointments for clinic-default
    const all = db.getAllAppointments({ clinic_id: 'clinic-default' });
    if (all.length === 0) {
      console.log('No appointments in database for clinic-default.');
      process.exit(0);
    }

    // Filter by patient name (case-insensitive partial match)
    const patientMatch = (pn) =>
      (pn || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .includes(patientName.toLowerCase().replace(/\s+/g, ' ').trim());

    // Filter by provider (can be name or email)
    const providerMatch = (p) =>
      p &&
      (String(p).toLowerCase().includes(providerEmail.toLowerCase()) ||
        String(p).toLowerCase() === providerEmail.toLowerCase());

    const matches = all.filter(
      (a) => patientMatch(a.patient_name) && providerMatch(a.provider)
    );

    if (matches.length === 0) {
      // Also try provider_email if that column exists
      const byPatient = all.filter((a) => patientMatch(a.patient_name));
      const byProvider = all.filter((a) =>
        providerMatch(a.provider) || providerMatch(a.provider_email)
      );
      console.log(`Found ${byPatient.length} appointment(s) for patient "${patientName}"`);
      console.log(`Found ${byProvider.length} appointment(s) for provider "${providerEmail}"`);
      if (byPatient.length > 0) {
        console.log('\nAppointments for this patient:');
        byPatient.forEach((a) => {
          console.log(
            `  - ${a.date} ${a.time} | ${a.appointment_type} | provider: ${a.provider} | status: ${a.status}`
          );
        });
      }
      if (byProvider.length > 0 && byPatient.length === 0) {
        console.log('\nAppointments for this provider:');
        byProvider.slice(0, 10).forEach((a) => {
          console.log(
            `  - ${a.date} ${a.time} | ${a.patient_name} | ${a.appointment_type} | status: ${a.status}`
          );
        });
      }
      console.log('\n❌ No appointment found between Jeremiah Richard and provider@doclittle.com');
      process.exit(0);
    }

    console.log(`✅ Found ${matches.length} appointment(s):\n`);
    matches.forEach((a, i) => {
      console.log(`${i + 1}. ${a.id}`);
      console.log(`   Date: ${a.date} ${a.time}`);
      console.log(`   Patient: ${a.patient_name}`);
      console.log(`   Provider: ${a.provider}`);
      console.log(`   Type: ${a.appointment_type}`);
      console.log(`   Status: ${a.status}`);
      console.log('');
    });
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
