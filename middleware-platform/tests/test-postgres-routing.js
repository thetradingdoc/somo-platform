#!/usr/bin/env node

/**
 * Postgres Routing Test
 *
 * Tests that database methods correctly route to Postgres when POSTGRES_URL is set.
 * Run: POSTGRES_URL=postgresql://user:pass@localhost:5432/testdb node tests/test-postgres-routing.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { v4: uuidv4 } = require('uuid');
const BookingService = require('../services/booking-service');
const db = require('../database');

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  console.log('\n📋 Options to get a Postgres database:');
  console.log('\n1. Use Docker (recommended for local testing):');
  console.log('   docker run --name test-postgres \\');
  console.log('     -e POSTGRES_PASSWORD=testpass \\');
  console.log('     -e POSTGRES_DB=testdb \\');
  console.log('     -p 5432:5432 -d postgres:15');
  console.log('\n   Then run:');
  console.log('   POSTGRES_URL=postgresql://postgres:testpass@localhost:5432/testdb \\');
  console.log('     node tests/test-postgres-routing.js');
  console.log('\n2. Use an existing Postgres instance:');
  console.log('   POSTGRES_URL=postgresql://user:pass@host:5432/dbname \\');
  console.log('     node tests/test-postgres-routing.js');
  console.log('\n3. Deploy via Azure (using Bicep):');
  console.log('   See docs/deployment/CI_CD_SETUP.md for instructions');
  process.exit(1);
}

const TEST_CLINIC_ID = 'test-postgres-clinic';
const TEST_DATE = new Date();
TEST_DATE.setDate(TEST_DATE.getDate() + 7);
const TEST_DATE_STR = TEST_DATE.toISOString().split('T')[0];

async function testPostgresRouting() {
  const createdResources = [];

  try {
    console.log('\n🗄️  Postgres Routing Test');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📡 Postgres URL: ${POSTGRES_URL.replace(/:[^:@]+@/, ':****@')}`);

    // Test 1: Create clinic
    console.log('\n📋 Test 1: Creating clinic...');
    const clinic = {
      clinic_id: TEST_CLINIC_ID,
      name: 'Postgres Test Clinic',
      slug: 'postgres-test-clinic',
      phone_number: '+15559999999',
      email: 'test@postgres.test',
      is_active: true
    };
    await db.createClinic(clinic);
    createdResources.push({ type: 'clinic', id: TEST_CLINIC_ID });
    console.log('✅ Clinic created');

    // Test 2: Get clinic
    console.log('\n📋 Test 2: Retrieving clinic...');
    const retrievedClinic = await db.getClinicById(TEST_CLINIC_ID);
    if (!retrievedClinic || retrievedClinic.clinic_id !== TEST_CLINIC_ID) {
      throw new Error('Failed to retrieve clinic');
    }
    console.log('✅ Clinic retrieved:', retrievedClinic.name);

    // Test 3: Create appointment
    console.log('\n📋 Test 3: Creating appointment...');
    const appointmentData = {
      clinic_id: TEST_CLINIC_ID,
      patient_name: 'Postgres Test Patient',
      patient_phone: '+15551111111',
      patient_email: 'patient@postgres.test',
      appointment_type: 'Mental Health Consultation',
      date: TEST_DATE_STR,
      time: '2:00 PM',
      timezone: 'America/New_York',
      notes: 'Postgres routing test'
    };
    const appointmentResult = await BookingService.scheduleAppointment(appointmentData);
    if (!appointmentResult.success) {
      throw new Error(`Failed to create appointment: ${appointmentResult.error}`);
    }
    const appointmentId = appointmentResult.appointment.id;
    createdResources.push({ type: 'appointment', id: appointmentId });
    console.log('✅ Appointment created:', appointmentId);

    // Test 4: Get appointment
    console.log('\n📋 Test 4: Retrieving appointment...');
    const retrievedAppointment = await db.getAppointment(appointmentId, TEST_CLINIC_ID);
    if (!retrievedAppointment || retrievedAppointment.id !== appointmentId) {
      throw new Error('Failed to retrieve appointment');
    }
    console.log('✅ Appointment retrieved:', retrievedAppointment.patient_name);

    // Test 5: Get appointments by date
    console.log('\n📋 Test 5: Getting appointments by date...');
    const appointmentsByDate = await db.getAppointmentsByDate(TEST_DATE_STR, TEST_CLINIC_ID);
    if (appointmentsByDate.length === 0) {
      throw new Error('No appointments found for date');
    }
    console.log(`✅ Found ${appointmentsByDate.length} appointment(s) for date`);

    // Test 6: Search appointments
    console.log('\n📋 Test 6: Searching appointments...');
    const searchResults = await db.searchAppointments('+15551111111', TEST_CLINIC_ID);
    if (searchResults.length === 0) {
      throw new Error('No appointments found in search');
    }
    console.log(`✅ Found ${searchResults.length} appointment(s) in search`);

    // Test 7: Create voice checkout
    console.log('\n📋 Test 7: Creating voice checkout...');
    const checkout = {
      id: `checkout-${uuidv4()}`,
      clinic_id: TEST_CLINIC_ID,
      merchant_id: 'test-merchant',
      product_id: 'test-product',
      product_name: 'Test Product',
      quantity: 1,
      amount: 99.99,
      customer_phone: '+15551111111',
      customer_name: 'Test Customer',
      status: 'pending'
    };
    await db.createVoiceCheckout(checkout);
    createdResources.push({ type: 'checkout', id: checkout.id });
    console.log('✅ Voice checkout created');

    // Test 8: Get voice checkout
    console.log('\n📋 Test 8: Retrieving voice checkout...');
    const retrievedCheckout = await db.getVoiceCheckout(checkout.id);
    if (!retrievedCheckout || retrievedCheckout.id !== checkout.id) {
      throw new Error('Failed to retrieve voice checkout');
    }
    console.log('✅ Voice checkout retrieved');

    // Test 9: Update voice checkout
    console.log('\n📋 Test 9: Updating voice checkout...');
    await db.updateVoiceCheckout(checkout.id, { status: 'completed' });
    const updatedCheckout = await db.getVoiceCheckout(checkout.id);
    if (updatedCheckout.status !== 'completed') {
      throw new Error('Failed to update voice checkout');
    }
    console.log('✅ Voice checkout updated');

    // Test 10: Log voice call
    console.log('\n📋 Test 10: Logging voice call...');
    const callId = `call-${uuidv4()}`;
    await db.logVoiceCall({
      id: `log-${uuidv4()}`,
      call_id: callId,
      customer_id: 'test-customer',
      status: 'active',
      function_calls_count: 0
    });
    console.log('✅ Voice call logged');

    // Test 11: Log function call
    console.log('\n📋 Test 11: Logging function call...');
    await db.logFunctionCall({
      id: `func-${uuidv4()}`,
      call_id: callId,
      customer_id: 'test-customer',
      function_name: 'test_function',
      parameters: { test: 'data' },
      success: true
    });
    console.log('✅ Function call logged');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 All Postgres routing tests passed!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Postgres routing test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up test resources...');
    for (const resource of createdResources) {
      try {
        if (resource.type === 'appointment') {
          await db.deleteAppointment(resource.id, TEST_CLINIC_ID);
        } else if (resource.type === 'checkout') {
          // Note: No delete method for checkouts, but that's okay for testing
        } else if (resource.type === 'clinic') {
          // Note: No delete method for clinics, but that's okay for testing
        }
      } catch (cleanupError) {
        console.warn(`⚠️  Failed to cleanup ${resource.type} ${resource.id}: ${cleanupError.message}`);
      }
    }
  }
}

testPostgresRouting();

