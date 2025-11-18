#!/usr/bin/env node
/**
 * Compare Production vs Local Configuration
 * Shows differences between Azure (production) and local environment
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Comparing Production vs Local Configuration\n');
console.log('═'.repeat(70));

// Get production config from Azure
console.log('\n📡 Fetching PRODUCTION config from Azure...');
let productionConfig = {};
try {
  const output = execSync(
    'az webapp config appsettings list --name doclittle --resource-group doclittle --output json',
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  const settings = JSON.parse(output);
  settings.forEach(setting => {
    productionConfig[setting.name] = setting.value;
  });
  console.log('✅ Production config retrieved');
} catch (error) {
  console.error('❌ Failed to get production config:', error.message);
  console.log('   Make sure you are logged into Azure CLI: az login');
  process.exit(1);
}

// Get local config from .env file
console.log('\n📁 Reading LOCAL config from .env file...');
let localConfig = {};
const envPath = path.join(__dirname, '..', 'middleware-platform', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      localConfig[match[1].trim()] = match[2].trim();
    }
  });
  console.log('✅ Local config loaded');
} else {
  console.log('⚠️  No .env file found at:', envPath);
}

// Key variables to compare
const keyVars = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'RETELL_API_KEY',
  'RETELL_AGENT_ID',
  'API_BASE_URL',
  'STRIPE_SECRET_KEY',
  'MERCHANT_ID'
];

console.log('\n📊 CONFIGURATION COMPARISON');
console.log('═'.repeat(70));

const differences = [];

keyVars.forEach(key => {
  const prod = productionConfig[key] || '(not set)';
  const local = localConfig[key] || '(not set)';
  
  // Mask sensitive values for display
  const maskValue = (val, key) => {
    if (val === '(not set)') return val;
    if (key.includes('TOKEN') || key.includes('KEY') || key.includes('SECRET')) {
      if (val.length > 10) {
        return val.substring(0, 4) + '...' + val.substring(val.length - 4);
      }
      return '***';
    }
    return val;
  };

  const prodDisplay = maskValue(prod, key);
  const localDisplay = maskValue(local, key);
  
  const isDifferent = prod !== local;
  const status = isDifferent ? '⚠️  DIFFERENT' : '✅ MATCH';
  
  console.log(`\n${key}:`);
  console.log(`  Production: ${prodDisplay}`);
  console.log(`  Local:      ${localDisplay}`);
  console.log(`  Status:     ${status}`);
  
  if (isDifferent && (key.includes('TWILIO') || key.includes('RETELL'))) {
    differences.push({ key, prod, local });
  }
});

// Summary
console.log('\n\n📋 SUMMARY');
console.log('═'.repeat(70));

if (differences.length === 0) {
  console.log('✅ Production and Local configurations match!');
} else {
  console.log(`⚠️  Found ${differences.length} differences in Twilio/Retell config:`);
  differences.forEach(diff => {
    console.log(`   - ${diff.key}`);
  });
  console.log('\n💡 To update production with local values, run:');
  console.log('   node scripts/update-production-config.js');
}

// Current production values
console.log('\n\n📞 CURRENT PRODUCTION VALUES');
console.log('═'.repeat(70));
console.log(`Twilio Phone:  ${productionConfig.TWILIO_PHONE_NUMBER || '(not set)'}`);
console.log(`Retell Agent:   ${productionConfig.RETELL_AGENT_ID || '(not set)'}`);
console.log(`API Base URL:   ${productionConfig.API_BASE_URL || '(not set)'}`);

console.log('\n');

