#!/usr/bin/env node
/**
 * Check Credentials in Credential List
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false
});

const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

async function checkCredentials() {
  console.log('\n' + '='.repeat(70));
  console.log('🔐 CHECKING CREDENTIAL LISTS');
  console.log('='.repeat(70) + '\n');

  if (!accountSid || !authToken) {
    console.error('❌ Missing Twilio credentials');
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);

  try {
    // Check which credential list is attached to the trunk
    const trunkSid = 'TKef81908ba0a83bb52eff902076f5abfc';
    
    // Get trunk credential lists using REST API
    const axios = require('axios');
    const baseUrl = `https://trunking.twilio.com/v1/Trunks/${trunkSid}/CredentialLists`;
    
    const response = await axios.get(baseUrl, {
      auth: { username: accountSid, password: authToken }
    });
    
    if (response.data.credential_lists && response.data.credential_lists.length > 0) {
      console.log(`Trunk ${trunkSid} uses these credential lists:\n`);
      
      for (const cl of response.data.credential_lists) {
        console.log(`📋 ${cl.friendly_name || cl.sid}`);
        console.log(`   SID: ${cl.sid}`);
        
        // Get credentials in this list
        const credUrl = `https://trunking.twilio.com/v1/CredentialLists/${cl.sid}/Credentials`;
        let credResponse;
        try {
          credResponse = await axios.get(credUrl, {
            auth: { username: accountSid, password: authToken }
          });
        } catch (err) {
          // Try alternative endpoint format
          const altUrl = `https://trunking.twilio.com/v1/CredentialLists/${cl.sid}/Credentials.json`;
          credResponse = await axios.get(altUrl, {
            auth: { username: accountSid, password: authToken }
          });
        }
        
        if (credResponse.data.credentials && credResponse.data.credentials.length > 0) {
          console.log(`   Credentials (${credResponse.data.credentials.length}):`);
          credResponse.data.credentials.forEach((cred, i) => {
            console.log(`   ${i + 1}. Username: ${cred.username}`);
            console.log(`      Password: ${cred.password ? '***' + cred.password.slice(-4) : 'NOT SET'}`);
            console.log(`      SID: ${cred.sid}`);
          });
          
          const firstCred = credResponse.data.credentials[0];
          console.log(`\n   📋 Use these EXACT values in Retell Dashboard:`);
          console.log(`      Termination URI: aimedicalvoiceagent.pstn.twilio.com`);
          console.log(`      SIP Username: ${firstCred.username}`);
          console.log(`      SIP Password: ${firstCred.password || '(get from Twilio console)'}`);
        } else {
          console.log('   ⚠️  No credentials in this list');
        }
        console.log('');
      }
    } else {
      console.log('⚠️  No credential lists attached to trunk');
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.code) {
      console.error(`   Twilio Error Code: ${error.code}`);
    }
    process.exit(1);
  }
}

checkCredentials().catch(error => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

