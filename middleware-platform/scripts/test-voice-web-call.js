#!/usr/bin/env node
/**
 * Test Voice Web Call
 * Debug the /api/voice/web-call-token endpoint and Retell create-web-call API
 *
 * Usage:
 *   node scripts/test-voice-web-call.js                    # Test Retell API directly
 *   node scripts/test-voice-web-call.js --full             # Test full endpoint (needs session)
 *   node scripts/test-voice-web-call.js --agent <id>       # Use specific agent ID
 */

require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';

async function testRetellDirect(agentId) {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    console.error('❌ RETELL_API_KEY not set in .env');
    process.exit(1);
  }
  if (!agentId) {
    console.error('❌ Agent ID required. Set RETELL_AGENT_ID in .env or pass --agent <id>');
    process.exit(1);
  }

  console.log('\n📞 Testing Retell create-web-call API directly');
  console.log('   Agent ID:', agentId);
  console.log('   API Key:', apiKey.substring(0, 12) + '...');
  console.log('');

  try {
    const response = await axios.post(
      'https://api.retellai.com/v2/create-web-call',
      {
        agent_id: agentId,
        retell_llm_dynamic_variables: { test: 'true' }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000,
        validateStatus: () => true
      }
    );

    console.log('   Status:', response.status);
    console.log('   Response:', JSON.stringify(response.data, null, 2));

    if (response.status === 201 && response.data?.access_token) {
      console.log('\n✅ Retell API OK - token received');
      return true;
    }

    if (response.status === 402) {
      console.error('\n❌ 402 Payment Required - Retell account may need billing setup');
      console.error('   Check https://www.retellai.com/ for account status');
    } else if (response.status === 401) {
      console.error('\n❌ 401 Unauthorized - Check RETELL_API_KEY');
    } else if (response.status === 404) {
      console.error('\n❌ 404 - Agent not found. Check agent ID.');
    } else {
      console.error('\n❌ Retell API error:', response.status);
    }
    return false;
  } catch (err) {
    console.error('\n❌ Request failed:', err.message);
    if (err.response) {
      console.error('   Status:', err.response.status);
      console.error('   Data:', JSON.stringify(err.response.data, null, 2));
    }
    return false;
  }
}

async function testFullEndpoint(sessionCookie) {
  console.log('\n📞 Testing POST /api/voice/web-call-token');
  console.log('   Session:', sessionCookie ? 'provided' : 'MISSING');
  console.log('');

  if (!sessionCookie) {
    console.error('❌ Session cookie required for full test.');
    console.error('   1. Log in at http://localhost:4000/business/business-dashboard.html');
    console.error('   2. Open DevTools → Application → Cookies');
    console.error('   3. Copy customer_session value');
    console.error('   4. Run: node scripts/test-voice-web-call.js --full --cookie "paste_value"');
    process.exit(1);
  }

  try {
    const response = await axios.post(
      `${API_BASE}/api/voice/web-call-token`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `customer_session=${sessionCookie}`
        },
        timeout: 15000,
        validateStatus: () => true
      }
    );

    console.log('   Status:', response.status);
    console.log('   Response:', JSON.stringify(response.data, null, 2));

    if (response.status === 200 && response.data?.access_token) {
      console.log('\n✅ Full endpoint OK - token received');
      return true;
    }

    if (response.status === 401) {
      console.error('\n❌ 401 - Not authenticated. Check session cookie.');
    } else if (response.status === 400 && response.data?.error?.includes('Voice agent')) {
      console.error('\n❌ Voice agent not configured. Set RETELL_AGENT_ID or clinic retell_agent_id.');
    } else if (response.status === 500) {
      console.error('\n❌ 500 Server error. Check server logs for Retell API response.');
    }
    return false;
  } catch (err) {
    console.error('\n❌ Request failed:', err.message);
    if (err.response) {
      console.error('   Status:', err.response.status);
      console.error('   Data:', JSON.stringify(err.response.data, null, 2));
    }
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const agentArg = args.indexOf('--agent');
  const agentId =
    agentArg >= 0
      ? args[agentArg + 1]
      : process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a';
  const cookieArg = args.indexOf('--cookie');
  const sessionCookie = cookieArg >= 0 ? args[cookieArg + 1] : null;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Voice Web Call Debug');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (full) {
    await testFullEndpoint(sessionCookie);
  } else {
    const ok = await testRetellDirect(agentId);
    if (ok) {
      console.log('\n💡 Retell API works. If the widget still fails, test full endpoint with:');
      console.log('   node scripts/test-voice-web-call.js --full --cookie "<your_session>"');
    }
  }

  console.log('');
}

main().catch(console.error);
