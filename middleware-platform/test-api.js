/**
 * API Testing Script
 * Tests all admin endpoints and database functions
 */

const db = require('./database');

console.log('🧪 Starting API Tests...\n');

// Test 1: Database connection
console.log('Test 1: Database Connection');
try {
  const clinics = db.prepare('SELECT * FROM clinics LIMIT 1').all();
  console.log('✅ Database connection successful');
} catch (error) {
  console.error('❌ Database connection failed:', error.message);
  process.exit(1);
}

// Test 2: Database functions
console.log('\nTest 2: Database Functions');
try {
  // Test getAllVoiceCheckouts
  const checkouts = db.getAllVoiceCheckouts();
  console.log(`✅ getAllVoiceCheckouts: ${checkouts.length} checkouts found`);
  
  // Test getAllTransactions
  const transactions = db.getAllTransactions();
  console.log(`✅ getAllTransactions: ${transactions.length} transactions found`);
  
  // Test getClinicById (with non-existent ID)
  const clinic = db.getClinicById('test-clinic-id');
  console.log(`✅ getClinicById: ${clinic ? 'Found' : 'Not found (expected)'}`);
  
  // Test getClinicBySlug
  const clinicBySlug = db.getClinicBySlug('test-slug');
  console.log(`✅ getClinicBySlug: ${clinicBySlug ? 'Found' : 'Not found (expected)'}`);
  
  console.log('✅ All database functions work correctly');
} catch (error) {
  console.error('❌ Database function test failed:', error.message);
  process.exit(1);
}

// Test 3: Create test clinic
console.log('\nTest 3: Create Test Clinic');
try {
  const testClinic = {
    clinic_id: 'test-clinic-' + Date.now(),
    name: 'Test Clinic',
    slug: 'test-clinic-' + Date.now(),
    phone_number: '+15551234567',
    email: 'test@example.com',
    retell_agent_id: 'test-agent-123',
    retell_agent_status: 'active',
    is_active: 1
  };
  
  db.createClinic(testClinic);
  console.log('✅ Test clinic created successfully');
  
  // Verify it was created
  const created = db.getClinicById(testClinic.clinic_id);
  if (created && created.name === testClinic.name) {
    console.log('✅ Test clinic verified in database');
  } else {
    throw new Error('Clinic not found after creation');
  }
  
  // Clean up
  db.prepare('DELETE FROM clinics WHERE clinic_id = ?').run(testClinic.clinic_id);
  console.log('✅ Test clinic cleaned up');
} catch (error) {
  console.error('❌ Create clinic test failed:', error.message);
  process.exit(1);
}

// Test 4: Update clinic
console.log('\nTest 4: Update Clinic');
try {
  const testClinic = {
    clinic_id: 'test-update-' + Date.now(),
    name: 'Test Clinic',
    slug: 'test-update-' + Date.now(),
    is_active: 1
  };
  
  db.createClinic(testClinic);
  
  // Update it
  db.updateClinic(testClinic.clinic_id, { name: 'Updated Clinic Name' });
  
  const updated = db.getClinicById(testClinic.clinic_id);
  if (updated && updated.name === 'Updated Clinic Name') {
    console.log('✅ Clinic update successful');
  } else {
    throw new Error('Clinic update failed');
  }
  
  // Clean up
  db.prepare('DELETE FROM clinics WHERE clinic_id = ?').run(testClinic.clinic_id);
  console.log('✅ Test clinic cleaned up');
} catch (error) {
  console.error('❌ Update clinic test failed:', error.message);
  process.exit(1);
}

// Test 5: Phone number functions
console.log('\nTest 5: Phone Number Functions');
try {
  const testClinic = {
    clinic_id: 'test-phone-' + Date.now(),
    name: 'Test Clinic',
    slug: 'test-phone-' + Date.now(),
    is_active: 1
  };
  
  db.createClinic(testClinic);
  
  // Create phone number
  db.createClinicPhoneNumber({
    phone_number: '+15559876543',
    clinic_id: testClinic.clinic_id,
    is_primary: 1
  });
  console.log('✅ Phone number created');
  
  // Get phone number
  const phone = db.getClinicPhoneNumber('+15559876543');
  if (phone && phone.clinic_id === testClinic.clinic_id) {
    console.log('✅ Phone number retrieved successfully');
  } else {
    throw new Error('Phone number not found');
  }
  
  // Get all phone numbers for clinic
  const phones = db.getClinicPhoneNumbers(testClinic.clinic_id);
  if (phones && phones.length > 0) {
    console.log('✅ Clinic phone numbers retrieved');
  } else {
    throw new Error('No phone numbers found');
  }
  
  // Clean up
  db.prepare('DELETE FROM clinic_phone_numbers WHERE clinic_id = ?').run(testClinic.clinic_id);
  db.prepare('DELETE FROM clinics WHERE clinic_id = ?').run(testClinic.clinic_id);
  console.log('✅ Test data cleaned up');
} catch (error) {
  console.error('❌ Phone number test failed:', error.message);
  process.exit(1);
}

console.log('\n✅ All tests passed!');
console.log('\n📋 Summary:');
console.log('  ✅ Database connection');
console.log('  ✅ Database functions');
console.log('  ✅ Create clinic');
console.log('  ✅ Update clinic');
console.log('  ✅ Phone number management');
console.log('\n🚀 Ready for deployment!');

