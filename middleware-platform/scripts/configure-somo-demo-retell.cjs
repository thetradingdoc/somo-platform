#!/usr/bin/env node
'use strict';

/**
 * Configure Somo demo demo Retell agent (isolated from Kelly configure-retell.js).
 * Run: npm run configure:somo-demo
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const somoDemoEnv = require('../lib/somo-demo-env');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const RETELL_API_KEY = process.env.RETELL_API_KEY;
const AGENT_ID =
  somoDemoEnv.getRetellAgentId() ||
  (process.env.RETELL_SALES_AGENT_ID && String(process.env.RETELL_SALES_AGENT_ID).trim()) ||
  (process.env.RETELL_AGENT_ID && String(process.env.RETELL_AGENT_ID).trim()) ||
  null;
const VOICE_ID =
  somoDemoEnv.getDemoVoiceId() ||
  (process.env.RETELL_VOICE_ID && String(process.env.RETELL_VOICE_ID).trim()) ||
  'retell-Cimo';

let API_BASE_URL = process.env.API_BASE_URL || process.env.BASE_URL;
if (!API_BASE_URL) {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    API_BASE_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  } else {
    API_BASE_URL = 'http://localhost:4000';
  }
}
API_BASE_URL = API_BASE_URL.replace(/\/$/, '');

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' ||
  (API_BASE_URL && !API_BASE_URL.includes('localhost') && !API_BASE_URL.includes('127.0.0.1'));

const WEBSOCKET_URL = IS_PRODUCTION
  ? API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')
  : 'ws://localhost:4000';

function loadDemoPrompt() {
  const promptPath = path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'agent',
    'somo-demo',
    'prompts',
    'demo-voice-prompt.md'
  );
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Missing demo prompt: ${promptPath}`);
  }
  return fs.readFileSync(promptPath, 'utf8');
}

const DEMO_TOOLS = [
  {
    type: 'end_call',
    name: 'end_call',
    description: 'End the demo call when the conversation is complete.'
  },
  {
    type: 'custom',
    name: 'record_interest',
    description: 'Record prospect interest level (hot, warm, cold).',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['hot', 'warm', 'cold'] },
        notes: { type: 'string' }
      },
      required: ['level']
    }
  },
  {
    type: 'custom',
    name: 'send_signup_link',
    description: 'Text the prospect a Somo demo signup link.',
    parameters: { type: 'object', properties: {} }
  }
];

async function main() {
  if (!RETELL_API_KEY) {
    console.error('RETELL_API_KEY required');
    process.exit(1);
  }
  if (!AGENT_ID) {
    console.error('Set SOMO_DEMO_RETELL_AGENT_ID or RETELL_AGENT_ID');
    process.exit(1);
  }

  const generalPrompt = loadDemoPrompt();
  const retellApiBase = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';

  const updateData = {
    agent_name: 'Somo demo Demo — Medical',
    voice_id: VOICE_ID,
    language: 'en-US',
    response_engine: {
      type: 'custom-llm',
      llm_websocket_url: `${WEBSOCKET_URL}/webhook/retell/llm`
    },
    enable_backchannel: true,
    ambient_sound: null,
    general_prompt: generalPrompt,
    general_tools: DEMO_TOOLS
  };

  console.log('Updating Somo demo demo agent', AGENT_ID);
  console.log('WebSocket:', updateData.response_engine.llm_websocket_url);
  console.log('Voice:', VOICE_ID);

  await axios.patch(`${retellApiBase.replace(/\/$/, '')}/update-agent/${AGENT_ID}`, updateData, {
    headers: {
      Authorization: `Bearer ${RETELL_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  console.log('Somo demo demo agent configured successfully.');
}

main().catch((err) => {
  console.error(err.response?.data || err.message);
  process.exit(1);
});
