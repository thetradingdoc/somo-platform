#!/usr/bin/env node

/**
 * Test: Clinic Signup Flow
 * 
 * Tests the complete signup pipeline:
 * 1. User signs up with clinic information
 * 2. Clinic record is created
 * 3. Retell agent is created (or mocked)
 * 4. Phone number is linked to clinic
 * 5. User is created with clinic_id
 * 
 * Run: node tests/test-clinic-signup.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios = require('axios');
const db = require('../database');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';

// Test data
const testClinic = {
  name: 'Test Clinic ' + Date.now(),
  phone: '+1555555' + Math.floor(Math.random() * 10000).toString().padStart(4, '0'),
  owner_name: 'Test Owner',
  owner_email: `test-${Date.now()}@example.com`,
  password: 'testpassword123'
};

async function testClinicSignup() {
  console.log('\n🧪 Testing Clinic Signup Flow');
  console.log('='.repeat(60));
  console.log(`Clinic Name: ${testClinic.name}`);
  console.log(`Phone: ${testClinic.phone}`);
  console.log(`Owner: ${testClinic.owner_name} (${testClinic.owner_email})`);

  try {
    // Step 1: Call signup API
    console.log('\n1️⃣  Calling signup API...');
    const response = await axios.post(`${API_BASE}/api/auth/signup`, {
      name: testClinic.owner_name,
      email: testClinic.owner_email,
      password: testClinic.password,
      clinic_name: testClinic.name,
      clinic_phone: testClinic.phone
    });

    if (!response.data.success) {
      throw new Error(`Signup failed: ${response.data.error}`);
    }

    console.log('✅ Signup API call successful');
    console.log(`   User ID: ${response.data.user.id}`);
    console.log(`   Clinic ID: ${response.data.clinic.id}`);
    console.log(`   Clinic Slug: ${response.data.clinic.slug}`);
    console.log(`   Retell Agent ID: ${response.data.clinic.retell_agent_id || 'N/A (mock mode)'}`);
    console.log(`   Retell Agent Status: ${response.data.clinic.retell_agent_status}`);

    const { user, clinic } = response.data;

    // Step 2: Verify clinic record in database
    console.log('\n2️⃣  Verifying clinic record in database...');
    const clinicRecord = db.getClinicById(clinic.id);
    if (!clinicRecord) {
      throw new Error('Clinic record not found in database');
    }
    console.log('✅ Clinic record found');
    console.log(`   Name: ${clinicRecord.name}`);
    console.log(`   Slug: ${clinicRecord.clinic_slug}`);
    console.log(`   Phone: ${clinicRecord.phone_number}`);
    console.log(`   Status: ${clinicRecord.status}`);

    // Step 3: Verify user record
    console.log('\n3️⃣  Verifying user record...');
    const userRecord = db.getUserById(user.id);
    if (!userRecord) {
      throw new Error('User record not found in database');
    }
    console.log('✅ User record found');
    console.log(`   Email: ${userRecord.email}`);
    console.log(`   Clinic ID: ${userRecord.clinic_id}`);
    console.log(`   Role: ${userRecord.role}`);

    if (userRecord.clinic_id !== clinic.id) {
      throw new Error(`User clinic_id mismatch: expected ${clinic.id}, got ${userRecord.clinic_id}`);
    }

    // Step 4: Verify phone number linkage
    console.log('\n4️⃣  Verifying phone number linkage...');
    const phoneRecord = db.getClinicPhoneNumber(testClinic.phone);
    if (!phoneRecord) {
      throw new Error('Phone number record not found');
    }
    console.log('✅ Phone number linked to clinic');
    console.log(`   Phone: ${phoneRecord.phone_number}`);
    console.log(`   Clinic ID: ${phoneRecord.clinic_id}`);
    console.log(`   Status: ${phoneRecord.status}`);

    if (phoneRecord.clinic_id !== clinic.id) {
      throw new Error(`Phone clinic_id mismatch: expected ${clinic.id}, got ${phoneRecord.clinic_id}`);
    }

    // Step 5: Verify clinic slug uniqueness
    console.log('\n5️⃣  Verifying clinic slug...');
    const clinicBySlug = db.getClinicBySlug(clinic.slug);
    if (!clinicBySlug) {
      throw new Error('Clinic not found by slug');
    }
    if (clinicBySlug.id !== clinic.id) {
      throw new Error('Clinic slug does not match clinic ID');
    }
    console.log('✅ Clinic slug is valid and unique');

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED!');
    console.log('='.repeat(60));
    console.log('\nSummary:');
    console.log(`  Clinic: ${clinic.name} (${clinic.slug})`);
    console.log(`  Phone: ${testClinic.phone}`);
    console.log(`  User: ${userRecord.email}`);
    console.log(`  Retell Agent: ${clinic.retell_agent_id || 'Not created (mock mode)'}`);
    console.log('\n✅ Clinic signup flow is working correctly!');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ TEST FAILED');
    console.error('='.repeat(60));
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    console.error('='.repeat(60));
    process.exit(1);
  }
}

testClinicSignup();
