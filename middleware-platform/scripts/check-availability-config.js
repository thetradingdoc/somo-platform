#!/usr/bin/env node
/**
 * Check availability configuration for clinic-default (or CLINIC_ID env).
 * Shows: clinic config, business hours, provider profiles, availability blocks,
 * appointments on a date, and available slots.
 *
 * Usage: node scripts/check-availability-config.js [date]
 *   date: YYYY-MM-DD (default: tomorrow)
 */

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');
const { getClinicBusinessHours } = require('../config/clinic-business-hours');
const BookingService = require('../services/booking-service');
const ProviderService = require('../services/provider-service');

const CLINIC_ID = process.env.CLINIC_ID || process.env.DEFAULT_CLINIC_ID || 'clinic-default';
const DATE = process.argv[2] || (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
})();

console.log('\n=== Availability Configuration ===\n');
console.log('Clinic ID:', CLINIC_ID);
console.log('Date:', DATE);
console.log('');

// 1. Clinic config
const clinic = db.getClinicById ? db.getClinicById(CLINIC_ID) : null;
console.log('--- Clinic ---');
if (!clinic) {
  console.log('  (no clinic row; using defaults)');
} else {
  console.log('  clinic_id:', clinic.clinic_id);
  console.log('  name:', clinic.name);
  console.log('  business_hours_start:', clinic.business_hours_start ?? '(default 9)');
  console.log('  business_hours_end:', clinic.business_hours_end ?? '(default 19)');
  console.log('  business_days:', clinic.business_days ?? '(default Mon–Fri)');
  console.log('  timezone:', clinic.timezone ?? '(default America/New_York)');
}
console.log('');

// 2. Effective business hours
const clinicHours = getClinicBusinessHours(CLINIC_ID);
console.log('--- Effective Business Hours (from getClinicBusinessHours) ---');
console.log('  start:', clinicHours.start, 'end:', clinicHours.end);
console.log('  timezone:', clinicHours.timezone);
console.log('  business_days:', clinicHours.business_days, '(1=Mon, 5=Fri, 0=Sun)');
console.log('');

// 3. Provider profiles
let providerProfiles = [];
try {
  providerProfiles = db.db?.prepare?.('SELECT * FROM provider_profiles WHERE clinic_id = ?').all(CLINIC_ID) || [];
} catch (_) {}
console.log('--- Provider Profiles (provider_profiles) ---');
if (providerProfiles.length === 0) {
  console.log('  (none — specialist path will fall back to standard BookingService)');
} else {
  providerProfiles.forEach((p, i) => {
    console.log(`  [${i + 1}] id=${p.id} specialty=${p.specialty} email=${p.email || '(n/a)'}`);
  });
}
console.log('');

// 4. Provider availability blocks
let avBlocks = [];
try {
  avBlocks = db.db?.prepare?.('SELECT * FROM provider_availability_blocks ORDER BY provider_email, start_datetime').all() || [];
} catch (_) {}
console.log('--- Provider Availability Blocks (provider_availability_blocks) ---');
if (avBlocks.length === 0) {
  console.log('  (none)');
} else {
  avBlocks.forEach((b, i) => {
    console.log(`  [${i + 1}] ${b.provider_email} ${b.block_type} ${b.start_datetime} → ${b.end_datetime}`);
  });
}
console.log('');

// 5. Provider status (is_online, availability_rules)
let onlineProviders = [];
try {
  onlineProviders = ProviderService.getOnlineProviderEmailsForClinic?.(CLINIC_ID) || [];
} catch (_) {}
console.log('--- Online Providers (provider_status.is_online + provider_profile) ---');
if (onlineProviders.length === 0) {
  console.log('  (none — slot filter by provider availability is skipped)');
} else {
  console.log('  ', onlineProviders.join(', '));
}
console.log('');

// 6. Appointments on date
let appointments = [];
try {
  appointments = db.getAppointmentsByDate?.(DATE, CLINIC_ID) || [];
} catch (_) {}
console.log(`--- Appointments on ${DATE} ---`);
console.log('  count:', appointments.length);
if (appointments.length > 0 && appointments.length <= 10) {
  appointments.forEach((a, i) => {
    console.log(`  [${i + 1}] ${a.time} ${a.appointment_type} ${a.patient_name || '(n/a)'}`);
  });
} else if (appointments.length > 10) {
  appointments.slice(0, 5).forEach((a, i) => {
    console.log(`  [${i + 1}] ${a.time} ${a.appointment_type} ${a.patient_name || '(n/a)'}`);
  });
  console.log('  ... and', appointments.length - 5, 'more');
}
console.log('');

// 7. Available slots via BookingService
console.log('--- BookingService.getAvailableSlots ---');
BookingService.getAvailableSlots(DATE, null, 'Primary Care', 'America/New_York', CLINIC_ID, null)
  .then((result) => {
    if (result.success) {
      console.log('  available_slots:', result.available_slots?.length ?? 0);
      console.log('  total_slots:', result.total_slots);
      console.log('  booked_slots:', result.booked_slots);
      if (result.available_slots?.length > 0) {
        console.log('  times:', result.available_slots.slice(0, 15).join(', '));
        if (result.available_slots.length > 15) {
          console.log('       ... and', result.available_slots.length - 15, 'more');
        }
      }
    } else {
      console.log('  error:', result.error);
    }
    console.log('\n=== Done ===\n');
  })
  .catch((err) => {
    console.error('  error:', err.message);
    console.log('\n=== Done ===\n');
  });
