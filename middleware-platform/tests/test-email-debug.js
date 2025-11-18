#!/usr/bin/env node

/**
 * Email Debugging & Testing Tool
 * Comprehensive email testing with detailed diagnostics
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

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
    magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    log('\n' + '═'.repeat(70), 'cyan');
    log(title, 'cyan');
    log('═'.repeat(70), 'cyan');
}

async function checkEmailStatus() {
    logSection('📧 EMAIL SERVICE STATUS CHECK');
    
    try {
        const response = await axios.get(`${API_BASE_URL}/api/test/email/status`);
        
        if (response.data.success) {
            log('✅ Email service status retrieved', 'green');
            log('\n📊 Configuration:', 'cyan');
            console.log(JSON.stringify(response.data.status, null, 2));
            
            log('\n💡 Provider:', 'yellow');
            log(`   ${response.data.status.email_provider}`, 
                response.data.status.email_provider === 'Console (Simulation)' ? 'yellow' : 'green');
            
            if (response.data.status.email_provider === 'Console (Simulation)') {
                log('\n⚠️  WARNING: Email service is in simulation mode!', 'red');
                log('   Emails are being logged to console, not actually sent.', 'red');
                log('   To send real emails, configure:', 'yellow');
                log('   1. SMTP (Gmail, SendGrid, etc.):', 'yellow');
                log('      - SMTP_HOST', 'yellow');
                log('      - SMTP_PORT', 'yellow');
                log('      - SMTP_USER', 'yellow');
                log('      - SMTP_PASSWORD', 'yellow');
                log('   2. Azure Communication Services:', 'yellow');
                log('      - AZURE_COMMUNICATION_CONNECTION_STRING', 'yellow');
                log('      - AZURE_EMAIL_SENDER', 'yellow');
            }
            
            return response.data.status;
        } else {
            log('❌ Failed to get email status', 'red');
            return null;
        }
    } catch (error) {
        log(`❌ Error checking email status: ${error.message}`, 'red');
        if (error.response) {
            log(`   Status: ${error.response.status}`, 'red');
            log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
        }
        return null;
    }
}

async function testEmailSend(to, subject, html) {
    logSection(`📧 TEST EMAIL SEND TO: ${to}`);
    
    try {
        const response = await axios.post(`${API_BASE_URL}/api/test/email/send`, {
            to: to,
            subject: subject || 'Test Email from DocLittle',
            html: html || '<p>This is a test email from DocLittle platform.</p>'
        });
        
        if (response.data.success) {
            log(`✅ Email sent successfully!`, 'green');
            log(`   Provider: ${response.data.provider}`, 'green');
            log(`   Message ID: ${response.data.result.message_id || 'N/A'}`, 'green');
            
            if (response.data.provider === 'console') {
                log('\n⚠️  Email was logged to console (simulation mode)', 'yellow');
                log('   Check server logs to see the email content', 'yellow');
            } else {
                log(`\n📬 Check inbox at: ${to}`, 'cyan');
            }
            
            return response.data;
        } else {
            log(`❌ Failed to send email: ${response.data.message}`, 'red');
            return response.data;
        }
    } catch (error) {
        log(`❌ Error sending test email: ${error.message}`, 'red');
        if (error.response) {
            log(`   Status: ${error.response.status}`, 'red');
            log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
        }
        return { success: false, error: error.message };
    }
}

async function testAllEmails() {
    logSection('📧 TESTING ALL EMAIL TYPES');
    
    try {
        const response = await axios.post(`${API_BASE_URL}/api/test/email/all`, {
            patient_email: PATIENT_EMAIL,
            insurer_email: INSURER_EMAIL
        });
        
        log(`\n📊 Test Results:`, 'cyan');
        log(`   Total Tests: ${response.data.total_tests}`, 'cyan');
        log(`   Successful: ${response.data.successful}`, 'green');
        log(`   Failed: ${response.data.failed}`, response.data.failed > 0 ? 'red' : 'green');
        log(`   Provider: ${response.data.email_provider}`, 'cyan');
        
        log(`\n📋 Individual Test Results:`, 'cyan');
        response.data.tests.forEach((test, index) => {
            const icon = test.success ? '✅' : '❌';
            const color = test.success ? 'green' : 'red';
            log(`   ${index + 1}. ${icon} ${test.type} → ${test.to}`, color);
            if (test.provider) {
                log(`      Provider: ${test.provider}`, 'blue');
            }
            if (test.error) {
                log(`      Error: ${test.error}`, 'red');
            }
        });
        
        log(`\n💬 Summary:`, 'cyan');
        log(`   ${response.data.message}`, response.data.success ? 'green' : 'yellow');
        
        if (response.data.email_provider === 'Console') {
            log('\n⚠️  All emails were logged to console (simulation mode)', 'yellow');
            log('   Check server logs to see email content', 'yellow');
        } else {
            log(`\n📬 Check inboxes:`, 'cyan');
            log(`   - ${PATIENT_EMAIL} (should receive 3 emails)`, 'cyan');
            log(`   - ${INSURER_EMAIL} (should receive 1 email)`, 'cyan');
        }
        
        return response.data;
    } catch (error) {
        log(`❌ Error testing all emails: ${error.message}`, 'red');
        if (error.response) {
            log(`   Status: ${error.response.status}`, 'red');
            log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
        }
        return { success: false, error: error.message };
    }
}

async function main() {
    log('\n🔍 EMAIL DEBUGGING & TESTING TOOL', 'magenta');
    log('='.repeat(70), 'magenta');
    log(`API Base URL: ${API_BASE_URL}`, 'blue');
    log(`Patient Email: ${PATIENT_EMAIL}`, 'blue');
    log(`Insurer Email: ${INSURER_EMAIL}`, 'blue');
    
    // Check server
    try {
        await axios.get(`${API_BASE_URL}/health`);
        log('\n✅ Server is running', 'green');
    } catch (error) {
        log('\n❌ Server is not running', 'red');
        log('   Please start the server first', 'red');
        process.exit(1);
    }
    
    // Step 1: Check email service status
    const status = await checkEmailStatus();
    
    // Step 2: Test simple email send
    logSection('📧 TEST 1: SIMPLE EMAIL SEND');
    await testEmailSend(PATIENT_EMAIL, 'Test Email - DocLittle', '<p>This is a simple test email.</p>');
    
    // Step 3: Test all email types
    await testAllEmails();
    
    // Final summary
    logSection('📊 FINAL SUMMARY');
    
    if (status) {
        if (status.email_provider === 'Console (Simulation)') {
            log('⚠️  EMAIL SERVICE STATUS: Simulation Mode', 'yellow');
            log('   Emails are being logged to console, not actually sent.', 'yellow');
            log('   Configure SMTP or Azure to send real emails.', 'yellow');
        } else {
            log(`✅ EMAIL SERVICE STATUS: ${status.email_provider}`, 'green');
            log('   Emails should be sent to the configured provider.', 'green');
        }
    }
    
    log('\n📝 Next Steps:', 'cyan');
    log('   1. Check server logs for email content (if in simulation mode)', 'cyan');
    log('   2. Check email inboxes (if real email provider configured)', 'cyan');
    log('   3. Configure SMTP or Azure if emails are not being sent', 'cyan');
    log('\n' + '='.repeat(70), 'magenta');
}

main().catch(error => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});

