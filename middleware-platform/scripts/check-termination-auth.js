#!/usr/bin/env node
/**
 * Check Termination Authentication for SIP Trunk
 */

const axios = require('axios');
require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const trunkSid = 'TKef81908ba0a83bb52eff902076f5abfc';

const baseUrl = `https://trunking.twilio.com/v1/Trunks/${trunkSid}`;

async function checkTermination() {
  console.log('\n🔍 Checking Termination Authentication...\n');
  
  try {
    // Get credential lists
    const credListsResponse = await axios.get(`${baseUrl}/CredentialLists`, {
      auth: { username: accountSid, password: authToken }
    });
    
    console.log('📋 Credential Lists attached to trunk:');
    if (credListsResponse.data.credential_lists && credListsResponse.data.credential_lists.length > 0) {
      credListsResponse.data.credential_lists.forEach(cl => {
        console.log(`   ✅ ${cl.friendly_name || cl.sid}`);
      });
    } else {
      console.log('   ❌ NONE ATTACHED');
    }
    
    // Get IP ACLs
    const ipACLsResponse = await axios.get(`${baseUrl}/IpAccessControlLists`, {
      auth: { username: accountSid, password: authToken }
    });
    
    console.log('\n🌐 IP Access Control Lists attached to trunk:');
    if (ipACLsResponse.data.ip_access_control_lists && ipACLsResponse.data.ip_access_control_lists.length > 0) {
      ipACLsResponse.data.ip_access_control_lists.forEach(acl => {
        console.log(`   ✅ ${acl.friendly_name || acl.sid}`);
      });
    } else {
      console.log('   ❌ NONE ATTACHED');
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🔍 DIAGNOSIS:');
    console.log('='.repeat(60));
    
    const hasCredLists = credListsResponse.data.credential_lists && credListsResponse.data.credential_lists.length > 0;
    const hasIPACLs = ipACLsResponse.data.ip_access_control_lists && ipACLsResponse.data.ip_access_control_lists.length > 0;
    
    if (!hasCredLists && !hasIPACLs) {
      console.log('\n❌ CRITICAL ISSUE FOUND!');
      console.log('   No authentication configured for termination.');
      console.log('   Retell cannot authenticate when making outbound calls.');
      console.log('\n✅ SOLUTION:');
      console.log('   1. Go to Twilio Console → SIP Trunking → Retell-AI-Trunk → Termination');
      console.log('   2. Under "Authentication", add:');
      console.log('      - Credential List: "retell-outbound"');
      console.log('      OR');
      console.log('      - IP Access Control List: "Retell-IPs"');
      console.log('   3. Save the configuration');
      console.log('   4. Test the call again');
    } else if (hasCredLists && hasIPACLs) {
      console.log('\n✅ Authentication is configured (both credential lists and IP ACLs)');
      console.log('   The issue might be:');
      console.log('   1. Credentials don\'t match between Twilio and Retell');
      console.log('   2. Retell is not using the correct termination URI');
      console.log('   3. Carrier blocking the call');
      console.log('   4. Retell dashboard SIP trunk configuration is incorrect');
    } else {
      console.log('\n⚠️  Partial authentication configured');
      if (hasCredLists) {
        console.log('   ✓ Credential lists configured');
        console.log('   ⚠️  Missing IP ACLs (might be required)');
      }
      if (hasIPACLs) {
        console.log('   ✓ IP ACLs configured');
        console.log('   ⚠️  Missing credential lists (might be required)');
      }
      console.log('\n💡 Try adding both for maximum compatibility');
    }
    
    console.log('\n📋 What to check in Retell Dashboard:');
    console.log('   1. Settings → Telephony → SIP Trunk Configuration');
    console.log('   2. Termination URI should match: aimedicalvoiceagent.pstn.twilio.com');
    console.log('   3. SIP credentials should match Twilio credential list');
    console.log('   4. IP addresses should match Twilio IP ACL');
    
  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    if (error.response?.status === 404) {
      console.log('\n⚠️  Trunk not found or API endpoint changed');
    }
    if (error.response?.data) {
      console.log('Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

checkTermination();

