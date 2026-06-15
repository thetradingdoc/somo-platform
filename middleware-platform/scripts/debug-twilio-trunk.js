#!/usr/bin/env node
/**
 * Debug Twilio SIP Trunk Configuration
 * 
 * Checks:
 * 1. Trunk configuration
 * 2. SIP domain settings
 * 3. Credential lists
 * 4. IP ACLs
 * 5. Recent failed calls
 * 6. Error notifications
 * 
 * Usage:
 *   node scripts/debug-twilio-trunk.js
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false
});

const twilio = require('twilio');

// Colors
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

async function checkTrunkConfiguration() {
  logSection('1. SIP Trunk Configuration');
  
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!accountSid || !authToken) {
    logError('Twilio credentials not configured');
    return null;
  }
  
  const client = twilio(accountSid, authToken);
  const trunkSid = 'TKef81908ba0a83bb52eff902076f5abfc'; // Retell-AI-Trunk
  
  try {
    const trunk = await client.trunking.v1.trunks(trunkSid).fetch();
    
    logSuccess('Trunk found!');
    logInfo(`Friendly Name: ${trunk.friendlyName}`);
    logInfo(`Trunk SID: ${trunk.sid}`);
    logInfo(`Status: ${trunk.status || 'N/A'}`);
    
    // Check phone numbers
    const phoneNumbers = await client.trunking.v1.trunks(trunkSid)
      .phoneNumbers
      .list();
    
    if (phoneNumbers.length > 0) {
      logSuccess(`Phone Numbers (${phoneNumbers.length}):`);
      phoneNumbers.forEach(pn => {
        logDetail(`  - ${pn.phoneNumber} (SID: ${pn.sid})`);
      });
    } else {
      logWarning('No phone numbers attached to trunk');
    }
    
    // Check origination settings
    const originationUrls = await client.trunking.v1.trunks(trunkSid)
      .originationUrls
      .list();
    
    if (originationUrls.length > 0) {
      logSuccess('Origination URIs:');
      originationUrls.forEach(url => {
        logDetail(`  - ${url.sipUrl}`);
        logDetail(`    Weight: ${url.weight}, Priority: ${url.priority}`);
      });
    } else {
      logWarning('No origination URIs configured');
    }
    
    // Check termination settings
    const terminations = await client.trunking.v1.trunks(trunkSid)
      .termination
      .fetch();
    
    if (terminations) {
      logInfo('Termination Settings:');
      logDetail(`  SIP Domain: ${terminations.sipDomain || 'N/A'}`);
      logDetail(`  Disabled: ${terminations.disabled || false}`);
    }
    
    // Check credential lists
    const credentialLists = await client.trunking.v1.trunks(trunkSid)
      .credentialLists
      .list();
    
    if (credentialLists.length > 0) {
      logSuccess(`Credential Lists (${credentialLists.length}):`);
      credentialLists.forEach(cl => {
        logDetail(`  - ${cl.friendlyName} (SID: ${cl.sid})`);
      });
    } else {
      logError('No credential lists attached to trunk');
    }
    
    // Check IP ACLs
    const ipAccessControlLists = await client.trunking.v1.trunks(trunkSid)
      .ipAccessControlLists
      .list();
    
    if (ipAccessControlLists.length > 0) {
      logSuccess(`IP Access Control Lists (${ipAccessControlLists.length}):`);
      ipAccessControlLists.forEach(ipacl => {
        logDetail(`  - ${ipacl.friendlyName} (SID: ${ipacl.sid})`);
      });
    } else {
      logWarning('No IP Access Control Lists attached to trunk');
    }
    
    return trunk;
  } catch (error) {
    logError(`Failed to get trunk: ${error.message}`);
    if (error.code) {
      logError(`Twilio Error Code: ${error.code}`);
    }
    return null;
  }
}

async function checkSIPDomain() {
  logSection('2. SIP Domain Configuration');
  
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = twilio(accountSid, authToken);
  
  try {
    const domains = await client.sip.domains.list();
    const sipHint = process.env.TWILIO_SIP_DOMAIN_HINT || 'callsomo';
    const targetDomain = domains.find(d => d.domainName.includes(sipHint));
    
    if (targetDomain) {
      logSuccess('SIP Domain found!');
      logInfo(`Domain Name: ${targetDomain.domainName}`);
      logInfo(`Friendly Name: ${targetDomain.friendlyName}`);
      logInfo(`SID: ${targetDomain.sid}`);
      
      // Check credential lists
      const credentialLists = await client.sip.domains(targetDomain.sid)
        .credentialListMappings
        .list();
      
      if (credentialLists.length > 0) {
        logSuccess(`Credential Lists (${credentialLists.length}):`);
        credentialLists.forEach(cl => {
          logDetail(`  - ${cl.friendlyName || cl.sid}`);
        });
      }
      
      // Check IP ACLs
      const ipAccessControlLists = await client.sip.domains(targetDomain.sid)
        .ipAccessControlListMappings
        .list();
      
      if (ipAccessControlLists.length > 0) {
        logSuccess(`IP ACLs (${ipAccessControlLists.length}):`);
        ipAccessControlLists.forEach(ipacl => {
          logDetail(`  - ${ipacl.friendlyName || ipacl.sid}`);
        });
      }
      
      return targetDomain;
    } else {
      logWarning(`SIP Domain not found (hint: ${process.env.TWILIO_SIP_DOMAIN_HINT || 'callsomo'}.pstn.twilio.com)`);
      logInfo('Available domains:');
      domains.forEach(d => {
        logDetail(`  - ${d.domainName}`);
      });
      return null;
    }
  } catch (error) {
    logError(`Failed to get SIP domains: ${error.message}`);
    return null;
  }
}

async function checkRecentFailedCalls() {
  logSection('3. Recent Failed Calls');
  
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = twilio(accountSid, authToken);
  
  try {
    const calls = await client.calls.list({
      limit: 10,
      status: 'failed'
    });
    
    const trunkingCalls = calls.filter(c => 
      c.direction === 'trunking-terminating' || 
      c.callType === 'sip-pstn'
    );
    
    if (trunkingCalls.length > 0) {
      logWarning(`Found ${trunkingCalls.length} recent failed trunking calls`);
      
      trunkingCalls.slice(0, 5).forEach((call, index) => {
        console.log(`\n${index + 1}. Call SID: ${call.sid}`);
        logInfo(`   Status: ${call.status}`);
        logInfo(`   Direction: ${call.direction}`);
        logInfo(`   From: ${call.from} → To: ${call.to}`);
        logInfo(`   Duration: ${call.duration || '0'}s`);
        logInfo(`   Date: ${call.dateCreated}`);
        
        // Get notifications
        client.calls(call.sid).notifications.list({ limit: 3 })
          .then(notifications => {
            if (notifications.length > 0) {
              logDetail('   Errors:');
              notifications.forEach(n => {
                logDetail(`     - Code ${n.errorCode}: ${n.message || 'N/A'}`);
              });
            }
          })
          .catch(() => {});
      });
    } else {
      logInfo('No recent failed trunking calls found');
    }
  } catch (error) {
    logError(`Failed to get calls: ${error.message}`);
  }
}

async function checkCredentialList() {
  logSection('4. Credential List Details');
  
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = twilio(accountSid, authToken);
  
  try {
    const credentialLists = await client.sip.credentialLists.list();
    const targetList = credentialLists.find(cl => 
      cl.friendlyName === 'retell-outbound' || 
      cl.friendlyName.includes('retell')
    );
    
    if (targetList) {
      logSuccess('Credential list found!');
      logInfo(`Friendly Name: ${targetList.friendlyName}`);
      logInfo(`SID: ${targetList.sid}`);
      
      // Get credentials
      const credentials = await client.sip
        .credentialLists(targetList.sid)
        .credentials
        .list();
      
      if (credentials.length > 0) {
        logSuccess(`Credentials (${credentials.length}):`);
        credentials.forEach(cred => {
          logDetail(`  - Username: ${cred.username}`);
          logDetail(`    SID: ${cred.sid}`);
          logDetail(`    Password: [HIDDEN]`);
        });
      } else {
        logWarning('No credentials in list');
      }
      
      return targetList;
    } else {
      logWarning('Credential list "retell-outbound" not found');
      logInfo('Available lists:');
      credentialLists.forEach(cl => {
        logDetail(`  - ${cl.friendlyName}`);
      });
      return null;
    }
  } catch (error) {
    logError(`Failed to get credential lists: ${error.message}`);
    return null;
  }
}

async function generateDiagnosis() {
  logSection('5. Diagnosis & Recommendations');
  
  console.log('');
  logInfo('Based on the configuration check:');
  console.log('');
  
  logInfo('✅ What should be configured:');
  logDetail('1. Trunk should have phone number attached');
  logDetail('2. Trunk should have credential list attached');
  logDetail('3. Trunk should have IP ACLs attached');
  logDetail('4. SIP Domain should exist (e.g. callsomo.pstn.twilio.com)');
  logDetail('5. Retell should have termination URI configured');
  logDetail('6. Retell should have SIP credentials configured');
  console.log('');
  
  logWarning('Common issues:');
  logDetail('1. Retell termination URI doesn\'t match Twilio SIP domain');
  logDetail('2. Retell SIP credentials don\'t match Twilio credential list');
  logDetail('3. Retell SIP trunk not active/registered');
  logDetail('4. Network/firewall blocking SIP traffic');
  console.log('');
  
  logInfo('Next steps:');
  logDetail('1. Verify Retell dashboard has correct termination URI');
  logDetail('2. Verify Retell SIP credentials match Twilio');
  logDetail('3. Check Retell dashboard → Call History for call status');
  logDetail('4. Test call again after Retell configuration');
}

async function main() {
  console.log('\n' + '='.repeat(70));
  log('🔍 TWILIO SIP TRUNK DEBUG', 'cyan');
  console.log('='.repeat(70));
  log('Trunk SID: TKef81908ba0a83bb52eff902076f5abfc', 'blue');
  console.log('='.repeat(70) + '\n');
  
  await checkTrunkConfiguration();
  await checkSIPDomain();
  await checkCredentialList();
  await checkRecentFailedCalls();
  await generateDiagnosis();
  
  console.log('\n' + '='.repeat(70));
  log('✅ Debug complete!', 'cyan');
  console.log('='.repeat(70) + '\n');
}

main().catch(error => {
  logError(`\n❌ Fatal error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

