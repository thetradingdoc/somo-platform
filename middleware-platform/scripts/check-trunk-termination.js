#!/usr/bin/env node
const twilio = require('twilio');
require('dotenv').config();

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const trunkSid = 'TKef81908ba0a83bb52eff902076f5abfc';

async function main() {
  console.log('\n🔍 Checking Trunk Termination Settings\n');
  console.log('Trunk SID:', trunkSid);
  console.log('');
  
  try {
    const trunk = await client.trunking.v1.trunks(trunkSid).fetch();
    console.log('✅ Trunk Found:', trunk.friendlyName);
    console.log('');
    
    // Termination - check if termination settings exist
    try {
      const termination = await client.trunking.v1.trunks(trunkSid).termination.fetch();
      console.log('📥 TERMINATION SETTINGS:');
      console.log('   SIP Domain:', termination.sipDomain || '❌ NOT SET');
      console.log('   Disabled:', termination.disabled || false);
      
      if (!termination.sipDomain) {
        console.log('\n❌ ISSUE FOUND: Termination SIP Domain is NOT SET!');
        console.log('\nThis is why calls are failing.');
        console.log('Retell needs a SIP domain to connect to.');
        console.log('\n💡 Solution:');
        console.log('   1. Create a SIP Domain in Twilio');
        console.log('   2. Set it as the termination domain for this trunk');
        console.log('   3. Configure Retell with that domain as termination URI');
      } else {
        console.log('\n✅ Termination SIP Domain:', termination.sipDomain);
        console.log('\nThis should match what you configured in Retell dashboard.');
        console.log('Retell Termination URI should be:', termination.sipDomain);
      }
    } catch (termError) {
      console.log('📥 TERMINATION SETTINGS:');
      console.log('   ❌ Could not fetch termination settings');
      console.log('   Error:', termError.message);
      console.log('\n⚠️  This might mean termination is not configured');
    }
    console.log('');
    
    if (!termination.sipDomain) {
      console.log('❌ ISSUE FOUND: Termination SIP Domain is NOT SET!');
      console.log('');
      console.log('This is why calls are failing.');
      console.log('Retell needs a SIP domain to connect to.');
      console.log('');
      console.log('💡 Solution:');
      console.log('   1. Create a SIP Domain in Twilio');
      console.log('   2. Set it as the termination domain for this trunk');
      console.log('   3. Configure Retell with that domain as termination URI');
    } else {
      console.log('✅ Termination SIP Domain:', termination.sipDomain);
      console.log('');
      console.log('This should match what you configured in Retell dashboard.');
      console.log('Retell Termination URI should be:', termination.sipDomain);
    }
    
    // Phone numbers
    const phoneNumbers = await client.trunking.v1.trunks(trunkSid).phoneNumbers.list();
    console.log('\n📞 Phone Numbers:', phoneNumbers.length);
    phoneNumbers.forEach(pn => {
      console.log('   -', pn.phoneNumber);
    });
    
    // Credential lists
    const credentialLists = await client.trunking.v1.trunks(trunkSid).credentialLists.list();
    console.log('\n🔐 Credential Lists:', credentialLists.length);
    credentialLists.forEach(cl => {
      console.log('   -', cl.friendlyName);
    });
    
    // IP ACLs
    const ipACLs = await client.trunking.v1.trunks(trunkSid).ipAccessControlLists.list();
    console.log('\n🌐 IP ACLs:', ipACLs.length);
    ipACLs.forEach(acl => {
      console.log('   -', acl.friendlyName);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main();

