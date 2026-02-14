/**
 * Diagnostic test for ElevenLabs API - find why 401 occurs
 * Run: node scripts/test-elevenlabs.js
 */
require('dotenv').config();
const axios = require('axios');

const key = (process.env.ELEVENLABS || process.env.ELEVENLABS_API_KEY || '').trim();

async function test() {
  console.log('ElevenLabs Diagnostic');
  console.log('Key present:', !!key, '| Length:', key?.length);
  console.log('Key prefix:', key ? key.substring(0, 10) + '...' : 'N/A');
  console.log('');

  // Test 1: Standard /v1/user
  console.log('1. GET /v1/user (standard API)');
  try {
    const r = await axios.get('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': key }
    });
    console.log('   ✅ Key works - subscription:', r.data?.subscription?.status || 'OK');
  } catch (e) {
    console.log('   ❌', e.response?.status, JSON.stringify(e.response?.data) || e.message);
  }

  // Test 2: List Conv AI agents - try xi-api-key
  console.log('');
  console.log('2. GET /v1/convai/agents (Conversational AI)');
  try {
    const r = await axios.get('https://api.elevenlabs.io/v1/convai/agents', {
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      params: { page_size: 5 }
    });
    console.log('   ✅ Agents:', r.data?.agents?.length ?? 0);
    if (r.data?.agents?.[0]) {
      const a = r.data.agents[0];
      console.log('   First agent:', a.agent_id || a.id, '-', a.name || '(unnamed)');
    }
  } catch (e) {
    console.log('   ❌ Status:', e.response?.status);
    console.log('   Body:', JSON.stringify(e.response?.data, null, 2) || e.message);
  }

  // Test 3: Get signed URL (needs agent_id)
  console.log('');
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (agentId) {
    console.log('3. GET /v1/convai/conversation/get-signed-url (agent:', agentId, ')');
    try {
      const r = await axios.get('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url', {
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        params: { agent_id: agentId }
      });
      console.log('   ✅ Signed URL received:', r.data?.signed_url ? 'yes' : 'no');
    } catch (e) {
      console.log('   ❌ Status:', e.response?.status);
      console.log('   Body:', JSON.stringify(e.response?.data, null, 2) || e.message);
    }
  } else {
    console.log('3. Skipped (set ELEVENLABS_AGENT_ID to test get-signed-url)');
  }
}

test().catch(console.error);
