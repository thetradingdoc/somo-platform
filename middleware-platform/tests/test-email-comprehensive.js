#!/usr/bin/env node

/**
 * Comprehensive Email Testing & Debugging
 * Tests all email functionality with detailed diagnostics
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const EmailService = require('../services/email-service');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';
const PATIENT_EMAIL = 'doctorjay254@gmail.com';
const INSURER_EMAIL = 'gigtogigdev@gmail.com';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    bold: '\x1b[1m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    log('\n' + '═'.repeat(70), 'cyan');
    log(title, 'cyan');
    log('═'.repeat(70), 'cyan');
}

function logSubsection(title) {
    log('\n' + '─'.repeat(70), 'blue');
    log(title, 'blue');
    log('─'.repeat(70), 'blue');
}

async function checkServer() {
    try {
        const response = await axios.get(`${API_BASE_URL}/health`, { timeout: 5000 });
        log('✅ Server is running', 'green');
        return true;
    } catch (error) {
        log('❌ Server is not running', 'red');
        log(`   Error: ${error.message}`, 'red');
        return false;
    }
}

async function checkEmailConfiguration() {
    logSection('📧 EMAIL SERVICE CONFIGURATION');
    
    const config = {
        azure_configured: EmailService.isAzureConfigured(),
        smtp_configured: !!EmailService.getTransporter(),
        smtp_host: process.env.SMTP_HOST || 'Not set',
        smtp_port: process.env.SMTP_PORT || 'Not set',
        smtp_user: process.env.SMTP_USER ? 'Set (hidden)' : 'Not set',
        smtp_from: process.env.SMTP_FROM || process.env.SMTP_USER || 'Not set',
        azure_connection_string: process.env.AZURE_COMMUNICATION_CONNECTION_STRING ? 'Set (hidden)' : 'Not set',
        azure_sender: process.env.AZURE_EMAIL_SENDER || 'Not set',
    };
    
    let provider = 'Console (Simulation)';
    if (config.azure_configured) {
        provider = 'Azure Communication Services';
    } else if (config.smtp_configured) {
        provider = 'SMTP';
    }
    
    log('\n📊 Configuration Status:', 'cyan');
    console.log(JSON.stringify(config, null, 2));
    
    log(`\n💡 Email Provider: ${provider}`, provider === 'Console (Simulation)' ? 'yellow' : 'green');
    
    if (provider === 'Console (Simulation)') {
        log('\n⚠️  WARNING: Email service is in SIMULATION MODE', 'red');
        log('   Emails are being logged to console, NOT actually sent!', 'red');
        log('\n📝 To send real emails, configure one of:', 'yellow');
        log('   1. SMTP (Gmail, SendGrid, Mailgun, etc.)', 'yellow');
        log('      Set: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD', 'yellow');
        log('   2. Azure Communication Services', 'yellow');
        log('      Set: AZURE_COMMUNICATION_CONNECTION_STRING, AZURE_EMAIL_SENDER', 'yellow');
    } else {
        log(`\n✅ Email service configured via ${provider}`, 'green');
        log('   Emails should be sent to the configured provider', 'green');
    }
    
    return { config, provider };
}

async function testEmailDirectly() {
    logSection('📧 TEST 1: DIRECT EMAIL SERVICE TEST');
    
    try {
        log('\n📤 Sending test email directly via EmailService...', 'cyan');
        
        const result = await EmailService.sendEmail({
            to: PATIENT_EMAIL,
            subject: 'Direct Email Service Test - DocLittle',
            html: '<p>This is a direct test of the EmailService.</p><p>If you receive this, the email service is working!</p>'
        });
        
        log(`\n📊 Result:`, 'cyan');
        console.log(JSON.stringify(result, null, 2));
        
        if (result.success) {
            log(`\n✅ Email sent successfully!`, 'green');
            log(`   Provider: ${result.provider || 'unknown'}`, 'green');
            log(`   Message ID: ${result.message_id || 'N/A'}`, 'green');
            
            if (result.provider === 'console') {
                log('\n⚠️  Email was logged to console (simulation mode)', 'yellow');
                log('   Check server logs to see the email content', 'yellow');
            } else {
                log(`\n📬 Check inbox at: ${PATIENT_EMAIL}`, 'cyan');
            }
        } else {
            log(`\n❌ Email send failed: ${result.error}`, 'red');
        }
        
        return result;
    } catch (error) {
        log(`\n❌ Error: ${error.message}`, 'red');
        return { success: false, error: error.message };
    }
}

async function testEmailEndpoint() {
    logSection('📧 TEST 2: EMAIL TEST ENDPOINT');
    
    try {
        log(`\n📤 Testing endpoint: POST ${API_BASE_URL}/api/test/email/send`, 'cyan');
        
        const response = await axios.post(`${API_BASE_URL}/api/test/email/send`, {
            to: PATIENT_EMAIL,
            subject: 'Email Endpoint Test - DocLittle',
            html: '<p>This is a test via the email test endpoint.</p>'
        }, { timeout: 10000 });
        
        log(`\n📊 Response:`, 'cyan');
        console.log(JSON.stringify(response.data, null, 2));
        
        if (response.data.success) {
            log(`\n✅ Endpoint test successful!`, 'green');
            log(`   Provider: ${response.data.provider || 'unknown'}`, 'green');
        } else {
            log(`\n❌ Endpoint test failed: ${response.data.message}`, 'red');
        }
        
        return response.data;
    } catch (error) {
        if (error.response) {
            log(`\n❌ Endpoint error: ${error.response.status}`, 'red');
            log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
        } else if (error.code === 'ECONNREFUSED') {
            log(`\n❌ Cannot connect to server`, 'red');
            log(`   Make sure server is running on ${API_BASE_URL}`, 'red');
        } else {
            log(`\n❌ Error: ${error.message}`, 'red');
        }
        return { success: false, error: error.message };
    }
}

async function testAllEmailTypes() {
    logSection('📧 TEST 3: ALL EMAIL TYPES');
    
    const results = {
        appointment: null,
        insurance: null,
        patient_billing: null,
        checkout: null
    };
    
    // Test Appointment Email
    logSubsection('1. Appointment Confirmation Email');
    try {
        const testAppointment = {
            id: 'test-appt-' + Date.now(),
            patient_name: 'Test Patient',
            patient_email: PATIENT_EMAIL,
            appointment_type: 'Therapy Session - Psychiatry',
            date: new Date().toISOString().split('T')[0],
            time: '1:00 PM',
            start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            duration_minutes: 50,
            provider: 'DocLittle Mental Health Team',
            timezone: 'America/New_York'
        };
        
        results.appointment = await EmailService.sendAppointmentConfirmation(testAppointment);
        log(`   ${results.appointment.success ? '✅' : '❌'} Appointment email: ${results.appointment.success ? 'Sent' : 'Failed'}`, 
            results.appointment.success ? 'green' : 'red');
        if (results.appointment.provider) {
            log(`   Provider: ${results.appointment.provider}`, 'blue');
        }
    } catch (error) {
        log(`   ❌ Error: ${error.message}`, 'red');
        results.appointment = { success: false, error: error.message };
    }
    
    // Test Insurance Billing Email
    logSubsection('2. Insurance Billing Email');
    try {
        const claimData = {
            claimId: 'test-claim-' + Date.now(),
            x12ClaimId: 'X12_TEST_' + Date.now(),
            memberId: 'TEST123456',
            patientName: 'Test Patient',
            serviceCode: '90834',
            totalAmount: 150.00,
            copayPaid: 20.00,
            dateOfService: new Date().toISOString().split('T')[0]
        };
        
        results.insurance = await EmailService.sendInsuranceBillingEmail(INSURER_EMAIL, claimData);
        log(`   ${results.insurance.success ? '✅' : '❌'} Insurance billing email: ${results.insurance.success ? 'Sent' : 'Failed'}`, 
            results.insurance.success ? 'green' : 'red');
        if (results.insurance.provider) {
            log(`   Provider: ${results.insurance.provider}`, 'blue');
        }
    } catch (error) {
        log(`   ❌ Error: ${error.message}`, 'red');
        results.insurance = { success: false, error: error.message };
    }
    
    // Test Patient Billing Email
    logSubsection('3. Patient Billing Email');
    try {
        const billingData = {
            patientName: 'Test Patient',
            appointmentDate: new Date().toISOString().split('T')[0],
            serviceName: 'Therapy Session - Psychiatry',
            totalAmount: 150.00,
            insuranceAmount: 130.00,
            copayAmount: 20.00,
            amountDue: 20.00
        };
        
        results.patient_billing = await EmailService.sendPatientBillingEmail(PATIENT_EMAIL, billingData);
        log(`   ${results.patient_billing.success ? '✅' : '❌'} Patient billing email: ${results.patient_billing.success ? 'Sent' : 'Failed'}`, 
            results.patient_billing.success ? 'green' : 'red');
        if (results.patient_billing.provider) {
            log(`   Provider: ${results.patient_billing.provider}`, 'blue');
        }
    } catch (error) {
        log(`   ❌ Error: ${error.message}`, 'red');
        results.patient_billing = { success: false, error: error.message };
    }
    
    // Test Checkout Email
    logSubsection('4. Checkout Verification Email');
    try {
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        results.checkout = await EmailService.sendCheckoutVerificationCode(PATIENT_EMAIL, verificationCode);
        log(`   ${results.checkout.success ? '✅' : '❌'} Checkout email: ${results.checkout.success ? 'Sent' : 'Failed'}`, 
            results.checkout.success ? 'green' : 'red');
        if (results.checkout.provider) {
            log(`   Provider: ${results.checkout.provider}`, 'blue');
        }
        log(`   Verification Code: ${verificationCode}`, 'blue');
    } catch (error) {
        log(`   ❌ Error: ${error.message}`, 'red');
        results.checkout = { success: false, error: error.message };
    }
    
    return results;
}

async function checkServerLogs() {
    logSection('📋 SERVER LOGS CHECK');
    
    log('\n💡 To see email logs:', 'cyan');
    log('   1. Check server console output', 'cyan');
    log('   2. Look for lines starting with "📧 EMAIL"', 'cyan');
    log('   3. If in simulation mode, emails are logged there', 'cyan');
    log('\n📝 Recent email activity should show:', 'cyan');
    log('   - Email send attempts', 'cyan');
    log('   - Provider used (SMTP/Azure/Console)', 'cyan');
    log('   - Success/failure status', 'cyan');
    log('   - Error messages (if any)', 'cyan');
}

async function main() {
    log('\n' + '═'.repeat(70), 'magenta');
    log('🔍 COMPREHENSIVE EMAIL DEBUGGING & TESTING', 'magenta');
    log('═'.repeat(70), 'magenta');
    log(`\nAPI Base URL: ${API_BASE_URL}`, 'blue');
    log(`Patient Email: ${PATIENT_EMAIL}`, 'blue');
    log(`Insurer Email: ${INSURER_EMAIL}`, 'blue');
    
    // Step 1: Check server
    const serverRunning = await checkServer();
    if (!serverRunning) {
        log('\n❌ Cannot proceed - server is not running', 'red');
        log('   Please start the server first:', 'yellow');
        log('   cd middleware-platform && npm start', 'yellow');
        process.exit(1);
    }
    
    // Step 2: Check email configuration
    const { config, provider } = await checkEmailConfiguration();
    
    // Step 3: Test email directly
    const directResult = await testEmailDirectly();
    
    // Step 4: Test email endpoint (if server is running)
    const endpointResult = await testEmailEndpoint();
    
    // Step 5: Test all email types
    const allResults = await testAllEmailTypes();
    
    // Step 6: Check server logs info
    await checkServerLogs();
    
    // Final Summary
    logSection('📊 FINAL SUMMARY');
    
    const allTests = [
        { name: 'Direct Email Service', result: directResult },
        { name: 'Email Endpoint', result: endpointResult },
        { name: 'Appointment Email', result: allResults.appointment },
        { name: 'Insurance Billing', result: allResults.insurance },
        { name: 'Patient Billing', result: allResults.patient_billing },
        { name: 'Checkout Email', result: allResults.checkout }
    ];
    
    const passed = allTests.filter(t => t.result && t.result.success).length;
    const failed = allTests.filter(t => !t.result || !t.result.success).length;
    
    log(`\n📊 Test Results:`, 'cyan');
    log(`   Total Tests: ${allTests.length}`, 'cyan');
    log(`   ✅ Passed: ${passed}`, 'green');
    log(`   ❌ Failed: ${failed}`, failed > 0 ? 'red' : 'green');
    
    log(`\n📋 Individual Results:`, 'cyan');
    allTests.forEach((test, index) => {
        const icon = test.result && test.result.success ? '✅' : '❌';
        const color = test.result && test.result.success ? 'green' : 'red';
        log(`   ${index + 1}. ${icon} ${test.name}`, color);
        if (test.result && test.result.provider) {
            log(`      Provider: ${test.result.provider}`, 'blue');
        }
        if (test.result && test.result.error) {
            log(`      Error: ${test.result.error}`, 'red');
        }
    });
    
    log(`\n💡 Email Provider: ${provider}`, provider === 'Console (Simulation)' ? 'yellow' : 'green');
    
    if (provider === 'Console (Simulation)') {
        log('\n⚠️  IMPORTANT: Emails are in SIMULATION MODE', 'red');
        log('   All emails are logged to console, NOT actually sent!', 'red');
        log('   Check server logs to see email content.', 'yellow');
        log('   Configure SMTP or Azure to send real emails.', 'yellow');
    } else {
        log(`\n✅ Email service is configured via ${provider}`, 'green');
        log('   Emails should be sent to the configured provider.', 'green');
        log(`\n📬 Check inboxes:`, 'cyan');
        log(`   - ${PATIENT_EMAIL} (should receive 3 emails)`, 'cyan');
        log(`   - ${INSURER_EMAIL} (should receive 1 email)`, 'cyan');
    }
    
    log('\n' + '═'.repeat(70), 'magenta');
    
    if (failed === 0) {
        log('✅ All email tests completed!', 'green');
        process.exit(0);
    } else {
        log('⚠️  Some email tests failed. Review errors above.', 'yellow');
        process.exit(1);
    }
}

main().catch(error => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});

