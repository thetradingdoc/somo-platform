#!/usr/bin/env node
/**
 * Diagnose SIP Trunk Authentication Issues
 * Checks Twilio trunk termination settings vs Retell configuration
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false
});

const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const trunkSid = 'TKef81908ba0a83bb52eff902076f5abfc';

async function diagnose() {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 SIP TRUNK AUTHENTICATION DIAGNOSIS');
  console.log('='.repeat(70) + '\n');

  if (!accountSid || !authToken) {
    console.error('❌ Missing Twilio credentials');
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);

  try {
    // 1. Get Trunk Details
    console.log('📞 Fetching Trunk Details...');
    const trunk = await client.trunking.v1.trunks(trunkSid).fetch();
    console.log(`✅ Trunk: ${trunk.friendlyName || trunkSid}`);
    console.log(`   Domain: ${trunk.domainName || 'N/A'}`);
    console.log(`   Secure: ${trunk.secure || false}\n`);

    // 2. Get Termination Settings
    console.log('🔐 Checking Termination Authentication...');
    const termination = await client.trunking.v1.trunks(trunkSid)
      .terminationSettings()
      .fetch();
    
    console.log(`   Auth Type: ${termination.callInAuthType || 'N/A'}`);
    console.log(`   Calling Trunk SID: ${termination.callingTrunkSid || 'N/A'}`);
    
    // Get credential lists
    if (termination.credentialListSid) {
      const credList = await client.trunking.v1.credentialLists(termination.credentialListSid).fetch();
      console.log(`\n✅ Credential List: ${credList.friendlyName || termination.credentialListSid}`);
      
      // Get credentials in the list
      const credentials = await client.trunking.v1.credentialLists(termination.credentialListSid)
        .credentials
        .list();
      
      console.log(`   Credentials (${credentials.length}):`);
      credentials.forEach((cred, i) => {
        console.log(`   ${i + 1}. Username: ${cred.username}`);
        console.log(`      Password: ${'*'.repeat(cred.password ? cred.password.length : 0)}`);
        console.log(`      SID: ${cred.sid}`);
      });
    } else {
      console.log('   ⚠️  No credential list attached!');
    }

    // 3. Get IP ACLs
    console.log('\n🌐 Checking IP Access Control Lists...');
    const ipAccessControlLists = await client.trunking.v1.trunks(trunkSid)
      .ipAccessControlLists
      .list();
    
    if (ipAccessControlLists.length > 0) {
      console.log(`   IP ACLs (${ipAccessControlLists.length}):`);
      for (const acl of ipAccessControlLists) {
        const aclDetails = await client.trunking.v1.ipAccessControlLists(acl.sid).fetch();
        console.log(`   - ${aclDetails.friendlyName || acl.sid}`);
        
        const ipAddresses = await client.trunking.v1.ipAccessControlLists(acl.sid)
          .ipAddresses
          .list();
        
        if (ipAddresses.length > 0) {
          console.log(`     Allowed IPs (${ipAddresses.length}):`);
          ipAddresses.forEach(ip => {
            console.log(`       ${ip.ipAddress}/${ip.cidrPrefixLength || 32}`);
          });
        } else {
          console.log('     ⚠️  No IP addresses configured!');
        }
      }
    } else {
      console.log('   ⚠️  No IP ACLs attached!');
      console.log('   → This means ALL IPs are allowed (less secure)');
    }

    // 4. Get Origination Settings (for outbound)
    console.log('\n📤 Checking Origination Settings...');
    const origination = await client.trunking.v1.trunks(trunkSid)
      .originationSettings()
      .fetch();
    
    console.log(`   Auth Type: ${origination.callInAuthType || 'N/A'}`);
    if (origination.originationUrls && origination.originationUrls.length > 0) {
      console.log(`   Origination URLs (${origination.originationUrls.length}):`);
      origination.originationUrls.forEach((url, i) => {
        console.log(`   ${i + 1}. ${url.url}`);
        console.log(`      Priority: ${url.priority}`);
        console.log(`      Weight: ${url.weight}`);
      });
    }

    // 5. Summary and Recommendations
    console.log('\n' + '='.repeat(70));
    console.log('💡 CONFIGURATION SUMMARY');
    console.log('='.repeat(70));
    
    console.log('\n✅ Twilio Configuration:');
    console.log(`   Trunk SID: ${trunkSid}`);
    console.log(`   Domain: ${trunk.domainName || 'N/A'}`);
    console.log(`   Termination Auth: ${termination.callInAuthType || 'N/A'}`);
    
    if (termination.credentialListSid) {
      const credList = await client.trunking.v1.credentialLists(termination.credentialListSid).fetch();
      const credentials = await client.trunking.v1.credentialLists(termination.credentialListSid)
        .credentials
        .list();
      
      if (credentials.length > 0) {
        console.log(`   SIP Username: ${credentials[0].username}`);
        console.log(`   SIP Password: ${credentials[0].password ? '***' : 'NOT SET'}`);
      }
    }
    
    console.log('\n📋 Retell Configuration Should Match:');
    console.log(`   Termination URI: ${trunk.domainName || 'aimedicalvoiceagent.pstn.twilio.com'}`);
    if (termination.credentialListSid) {
      const credentials = await client.trunking.v1.credentialLists(termination.credentialListSid)
        .credentials
        .list();
      if (credentials.length > 0) {
        console.log(`   SIP Username: ${credentials[0].username}`);
        console.log(`   SIP Password: (copy from Twilio credential list)`);
      }
    }
    
    console.log('\n⚠️  If calls are failing with "User declined":');
    console.log('   1. Verify Retell has EXACT username/password from Twilio');
    console.log('   2. Verify Retell Termination URI matches Twilio domain');
    console.log('   3. Check if IP ACLs are blocking Retell IPs');
    console.log('   4. Verify credential list is attached to trunk termination');
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.code) {
      console.error(`   Twilio Error Code: ${error.code}`);
    }
    if (error.moreInfo) {
      console.error(`   More Info: ${error.moreInfo}`);
    }
    process.exit(1);
  }
}

diagnose().catch(error => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

