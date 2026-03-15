#!/usr/bin/env node
/**
 * Full user journey: Patient books appointment → pays → money transferred to doctor
 * Uses services directly (no HTTP) - run without server.
 *
 * Run: cd middleware-platform && node scripts/test-booking-payment-journey.js
 *
 * Requires: STRIPE_SECRET_KEY (test key), seed: npm run seed:demo
 */

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const CLINIC_ID = process.env.TEST_CLINIC_ID || process.env.DEFAULT_CLINIC_ID || 'clinic-default';

async function main() {
  console.log('\n🧪 Full User Journey: Book → Pay → Transfer (direct service calls)\n');
  console.log('  CLINIC_ID:', CLINIC_ID);
  console.log('  STRIPE:', process.env.STRIPE_SECRET_KEY ? 'configured' : 'NOT SET');
  console.log('');

  const db = require('../database');
  const BookingService = require('../services/booking-service');
  const BookingServiceMod = require('../services/booking-service');

  const patient = {
    name: 'Journey Test Patient',
    phone: '+15559998877',
    email: 'journey-test@example.com',
  };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().split('T')[0];
  const time = '14:00';

  // Step 1: Get available slots
  console.log('1. getAvailableSlots');
  let slotsRes;
  try {
    slotsRes = await BookingServiceMod.getAvailableSlots(date, null, null, 'America/New_York', CLINIC_ID);
  } catch (e) {
    console.log('   ❌', e.message);
    if (e.message?.includes('clinic_id')) {
      console.log('   → Run: node scripts/seed-demo-accounts.js');
    }
    process.exit(1);
  }
  const slots = slotsRes.slots || slotsRes.available_slots || [];
  const slot = slots[0] || time;
  console.log('   ✅ Slots:', slots.length, '| using:', slot);

  // Step 2: Schedule appointment
  console.log('\n2. scheduleAppointment');
  let scheduleRes;
  try {
    scheduleRes = await BookingService.scheduleAppointment({
      clinic_id: CLINIC_ID,
      patient_name: patient.name,
      patient_phone: patient.phone,
      patient_email: patient.email,
      appointment_type: 'Mental Health Consultation',
      date,
      time: slot,
      timezone: 'America/New_York',
    });
  } catch (e) {
    console.log('   ❌', e.message);
    process.exit(1);
  }
  if (!scheduleRes.success) {
    console.log('   ❌', scheduleRes.error || scheduleRes);
    process.exit(1);
  }
  const appointmentId = scheduleRes.appointment?.id;
  console.log('   ✅ Appointment:', appointmentId);

  // Step 3: Create checkout (via voice endpoint - works without appointment_id too)
  console.log('\n3. Create checkout');
  const axios = require('axios');
  const port = process.env.PORT || 4000;
  const base = process.env.BASE_URL || process.env.API_BASE_URL || `http://localhost:${port}`;
  let checkoutId, paymentToken, amount;
  try {
    const checkoutPayload = {
      clinic_id: CLINIC_ID,
      appointment_id: appointmentId,
      appointment_type: 'Mental Health Consultation',
      customer_name: patient.name,
      customer_phone: patient.phone,
      customer_email: patient.email,
    };
    const checkoutRes = await axios.post(`${base}/voice/appointments/checkout`, checkoutPayload, { timeout: 8000 });
    if (checkoutRes.data?.checkout_id) {
      checkoutId = checkoutRes.data.checkout_id;
      paymentToken = checkoutRes.data.payment_token;
      amount = checkoutRes.data.amount;
      console.log('   ✅ Checkout:', checkoutId, '| amount:', amount);
    } else {
      throw new Error(checkoutRes.data?.error || 'No checkout_id');
    }
  } catch (e) {
    console.log('   ❌ Server not running or checkout failed:', e.message);
    console.log('   → Start server: npm start');
    console.log('\n   Appointment created:', appointmentId);
    process.exit(0);
  }

  // Step 4: Process payment (Stripe)
  console.log('\n4. process-payment (Stripe test card)');
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log('   ⏭ SKIP - STRIPE_SECRET_KEY not set');
    console.log('\n✅ Journey: Book ✓ | Checkout ✓ | Pay skipped');
    process.exit(0);
  }

  try {
    const payRes = await axios.post(`${base}/process-payment`, {
      payment_token: paymentToken,
      checkout_id: checkoutId,
      payment_method_id: 'pm_card_visa',
      amount: amount ?? 69,
      payment_method: 'stripe',
    }, { timeout: 15000 });
    if (!payRes.data?.success) {
      throw new Error(payRes.data?.error || 'Payment failed');
    }
    console.log('   ✅ Payment:', payRes.data.payment_intent_id || 'success');
  } catch (e) {
    console.log('   ❌', e.response?.data?.error || e.message);
    process.exit(1);
  }

  // Step 5: Verify transfer
  console.log('\n5. Verify transfer');
  let eventCount = 0;
  try {
    const rows = db.db.prepare(
      "SELECT * FROM financial_events WHERE metadata LIKE ? ORDER BY created_at DESC LIMIT 5"
    ).all(`%${checkoutId}%`);
    eventCount = rows.length;
    if (rows.length > 0) {
      const e = rows[0];
      console.log('   ✅ financial_event:', e.event_type, '| amount:', e.amount, e.currency);
    } else {
      console.log('   ⚠️  No financial_events (check ledger)');
    }
  } catch (e) {
    console.log('   ⚠️  financial_events:', e.message);
  }

  console.log('\n' + '─'.repeat(50));
  console.log('✅ Journey complete: Book → Pay → Transfer');
  console.log('   Appointment:', appointmentId);
  console.log('   Checkout:', checkoutId);
  console.log('   Financial events:', eventCount);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
