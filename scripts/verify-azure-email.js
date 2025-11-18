#!/usr/bin/env node

/**
 * Azure Email Configuration Verification Script
 * Checks if Azure email is properly configured
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const EmailService = require('../services/email-service');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    log('\n' + '═'.repeat(70), 'cyan');
    log(title, 'cyan');
    log('═'.repeat(70), 'cyan');
}

async function main() {
    log('\n🔍 AZURE EMAIL CONFIGURATION VERIFICATION', 'cyan');
    log('='.repeat(70), 'cyan');
    
    logSection('📧 CONFIGURATION CHECK');
    
    // Check Azure configuration
    const azureConfigured = EmailService.isAzureConfigured();
    const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING;
    const senderAddress = process.env.AZURE_EMAIL_SENDER;
    
    log('\n📊 Configuration Status:', 'cyan');
    log(`   Azure Configured: ${azureConfigured ? '✅ YES' : '❌ NO'}`, azureConfigured ? 'green' : 'red');
    log(`   Connection String: ${connectionString ? '✅ Set' : '❌ Missing'}`, connectionString ? 'green' : 'red');
    log(`   Sender Address: ${senderAddress || '❌ Missing'}`, senderAddress ? 'green' : 'red');
    
    if (!azureConfigured) {
        log('\n❌ Azure Email is NOT configured!', 'red');
        log('\n📝 To configure:', 'yellow');
        log('   1. Follow: docs/AZURE_EMAIL_SETUP_GUIDE.md', 'yellow');
        log('   2. Add to .env:', 'yellow');
        log('      AZURE_COMMUNICATION_CONNECTION_STRING=endpoint=https://...', 'yellow');
        log('      AZURE_EMAIL_SENDER=DoNotReply@doclittle.site', 'yellow');
        log('   3. Restart server', 'yellow');
        process.exit(1);
    }
    
    log('\n✅ Azure Email is configured!', 'green');
    
    // Test email send
    logSection('📧 TEST EMAIL SEND');
    
    const testEmail = process.argv[2] || 'doctorjay254@gmail.com';
    log(`\n📤 Sending test email to: ${testEmail}`, 'cyan');
    
    try {
        const result = await EmailService.sendEmail({
            to: testEmail,
            subject: 'Azure Email Test - DocLittle',
            html: '<p>This is a test email from Azure Communication Services.</p><p>If you receive this, Azure email is working correctly! ✅</p>'
        });
        
        if (result.success) {
            log('\n✅ Email sent successfully!', 'green');
            log(`   Provider: ${result.provider}`, 'green');
            log(`   Message ID: ${result.message_id || 'N/A'}`, 'green');
            log(`\n📬 Check inbox at: ${testEmail}`, 'cyan');
        } else {
            log('\n❌ Email send failed!', 'red');
            log(`   Error: ${result.error}`, 'red');
            process.exit(1);
        }
    } catch (error) {
        log(`\n❌ Error: ${error.message}`, 'red');
        console.error(error);
        process.exit(1);
    }
    
    log('\n' + '═'.repeat(70), 'cyan');
    log('✅ Verification complete!', 'green');
    log('═'.repeat(70), 'cyan');
}

main().catch(error => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});

