#!/usr/bin/env node
/**
 * Test: Create appointment via provider portal API → verify it appears in patient app
 *
 * Run: node scripts/test-appointment-to-patient-app.js
 *
 * Requires:
 *   - Middleware server running (npm start in middleware-platform)
 *   - If "clinic_id is required": restart the server, or run seed first:
 *     cd middleware-platform && node scripts/seed-demo-accounts.js
 */

const path = require('path');

// Use same DB as server: run from middleware-platform context
const middlewareDir = path.join(__dirname, '../middleware-platform');
process.chdir(middlewareDir);
require('dotenv').config({ path: path.join(middlewareDir, '.env') });

const API_BASE = process.env.API_BASE || process.env.BASE_URL || 'http://localhost:4000';

async function fetchApi(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`);
  }
  return json;
}

async function main() {
  console.log('🧪 Test: Appointment → Patient App flow\n');
  console.log('  API_BASE:', API_BASE);

  const testEmail = 'test-patient@doclittle.com';
  const testName = 'Test Patient';
  const testPhone = '+15551234567';

  // Use tomorrow + early slot to minimize conflicts with existing appointments
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().split('T')[0];
  const time = '10:00';

  // 1. Create appointment via admin API
  console.log('\n1. Creating appointment...');
  let createRes;
  try {
    createRes = await fetchApi('/api/admin/appointments/create', {
      method: 'POST',
      body: JSON.stringify({
        clinic_id: 'clinic-default',
        patient_name: testName,
        patient_phone: testPhone,
        patient_email: testEmail,
        appointment_type: 'Mental Health Consultation',
        date,
        time,
        provider: 'DocLittle Mental Health Team',
        notes: 'Test from script',
      }),
    });
  } catch (e) {
    console.error('   ❌ Create failed:', e.message);
    process.exit(1);
  }

  if (!createRes.success || !createRes.appointment?.id) {
    console.error('   ❌ Create failed:', createRes.error || createRes);
    process.exit(1);
  }
  const apptId = createRes.appointment.id;
  console.log('   ✅ Appointment created:', apptId);

  // 2. Send verification code (to get session_id)
  console.log('\n2. Sending verification code...');
  let sendRes;
  try {
    sendRes = await fetchApi('/api/patient/verify/send', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail }),
    });
  } catch (e) {
    console.error('   ❌ Send code failed:', e.message);
    process.exit(1);
  }

  if (!sendRes.success || !sendRes.session_id) {
    console.error('   ❌ Send code failed:', sendRes.error || sendRes);
    process.exit(1);
  }
  const sessionId = sendRes.session_id;
  console.log('   ✅ Session ID:', sessionId);

  // 3. Get verification code from DB (dev mode logs it; we need to read from DB)
  const db = require('../middleware-platform/database');
  const session = db.db.prepare(
    'SELECT verification_code FROM patient_portal_sessions WHERE id = ?'
  ).get(sessionId);
  if (!session) {
    console.error('   ❌ Could not find session in DB');
    process.exit(1);
  }
  const code = session.verification_code;
  console.log('   Code (from DB):', code);

  // 4. Confirm verification
  console.log('\n3. Confirming verification...');
  let confirmRes;
  try {
    confirmRes = await fetchApi('/api/patient/verify/confirm', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail, code }),
    });
  } catch (e) {
    console.error('   ❌ Confirm failed:', e.message);
    process.exit(1);
  }

  if (!confirmRes.success || !confirmRes.session_id) {
    console.error('   ❌ Confirm failed:', confirmRes.error || confirmRes);
    process.exit(1);
  }
  const verifiedSessionId = confirmRes.session_id;
  console.log('   ✅ Verified session:', verifiedSessionId);

  // 5. Fetch patient appointments
  console.log('\n4. Fetching patient appointments...');
  let apptsRes;
  try {
    apptsRes = await fetch(`${API_BASE}/api/patient/appointments`, {
      headers: { 'x-session-id': verifiedSessionId },
    });
    apptsRes = await apptsRes.json();
  } catch (e) {
    console.error('   ❌ Fetch appointments failed:', e.message);
    process.exit(1);
  }

  if (!apptsRes.success) {
    console.error('   ❌ Fetch failed:', apptsRes.error || apptsRes);
    process.exit(1);
  }

  const appointments = apptsRes.appointments || [];
  const found = appointments.find((a) => a.id === apptId);
  if (!found) {
    console.error('   ❌ Appointment not found in patient app response');
    console.error('   Appointments returned:', appointments.length);
    console.error('   Expected id:', apptId);
    process.exit(1);
  }

  console.log('   ✅ Appointment found in patient app!');
  console.log('   Patient:', found.patient_name, '| Type:', found.appointment_type, '| Status:', found.status);

  console.log('\n✅ All checks passed. Appointment flows to patient app correctly.\n');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
