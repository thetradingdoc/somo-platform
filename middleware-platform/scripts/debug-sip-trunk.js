#!/usr/bin/env node
/**
 * SIP Trunk Debugging Script
 * 
 * This script checks Twilio SIP trunk configuration and helps identify
 * why outbound calls through Retell are failing.
 * 
 * Usage:
 *   node scripts/debug-sip-trunk.js
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false
});

const twilio = require('twilio');
const axios = require('axios');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(title, 'cyan');
  console.log('='.repeat(70));
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logDetail(message) {
  log(`   ${message}`, 'magenta');
}

async function checkTwilioCredentials() {
  logSection('1. Twilio Credentials Check');
  
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!accountSid || !authToken) {
    logError('Twilio credentials not configured');
    return null;
  }
  
  logSuccess('Twilio credentials found');
  logDetail(`Account SID: ${accountSid}`);
  
  try {
    const client = twilio(accountSid, authToken);
    const account = await client.api.accounts(accountSid).fetch();
    logSuccess('Twilio API is accessible');
    logDetail(`Account Status: ${account.status}`);
    logDetail(`Account Type: ${account.type}`);
    return client;
  } catch (error) {
    logError(`Failed to connect to Twilio: ${error.message}`);
    if (error.code) {
      logError(`Error Code: ${error.code}`);
    }
    return null;
  }
}

async function checkSIPTrunks(client) {
  logSection('2. SIP Trunk Configuration');
  
  try {
    const trunks = await client.trunking.v1.trunks.list();
    
    if (trunks.length === 0) {
      logWarning('No SIP trunks found');
      return null;
    }
  
    logSuccess(`Found ${trunks.length} SIP trunk(s)`);
    
    // Find the trunk that matches our phone number or Retell
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    let targetTrunk = null;
    
    for (const trunk of trunks) {
      logInfo(`\nTrunk: ${trunk.friendlyName || trunk.sid}`);
      logDetail(`SID: ${trunk.sid}`);
      logDetail(`Date Created: ${trunk.dateCreated}`);
      
      // Check if this trunk has our phone number
      try {
        const numbers = await client.trunking.v1.trunks(trunk.sid).phoneNumbers.list();
        if (numbers.length > 0) {
          logDetail(`Phone Numbers: ${numbers.map(n => n.phoneNumber).join(', ')}`);
          if (fromNumber && numbers.some(n => n.phoneNumber === fromNumber)) {
            targetTrunk = trunk;
            logSuccess(`✓ This trunk has our phone number: ${fromNumber}`);
          }
        }
      } catch (err) {
        logWarning(`Could not fetch numbers for trunk: ${err.message}`);
      }
    }
    
    if (!targetTrunk && trunks.length > 0) {
      // Use the first trunk or one with "Retell" in the name
      targetTrunk = trunks.find(t => t.friendlyName && t.friendlyName.toLowerCase().includes('retell')) || trunks[0];
      logInfo(`\nUsing trunk: ${targetTrunk.friendlyName || targetTrunk.sid}`);
    }
    
    return targetTrunk;
  } catch (error) {
    logError(`Failed to fetch SIP trunks: ${error.message}`);
    return null;
  }
}

async function checkTrunkTermination(client, trunk) {
  logSection('3. Trunk Termination Configuration');
  
  if (!trunk) {
    logWarning('No trunk to check');
    return;
  }
  
  try {
    const termination = await client.trunking.v1.trunks(trunk.sid).terminationSettings.fetch();
    
    logInfo('Termination Settings:');
    
    if (termination.callingTrunkSid) {
      logDetail(`Calling Trunk SID: ${termination.callingTrunkSid}`);
    }
    
    // Check termination URIs
    if (termination.terminationSid) {
      logDetail(`Termination SID: ${termination.terminationSid}`);
    }
    
    // Get termination credentials
    const credentials = await client.trunking.v1.trunks(trunk.sid).terminationCredentials.list();
    if (credentials.length > 0) {
      logSuccess(`Termination Credentials: ${credentials.length} configured`);
      credentials.forEach(cred => {
        logDetail(`  - ${cred.friendlyName || cred.sid}`);
      });
    } else {
      logWarning('No termination credentials configured');
    }
    
    // Check IP access control lists
    const ipAccessControlLists = await client.trunking.v1.trunks(trunk.sid).ipAccessControlLists.list();
    if (ipAccessControlLists.length > 0) {
      logSuccess(`IP Access Control Lists: ${ipAccessControlLists.length} configured`);
      ipAccessControlLists.forEach(acl => {
        logDetail(`  - ${acl.friendlyName || acl.sid}`);
      });
    } else {
      logWarning('No IP Access Control Lists configured');
      logInfo('⚠️  This might be required for Retell to authenticate');
    }
    
    // Check credential lists
    const credentialLists = await client.trunking.v1.trunks(trunk.sid).credentialLists.list();
    if (credentialLists.length > 0) {
      logSuccess(`Credential Lists: ${credentialLists.length} configured`);
      credentialLists.forEach(cl => {
        logDetail(`  - ${cl.friendlyName || cl.sid}`);
      });
    } else {
      logWarning('No credential lists configured');
      logInfo('⚠️  This might be required for Retell to authenticate');
    }
    
  } catch (error) {
    logError(`Failed to fetch termination settings: ${error.message}`);
    if (error.code) {
      logError(`Error Code: ${error.code}`);
    }
  }
}

async function checkTrunkOrigination(client, trunk) {
  logSection('4. Trunk Origination Configuration');
  
  if (!trunk) {
    logWarning('No trunk to check');
    return;
  }
  
  try {
    const origination = await client.trunking.v1.trunks(trunk.sid).originationUrls.list();
    
    if (origination.length > 0) {
      logSuccess(`Origination URIs: ${origination.length} configured`);
      origination.forEach(url => {
        logDetail(`  - ${url.sipUrl}`);
        logDetail(`    Priority: ${url.priority}, Weight: ${url.weight}, Enabled: ${url.enabled}`);
      });
    } else {
      logWarning('No origination URIs configured');
    }
    
    // Check if Retell's SIP URI is configured
    const retellUri = origination.find(u => u.sipUrl && u.sipUrl.includes('retellai.com'));
    if (retellUri) {
      logSuccess('✓ Retell SIP URI found in origination');
      logDetail(`  ${retellUri.sipUrl}`);
    } else {
      logWarning('Retell SIP URI not found in origination');
      logInfo('Expected: sip:sip.retellai.com or similar');
    }
    
  } catch (error) {
    logError(`Failed to fetch origination settings: ${error.message}`);
  }
}

async function checkSIPDomains(client) {
  logSection('5. SIP Domains Configuration');
  
  try {
    const domains = await client.sip.domains.list();
    
    if (domains.length === 0) {
      logWarning('No SIP domains found');
      return;
    }
    
    logSuccess(`Found ${domains.length} SIP domain(s)`);
    
    domains.forEach(domain => {
      logInfo(`\nDomain: ${domain.domainName}`);
      logDetail(`SID: ${domain.sid}`);
      logDetail(`Friendly Name: ${domain.friendlyName || 'N/A'}`);
      logDetail(`Voice Region: ${domain.voiceRegion || 'N/A'}`);
      
      // Check if this domain has credential lists
      if (domain.credentialListMappings) {
        logDetail(`Credential Lists: ${Object.keys(domain.credentialListMappings).length}`);
      }
      
      // Check if this domain has IP access control lists
      if (domain.ipAccessControlListMappings) {
        logDetail(`IP ACLs: ${Object.keys(domain.ipAccessControlListMappings).length}`);
      }
    });
    
  } catch (error) {
    logError(`Failed to fetch SIP domains: ${error.message}`);
  }
}

async function checkRecentFailedCalls(client) {
  logSection('6. Recent Failed Calls Analysis');
  
  try {
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    const fiveMinutesAgo = new Date(Date.now() - 10 * 60 * 1000); // Last 10 minutes
    
    const calls = await client.calls.list({
      from: fromNumber,
      startTimeAfter: fiveMinutesAgo,
      limit: 10
    });
    
    const failedCalls = calls.filter(c => 
      c.status === 'failed' || 
      c.status === 'busy' || 
      c.direction === 'trunking-terminating'
    );
    
    if (failedCalls.length === 0) {
      logInfo('No recent failed calls found');
      return;
    }
    
    logWarning(`Found ${failedCalls.length} recent failed/trunking calls`);
    
    for (const call of failedCalls.slice(0, 5)) {
      logInfo(`\nCall SID: ${call.sid}`);
      logDetail(`Status: ${call.status}`);
      logDetail(`Direction: ${call.direction}`);
      logDetail(`From: ${call.from} → To: ${call.to}`);
      logDetail(`Duration: ${call.duration || '0'}s`);
      logDetail(`Start Time: ${call.startTime}`);
      
      // Get notifications for this call
      try {
        const notifications = await client.calls(call.sid).notifications.list({ limit: 3 });
        if (notifications.length > 0) {
          logDetail(`Errors/Warnings:`);
          notifications.forEach(notif => {
            logDetail(`  - Code ${notif.errorCode}: ${notif.message}`);
          });
        }
      } catch (err) {
        // Ignore notification errors
      }
    }
    
  } catch (error) {
    logError(`Failed to fetch call logs: ${error.message}`);
  }
}

async function checkCredentialLists(client) {
  logSection('7. Credential Lists');
  
  try {
    const lists = await client.sip.credentialLists.list();
    
    if (lists.length === 0) {
      logWarning('No credential lists found');
      logInfo('⚠️  You may need to create a credential list for Retell');
      return;
    }
    
    logSuccess(`Found ${lists.length} credential list(s)`);
    
    for (const list of lists) {
      logInfo(`\nList: ${list.friendlyName || list.sid}`);
      logDetail(`SID: ${list.sid}`);
      
      // Get credentials in this list
      try {
        const credentials = await client.sip.credentialLists(list.sid).credentials.list();
        logDetail(`Credentials: ${credentials.length}`);
        credentials.forEach(cred => {
          logDetail(`  - Username: ${cred.username} (SID: ${cred.sid})`);
        });
      } catch (err) {
        logWarning(`Could not fetch credentials: ${err.message}`);
      }
    }
    
    // Check for Retell-specific lists
    const retellLists = lists.filter(l => 
      l.friendlyName && l.friendlyName.toLowerCase().includes('retell')
    );
    
    if (retellLists.length > 0) {
      logSuccess(`✓ Found ${retellLists.length} Retell-related credential list(s)`);
    } else {
      logWarning('No Retell-specific credential lists found');
      logInfo('You may need to create one and add Retell\'s credentials');
    }
    
  } catch (error) {
    logError(`Failed to fetch credential lists: ${error.message}`);
  }
}

async function checkIPAccessControlLists(client) {
  logSection('8. IP Access Control Lists');
  
  try {
    const lists = await client.sip.ipAccessControlLists.list();
    
    if (lists.length === 0) {
      logWarning('No IP Access Control Lists found');
      logInfo('⚠️  You may need to create an IP ACL and add Retell\'s IP addresses');
      return;
    }
    
    logSuccess(`Found ${lists.length} IP Access Control List(s)`);
    
    for (const list of lists) {
      logInfo(`\nList: ${list.friendlyName || list.sid}`);
      logDetail(`SID: ${list.sid}`);
      
      // Get IP addresses in this list
      try {
        const addresses = await client.sip.ipAccessControlLists(list.sid).ipAddresses.list();
        logDetail(`IP Addresses: ${addresses.length}`);
        addresses.forEach(addr => {
          logDetail(`  - ${addr.friendlyName || addr.ipAddress} (${addr.ipAddress})`);
        });
      } catch (err) {
        logWarning(`Could not fetch IP addresses: ${err.message}`);
      }
    }
    
    // Check for Retell-specific lists
    const retellLists = lists.filter(l => 
      l.friendlyName && l.friendlyName.toLowerCase().includes('retell')
    );
    
    if (retellLists.length > 0) {
      logSuccess(`✓ Found ${retellLists.length} Retell-related IP ACL(s)`);
    } else {
      logWarning('No Retell-specific IP Access Control Lists found');
      logInfo('You may need to create one and add Retell\'s IP addresses');
      logInfo('Contact Retell support for their IP address ranges');
    }
    
  } catch (error) {
    logError(`Failed to fetch IP ACLs: ${error.message}`);
  }
}

async function generateRecommendations(client, trunk) {
  logSection('9. Recommendations');
  
  console.log('\n');
  
  if (!trunk) {
    logError('No SIP trunk found');
    logInfo('1. Create a SIP trunk in Twilio Console');
    logInfo('2. Configure termination URI');
    logInfo('3. Add credential list or IP ACL for authentication');
    return;
  }
  
  logInfo('Based on the configuration check, here are recommendations:');
  console.log('');
  
  // Check termination
  try {
    const credentialLists = await client.trunking.v1.trunks(trunk.sid).credentialLists.list();
    const ipACLs = await client.trunking.v1.trunks(trunk.sid).ipAccessControlLists.list();
    
    if (credentialLists.length === 0 && ipACLs.length === 0) {
      logError('⚠️  CRITICAL: No authentication configured for termination');
      logInfo('   Action: Add either a Credential List OR IP Access Control List');
      logInfo('   Location: Twilio Console → SIP Trunking → Your Trunk → Termination → Authentication');
    } else {
      logSuccess('✓ Authentication is configured');
    }
  } catch (err) {
    logWarning('Could not verify authentication configuration');
  }
  
  // Check origination
  try {
    const origination = await client.trunking.v1.trunks(trunk.sid).originationUrls.list();
    const retellUri = origination.find(u => u.sipUrl && u.sipUrl.includes('retellai.com'));
    
    if (!retellUri) {
      logWarning('⚠️  Retell SIP URI not found in origination');
      logInfo('   Action: Add sip:sip.retellai.com to Origination URIs');
      logInfo('   Location: Twilio Console → SIP Trunking → Your Trunk → Origination');
    } else {
      logSuccess('✓ Retell origination URI is configured');
    }
  } catch (err) {
    logWarning('Could not verify origination configuration');
  }
  
  // Check phone number
  try {
    const numbers = await client.trunking.v1.trunks(trunk.sid).phoneNumbers.list();
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    
    if (fromNumber && !numbers.some(n => n.phoneNumber === fromNumber)) {
      logWarning(`⚠️  Phone number ${fromNumber} not attached to trunk`);
      logInfo('   Action: Add phone number to trunk');
      logInfo('   Location: Twilio Console → SIP Trunking → Your Trunk → Numbers');
    } else if (fromNumber) {
      logSuccess(`✓ Phone number ${fromNumber} is attached to trunk`);
    }
  } catch (err) {
    logWarning('Could not verify phone number attachment');
  }
  
  console.log('');
  logInfo('Next Steps:');
  logInfo('1. Verify Retell dashboard has correct SIP trunk configuration');
  logInfo('2. Ensure credentials match between Twilio and Retell');
  logInfo('3. Test with a different phone number to rule out carrier blocking');
  logInfo('4. Check Retell dashboard for SIP trunk status and errors');
}

async function main() {
  console.log('\n' + '='.repeat(70));
  log('🔍 SIP TRUNK DEBUGGING TOOL', 'cyan');
  console.log('='.repeat(70));
  log('This tool checks your Twilio SIP trunk configuration', 'blue');
  log('to help identify why Retell outbound calls are failing.', 'blue');
  console.log('='.repeat(70) + '\n');
  
  const client = await checkTwilioCredentials();
  if (!client) {
    logError('\n❌ Cannot proceed without Twilio credentials');
    process.exit(1);
  }
  
  const trunk = await checkSIPTrunks(client);
  await checkTrunkTermination(client, trunk);
  await checkTrunkOrigination(client, trunk);
  await checkSIPDomains(client);
  await checkCredentialLists(client);
  await checkIPAccessControlLists(client);
  await checkRecentFailedCalls(client);
  await generateRecommendations(client, trunk);
  
  console.log('\n' + '='.repeat(70));
  log('✅ Debugging complete!', 'cyan');
  console.log('='.repeat(70) + '\n');
}

main().catch(error => {
  logError(`\n❌ Fatal error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

