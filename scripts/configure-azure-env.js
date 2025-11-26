#!/usr/bin/env node

/**
 * Configure Azure App Service Environment Variables from local .env file
 * App: doclittle
 * Resource Group: doclittle
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_NAME = 'doclittle';
const RESOURCE_GROUP = 'doclittle';
const ENV_FILE = path.join(__dirname, '..', 'middleware-platform', '.env');

console.log('⚙️  CONFIGURING AZURE APP SERVICE FROM LOCAL .ENV');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// Check if .env exists
if (!fs.existsSync(ENV_FILE)) {
    console.error(`❌ Error: ${ENV_FILE} not found`);
    process.exit(1);
}

// Check Azure CLI
try {
    execSync('az account show', { stdio: 'ignore' });
} catch (error) {
    console.log('⚠️  Not logged in to Azure. Please run: az login');
    process.exit(1);
}

console.log('📝 Reading environment variables from .env...');
console.log('');

// Read and parse .env file
const envContent = fs.readFileSync(ENV_FILE, 'utf8');
const envVars = {};

envContent.split('\n').forEach(line => {
    line = line.trim();
    // Skip comments and empty lines
    if (!line || line.startsWith('#')) return;
    
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        let key = match[1].trim();
        let value = match[2].trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        
        envVars[key] = value;
    }
});

// Build settings array
const settings = [
    'NODE_ENV=production',
    `PORT=${envVars.PORT || 4000}`,
    'API_BASE_URL=https://api.doclittle.site'
];

// Add required secrets if they exist
const requiredVars = [
    'STRIPE_SECRET_KEY',
    'STRIPE_PUBLISHABLE_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'RETELL_API_KEY',
    'RETELL_AGENT_ID',
    'AZURE_COMMUNICATION_CONNECTION_STRING',
    'AZURE_EMAIL_SENDER'
];

const optionalVars = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'CIRCLE_API_KEY',
    'CIRCLE_WALLET_SET_ID',
    'MERCHANT_ID'
];

[...requiredVars, ...optionalVars].forEach(key => {
    if (envVars[key]) {
        // Escape special characters for Azure CLI
        let value = envVars[key];
        // Escape semicolons and other special chars
        value = value.replace(/;/g, '\\;').replace(/&/g, '\\&');
        settings.push(`${key}=${value}`);
    }
});

console.log(`🚀 Setting ${settings.length} environment variables in Azure App Service...`);
console.log('');

// Build Azure CLI command
const settingsArg = settings.map(s => `"${s}"`).join(' ');
const command = `az webapp config appsettings set --resource-group ${RESOURCE_GROUP} --name ${APP_NAME} --settings ${settingsArg}`;

try {
    execSync(command, { stdio: 'inherit', shell: true });
    console.log('');
    console.log('✅ Environment variables configured successfully!');
    console.log('');
    console.log('📋 Verify settings:');
    console.log(`   az webapp config appsettings list --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}`);
    console.log('');
} catch (error) {
    console.error('❌ Error setting environment variables:', error.message);
    process.exit(1);
}

