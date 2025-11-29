#!/usr/bin/env node
/**
 * Check Webhook Activity in Database
 */

const db = require('../database');

const callSid = process.argv[2] || 'CAb3e6d29a99a481264814d73538bd611a';

console.log('\n🔍 Checking Database for Webhook Activity\n');
console.log(`Call SID: ${callSid}\n`);

// Check lead_calls
const leadCalls = db.db.prepare(`
  SELECT * FROM lead_calls 
  WHERE call_id = ? OR call_id LIKE ?
  ORDER BY created_at DESC
  LIMIT 5
`).all(callSid, `%${callSid}%`);

console.log('📋 Call Records:');
if (leadCalls.length > 0) {
  leadCalls.forEach((call, index) => {
    console.log(`\n${index + 1}. Call Record ID: ${call.id}`);
    console.log(`   Call ID: ${call.call_id}`);
    console.log(`   Status: ${call.call_status}`);
    console.log(`   Created: ${call.created_at}`);
    console.log(`   Updated: ${call.updated_at}`);
    console.log(`   Duration: ${call.call_duration_seconds || 0}s`);
    console.log(`   Cost: $${call.call_cost || '0.00'}`);
    
    if (call.call_status !== 'initiated') {
      console.log(`   ✅ Status was updated (webhook likely called)`);
    } else {
      console.log(`   ⚠️  Status still "initiated" (webhook might not have been called)`);
    }
  });
} else {
  console.log('   No call records found');
}

// Check for activities
if (leadCalls.length > 0) {
  const leadId = leadCalls[0].lead_id;
  if (leadId) {
    const activities = db.getLeadActivities(leadId, { limit: 5 });
    console.log('\n📝 Lead Activities:');
    if (activities.length > 0) {
      activities.forEach((act, index) => {
        console.log(`\n${index + 1}. ${act.activity_type}`);
        console.log(`   Subject: ${act.activity_subject}`);
        console.log(`   Date: ${act.activity_date}`);
        if (act.metadata) {
          try {
            const meta = JSON.parse(act.metadata);
            if (meta.call_sid) {
              console.log(`   Call SID: ${meta.call_sid}`);
            }
          } catch (e) {}
        }
      });
    } else {
      console.log('   No activities found');
    }
  }
}

console.log('\n💡 To check server logs:');
console.log('   1. Look at the terminal where server.js is running');
console.log('   2. Look for: "📞 INCOMING CALL from Twilio"');
console.log('   3. Look for: "📊 CALL STATUS UPDATE"');
console.log('   4. If you see these, webhooks are working!');
console.log('');

