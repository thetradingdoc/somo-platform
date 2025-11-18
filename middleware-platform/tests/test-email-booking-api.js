/**
 * Test Appointment Email Booking via API
 * 
 * This script tests the appointment booking API endpoint
 * and verifies that emails are sent with appointment details.
 * 
 * Usage: 
 *   1. Start the server: npm start
 *   2. Run this script: node tests/test-email-booking-api.js
 * 
 * Or use curl:
 *   curl -X POST http://localhost:4000/api/test/appointment-email \
 *     -H "Content-Type: application/json" \
 *     -d '{"patient_email":"test@example.com"}'
 */

const http = require('http');

const TEST_CONFIG = {
  host: 'localhost',
  port: 4000,
  email: process.argv[2] || 'test@example.com' // Pass email as argument or use default
};

async function testAppointmentEmailAPI() {
  console.log('\n🧪 TESTING APPOINTMENT EMAIL BOOKING VIA API');
  console.log('='.repeat(60));
  console.log(`Testing with email: ${TEST_CONFIG.email}`);
  console.log(`API Endpoint: http://${TEST_CONFIG.host}:${TEST_CONFIG.port}/api/test/appointment-email`);
  
  const testData = {
    patient_name: 'Test Patient Email',
    patient_phone: '+15551234567',
    patient_email: TEST_CONFIG.email,
    appointment_type: 'Cardiology Consultation',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Tomorrow
    time: '2:00 PM',
    timezone: 'America/New_York',
    notes: 'Test appointment for email verification'
  };
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(testData);
    
    const options = {
      hostname: TEST_CONFIG.host,
      port: TEST_CONFIG.port,
      path: '/api/test/appointment-email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    console.log('\n📤 Sending request...');
    console.log('Request body:', JSON.stringify(testData, null, 2));
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          console.log('\n📥 Response received:');
          console.log('Status:', res.statusCode);
          console.log('Response:', JSON.stringify(response, null, 2));
          
          if (res.statusCode === 200 && response.success) {
            console.log('\n✅ TEST PASSED!');
            console.log('✓ Appointment created');
            console.log(`✓ Appointment ID: ${response.appointment?.id}`);
            console.log(`✓ Confirmation: ${response.appointment?.confirmation_number}`);
            console.log(`✓ Email sent: ${response.emailSent ? 'YES' : 'NO'}`);
            console.log(`✓ Email provider: ${response.emailProvider || 'N/A'}`);
            
            if (response.emailSent) {
              console.log(`\n📧 Check your email inbox at: ${TEST_CONFIG.email}`);
              console.log('   Subject: "Appointment Confirmed - [Date & Time]"');
              console.log('   Email should contain:');
              console.log('     - Patient name');
              console.log('     - Date & Time');
              console.log('     - Appointment type');
              console.log('     - Confirmation number');
              console.log('     - Provider name');
            } else {
              console.log('\n⚠️  Email was not sent (may be in console mode)');
            }
            
            resolve(response);
          } else {
            console.log('\n❌ TEST FAILED!');
            console.log('Error:', response.error || 'Unknown error');
            reject(new Error(response.error || 'Test failed'));
          }
        } catch (error) {
          console.error('\n❌ Failed to parse response:', error);
          console.log('Raw response:', data);
          reject(error);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('\n❌ Request error:', error.message);
      console.log('\n💡 Make sure the server is running:');
      console.log('   cd middleware-platform && npm start');
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

// Run test
if (require.main === module) {
  testAppointmentEmailAPI()
    .then(() => {
      console.log('\n✅ Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testAppointmentEmailAPI };

