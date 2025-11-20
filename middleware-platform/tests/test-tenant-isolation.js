#!/usr/bin/env node

/**
 * Tenant Isolation Test
 *
 * Verifies that appointment APIs respect clinic_id scoping.
 * Run: node tests/test-tenant-isolation.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { v4: uuidv4 } = require('uuid');
const BookingService = require('../services/booking-service');
const db = require('../database');

const CLINIC_A = 'clinic-isolation-a';
const CLINIC_B = 'clinic-isolation-b';

function futureDate(daysAhead = 5) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().split('T')[0];
}

function buildAppointmentPayload(clinicId, overrides = {}) {
  return {
    clinic_id: clinicId,
    patient_name: overrides.patient_name || `Tenant Test ${clinicId}`,
    patient_phone: overrides.patient_phone || `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`,
    patient_email: overrides.patient_email || `${uuidv4()}@example.com`,
    appointment_type: 'Mental Health Consultation',
    date: overrides.date || futureDate(),
    time: overrides.time || '11:00 AM',
    timezone: 'America/New_York',
    notes: `Tenant isolation test for ${clinicId}`
  };
}

async function run() {
  const createdAppointments = [];

  try {
    console.log('\n🔐 Tenant Isolation Test');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Clean up any existing appointments for the test date to avoid conflicts
    const testDate = futureDate();
    console.log(`🧹 Cleaning up existing appointments for test date: ${testDate}`);
    
    const existingApptsA = await db.getAppointmentsByDate(testDate, CLINIC_A);
    const existingApptsB = await db.getAppointmentsByDate(testDate, CLINIC_B);
    
    [...existingApptsA, ...existingApptsB].forEach(appt => {
      try {
        db.deleteAppointment(appt.id, appt.clinic_id);
        console.log(`  ✓ Deleted existing appointment ${appt.id} for ${appt.clinic_id}`);
      } catch (err) {
        console.warn(`  ⚠️  Failed to delete ${appt.id}: ${err.message}`);
      }
    });

    // Schedule appointments for two clinics using the same phone number to test filtering
    const sharedPhone = '+15551230000';

    const apptAInput = buildAppointmentPayload(CLINIC_A, {
      patient_phone: sharedPhone,
      patient_name: 'Tenant Alpha',
      date: testDate // Use the same date we cleaned up
    });
    const apptBInput = buildAppointmentPayload(CLINIC_B, {
      patient_phone: sharedPhone,
      patient_name: 'Tenant Beta',
      date: testDate // Use the same date we cleaned up
    });

    const apptAResult = await BookingService.scheduleAppointment(apptAInput);
    if (!apptAResult.success) {
      throw new Error(`Failed to create clinic A appointment: ${apptAResult.error}`);
    }
    createdAppointments.push({ id: apptAResult.appointment.id, clinic: CLINIC_A });

    const apptBResult = await BookingService.scheduleAppointment(apptBInput);
    if (!apptBResult.success) {
      throw new Error(`Failed to create clinic B appointment: ${apptBResult.error}`);
    }
    createdAppointments.push({ id: apptBResult.appointment.id, clinic: CLINIC_B });

    console.log('✅ Created appointments for Clinic A and Clinic B');

    // Ensure clinic-scoped lookup works
    const clinicAFetch = await db.getAppointment(apptAResult.appointment.id, CLINIC_A);
    if (!clinicAFetch) {
      throw new Error('Clinic A appointment not found when scoped by clinic_id');
    }

    const crossFetch = await db.getAppointment(apptAResult.appointment.id, CLINIC_B);
    if (crossFetch) {
      throw new Error('Clinic B was able to fetch Clinic A appointment');
    }
    console.log('✅ Appointment lookups enforce clinic_id');

    // Ensure search endpoints return scoped results
    const searchA = await BookingService.searchAppointments(sharedPhone, CLINIC_A);
    if (searchA.count !== 1) {
      throw new Error(`Expected 1 appointment for Clinic A search, found ${searchA.count}`);
    }

    const searchB = await BookingService.searchAppointments(sharedPhone, CLINIC_B);
    if (searchB.count !== 1) {
      throw new Error(`Expected 1 appointment for Clinic B search, found ${searchB.count}`);
    }

    console.log('✅ Searches return only clinic-scoped data');
    console.log('🎉 Tenant isolation checks passed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Tenant isolation test failed:', error.message);
    process.exit(1);
  } finally {
    // Cleanup
    createdAppointments.forEach(appt => {
      try {
        db.deleteAppointment(appt.id, appt.clinic);
      } catch (cleanupError) {
        console.warn(`⚠️  Failed to delete test appointment ${appt.id}: ${cleanupError.message}`);
      }
    });
  }
}

run();

