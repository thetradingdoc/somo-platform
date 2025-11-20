#!/usr/bin/env node

/**
 * Voice Agent Flow Test
 *
 * Simulates a full Twilio → Retell function sequence (schedule, insurance, checkout)
 * including a multilingual caller to ensure end-to-end automation works in CI.
 *
 * Run: node tests/test-voice-agent-flow.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios = require('axios');
const { URLSearchParams } = require('url');
const { v4: uuidv4 } = require('uuid');

const db = require('../database');
const RetellWebSocketHandler = require('../webhooks/retell-websocket');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';
const TEST_CLINIC_ID = process.env.TEST_CLINIC_ID || 'test-voice-flow-clinic';
const TEST_CLINIC_PHONE = process.env.TEST_CLINIC_PHONE || '+15551112222';

function futureDate(daysAhead = 2) {
  const next = new Date();
  next.setDate(next.getDate() + daysAhead);
  return next.toISOString().split('T')[0];
}

function ensureTestClinic() {
  const existing = db.getClinicById(TEST_CLINIC_ID);
  if (!existing) {
    db.db.prepare(`
      INSERT INTO clinics (clinic_id, name, slug, phone_number, email, business_hours, services, retell_agent_id, merchant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      TEST_CLINIC_ID,
      'Test Voice Clinic',
      `${TEST_CLINIC_ID}-slug`,
      TEST_CLINIC_PHONE,
      'voice-clinic@example.com',
      'Mon-Fri 9-5',
      'Mental Health Services',
      `agent-${TEST_CLINIC_ID}`,
      `merchant-${TEST_CLINIC_ID}`
    );
  }

  db.db.prepare(`
    INSERT OR IGNORE INTO clinic_phone_numbers (phone_number, clinic_id, is_primary)
    VALUES (?, ?, 1)
  `).run(TEST_CLINIC_PHONE, TEST_CLINIC_ID);
}

async function simulateTwilioWebhook() {
  const payload = new URLSearchParams({
    CallSid: `CA${uuidv4()}`,
    AccountSid: 'ACXXXXXXXXXXXXXXXX',
    From: '+15559876543',
    To: TEST_CLINIC_PHONE,
    Direction: 'inbound',
    CallStatus: 'ringing'
  });

  const response = await axios.post(`${API_BASE_URL}/voice/incoming`, payload, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  if (response.status !== 200) {
    throw new Error(`Unexpected Twilio webhook status: ${response.status}`);
  }
  return response.data;
}

async function ensureServerRunning() {
  try {
    const health = await axios.get(`${API_BASE_URL}/health`);
    if (health.status !== 200) {
      throw new Error(`Unexpected health status: ${health.status}`);
    }
  } catch (error) {
    throw new Error(
      `API server is not reachable at ${API_BASE_URL}. Start the middleware service before running this test.`
    );
  }
}

function seedCallConnection(handler, callId) {
  handler.activeConnections.set(callId, {
    callId,
    ws: { send: () => {} },
    startTime: Date.now(),
    conversationHistory: [],
    callMetadata: {
      metadata: { clinic_id: TEST_CLINIC_ID, customer_id: TEST_CLINIC_ID },
      dynamic_variables: { clinic_id: TEST_CLINIC_ID, customer_id: TEST_CLINIC_ID }
    },
    customer_id: TEST_CLINIC_ID,
    customerPhone: '+15557654321',
    initialName: null
  });
}

async function run() {
  const createdAppointments = [];
  const createdCheckouts = [];

  try {
    console.log('\n🎙️  Voice Agent Flow Test');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    ensureTestClinic();
    console.log(`✅ Test clinic ensured: ${TEST_CLINIC_ID}`);

    await ensureServerRunning();
    console.log('✅ API health check passed');

    const twiml = await simulateTwilioWebhook();
    console.log('✅ Twilio webhook responded with TwiML length:', twiml.length);

    const handler = new RetellWebSocketHandler(db, { apiBaseUrl: API_BASE_URL });
    const callId = `call-${uuidv4()}`;
    seedCallConnection(handler, callId);

    const appointmentDate = futureDate(3);
    const spanishEmail = `${uuidv4()}@example.com`;

    const scheduleResult = await handler.handleScheduleAppointment(callId, {
      patient_name: 'María Gómez',
      patient_phone: '+15552340000',
      patient_email: spanishEmail,
      appointment_type: 'Mental Health Consultation',
      date: appointmentDate,
      time: '10:00 AM',
      timezone: 'America/New_York',
      notes: 'Paciente prefiere español y consulta sobre terapia cognitiva.'
    });

    if (!scheduleResult.success) {
      throw new Error(`Schedule appointment failed: ${scheduleResult.error}`);
    }

    const appointmentId = scheduleResult.appointment.id;
    createdAppointments.push(appointmentId);
    console.log('✅ Scheduled multilingual appointment:', appointmentId);

    const insuranceResult = await handler.handleCollectInsurance(callId, {
      patient_name: 'María Gómez',
      patient_phone: '+15552340000',
      member_id: `SP-${Date.now()}`,
      payer_name: 'Cigna Internacional'
    });

    if (!insuranceResult.success) {
      throw new Error(`Collect insurance failed: ${insuranceResult.error}`);
    }
    console.log('✅ Insurance information collected');

    const checkoutResult = await handler.handleCreateAppointmentCheckout(callId, {
      appointment_id: appointmentId,
      customer_name: 'María Gómez',
      customer_email: spanishEmail,
      customer_phone: '+15552340000',
      appointment_type: 'Mental Health Consultation',
      amount: 25.0
    });

    if (!checkoutResult.success) {
      throw new Error(`Checkout creation failed: ${checkoutResult.error}`);
    }

    createdCheckouts.push(checkoutResult.checkout_id);
    console.log('✅ Appointment checkout created:', checkoutResult.checkout_id);

    console.log('🎉 Voice agent flow test passed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Voice agent flow test failed:', error.message || error);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Response:', JSON.stringify(error.response.data, null, 2));
    } else if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    createdCheckouts.forEach(checkoutId => {
      try {
        db.db.prepare('DELETE FROM voice_checkouts WHERE id = ?').run(checkoutId);
      } catch (cleanupError) {
        console.warn(`⚠️  Failed to delete checkout ${checkoutId}: ${cleanupError.message}`);
      }
    });

    createdAppointments.forEach(apptId => {
      try {
        db.deleteAppointment(apptId, TEST_CLINIC_ID);
      } catch (cleanupError) {
        console.warn(`⚠️  Failed to delete appointment ${apptId}: ${cleanupError.message}`);
      }
    });
  }
}

run();

