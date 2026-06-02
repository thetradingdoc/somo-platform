/**
 * Configure Local Email Settings
 * Helps set up SMTP email for local development
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function configureLocalEmail() {
    console.log('\n📧 CONFIGURE LOCAL EMAIL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('This will help you set up SMTP email for local testing.\n');

    // Check if .env file exists
    const envPath = path.join(__dirname, '..', '.env');
    const envExamplePath = path.join(__dirname, '..', '.env.example');
    
    let envContent = '';
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
        console.log('✅ Found existing .env file');
    } else {
        console.log('📝 Creating new .env file');
    }

    console.log('\n📋 Email Service Options:');
    console.log('   1. Gmail (easiest for testing)');
    console.log('   2. SendGrid');
    console.log('   3. Mailgun');
    console.log('   4. Custom SMTP\n');

    const serviceChoice = await question('Choose email service (1-4): ');
    
    let smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom;

    switch (serviceChoice.trim()) {
        case '1':
            // Gmail
            console.log('\n📧 Gmail Configuration:');
            console.log('   Note: You need to use an "App Password" for Gmail.');
            console.log('   Get one at: https://myaccount.google.com/apppasswords\n');
            
            smtpHost = 'smtp.gmail.com';
            smtpPort = '587';
            smtpUser = await question('   Gmail address: ');
            smtpPassword = await question('   App Password (16 characters): ');
            smtpFrom = smtpUser;
            break;

        case '2':
            // SendGrid
            console.log('\n📧 SendGrid Configuration:');
            smtpHost = 'smtp.sendgrid.net';
            smtpPort = '587';
            smtpUser = 'apikey';
            smtpPassword = await question('   SendGrid API Key: ');
            smtpFrom = await question('   From email address: ');
            break;

        case '3':
            // Mailgun
            console.log('\n📧 Mailgun Configuration:');
            smtpHost = 'smtp.mailgun.org';
            smtpPort = '587';
            smtpUser = await question('   Mailgun SMTP username: ');
            smtpPassword = await question('   Mailgun SMTP password: ');
            smtpFrom = await question('   From email address: ');
            break;

        case '4':
            // Custom
            console.log('\n📧 Custom SMTP Configuration:');
            smtpHost = await question('   SMTP Host: ');
            smtpPort = await question('   SMTP Port (default 587): ') || '587';
            smtpUser = await question('   SMTP Username: ');
            smtpPassword = await question('   SMTP Password: ');
            smtpFrom = await question('   From email address: ');
            break;

        default:
            console.log('❌ Invalid choice');
            rl.close();
            return;
    }

    // Also set BASE_URL for local testing
    console.log('\n🌐 Base URL Configuration:');
    console.log('   For local testing, use: http://localhost:4000');
    console.log('   For production, use: https://api.callsomo.com');
    const baseUrl = await question('   Base URL (default: http://localhost:4000): ') || 'http://localhost:4000';

    // Build .env content
    const emailConfig = `
# Email Configuration (Local Development)
SMTP_HOST=${smtpHost}
SMTP_PORT=${smtpPort}
SMTP_USER=${smtpUser}
SMTP_PASSWORD=${smtpPassword}
SMTP_FROM=${smtpFrom || smtpUser}

# Base URL for payment links
BASE_URL=${baseUrl}
API_BASE_URL=${baseUrl}
`;

    // Update or create .env file
    if (fs.existsSync(envPath)) {
        // Remove old email config if exists
        const lines = envContent.split('\n');
        const filteredLines = lines.filter(line => 
            !line.startsWith('SMTP_') && 
            !line.startsWith('BASE_URL') && 
            !line.startsWith('API_BASE_URL') &&
            line.trim() !== ''
        );
        envContent = filteredLines.join('\n') + emailConfig;
    } else {
        envContent = emailConfig;
    }

    // Write .env file
    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
    console.log('\n✅ Email configuration saved to .env file');
    console.log(`   Location: ${envPath}`);

    // Test email configuration
    console.log('\n🧪 Testing email configuration...');
    try {
        const EmailService = require('../services/email-service');
        const transporter = EmailService.getTransporter();
        
        if (transporter) {
            console.log('✅ SMTP transporter created successfully');
            console.log('\n📧 Ready to send emails!');
            console.log('   Run: node scripts/test-email-payment-link.js');
        } else {
            console.log('⚠️  Could not create SMTP transporter');
            console.log('   Check your credentials and try again');
        }
    } catch (error) {
        console.error('❌ Error testing email:', error.message);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ CONFIGURATION COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    rl.close();
}

// Run configuration
if (require.main === module) {
    configureLocalEmail()
        .catch((error) => {
            console.error('\n❌ Configuration error:', error);
            process.exit(1);
        });
}

module.exports = configureLocalEmail;

