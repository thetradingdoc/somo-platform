#!/usr/bin/env node
/**
 * Update Production Configuration
 * Updates Twilio/Retell numbers in Azure from local .env or user input
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('🔄 Update Production Configuration\n');
  console.log('═'.repeat(70));

  // Get current production config
  console.log('📡 Fetching current production config...');
  let currentConfig = {};
  try {
    const output = execSync(
      'az webapp config appsettings list --name doclittle --resource-group doclittle --output json',
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    const settings = JSON.parse(output);
    settings.forEach(setting => {
      currentConfig[setting.name] = setting.value;
    });
  } catch (error) {
    console.error('❌ Failed to get production config:', error.message);
    process.exit(1);
  }

  console.log('\n📞 CURRENT PRODUCTION VALUES:');
  console.log(`   Twilio Phone:  ${currentConfig.TWILIO_PHONE_NUMBER || '(not set)'}`);
  console.log(`   Retell Agent:  ${currentConfig.RETELL_AGENT_ID || '(not set)'}`);

  // Get new values
  console.log('\n📝 Enter NEW values (press Enter to keep current):\n');

  const newPhone = await question(`New Twilio Phone Number [${currentConfig.TWILIO_PHONE_NUMBER || 'none'}]: `);
  const newAgentId = await question(`New Retell Agent ID [${currentConfig.RETELL_AGENT_ID || 'none'}]: `);

  // Prepare updates
  const updates = {};
  if (newPhone.trim() && newPhone.trim() !== currentConfig.TWILIO_PHONE_NUMBER) {
    updates.TWILIO_PHONE_NUMBER = newPhone.trim();
  }
  if (newAgentId.trim() && newAgentId.trim() !== currentConfig.RETELL_AGENT_ID) {
    updates.RETELL_AGENT_ID = newAgentId.trim();
  }

  if (Object.keys(updates).length === 0) {
    console.log('\n✅ No changes to make. Exiting.');
    rl.close();
    return;
  }

  // Confirm
  console.log('\n📋 CHANGES TO APPLY:');
  Object.keys(updates).forEach(key => {
    console.log(`   ${key}: ${currentConfig[key]} → ${updates[key]}`);
  });

  const confirm = await question('\n⚠️  Apply these changes to PRODUCTION? (yes/no): ');
  if (confirm.toLowerCase() !== 'yes') {
    console.log('❌ Cancelled.');
    rl.close();
    return;
  }

  // Update Azure
  console.log('\n🔄 Updating Azure configuration...');
  try {
    const settings = Object.keys(updates).map(key => 
      `${key}="${updates[key]}"`
    ).join(' ');

    execSync(
      `az webapp config appsettings set --name doclittle --resource-group doclittle --settings ${settings}`,
      { stdio: 'inherit' }
    );

    console.log('\n✅ Production configuration updated successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Update Twilio webhook to point to your new number');
    console.log('   2. Update Retell agent webhook URL if needed');
    console.log('   3. Test the new configuration:');
    console.log('      node scripts/test-config.js');
  } catch (error) {
    console.error('\n❌ Failed to update:', error.message);
    process.exit(1);
  }

  rl.close();
}

main();

