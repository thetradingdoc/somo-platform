#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const strict = process.env.HEALTH_DEV_STRICT === '1';

/** Hard blockers — Kelly + LiveKit room */
const required = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'GROQ_API_KEY'
];

/** Phase 1 uses browser STT — no Deepgram required */
const recommended = [
  'VIDEO_CONSULT_AGENT_SECRET'
];

const optional = [
  'DERM_EDUCATION_PIPELINE_ENABLED',
  'RAG_EDUCATION_URL',
  'HEALTH_VISION_ANTHROPIC_ENABLED',
  'HEALTH_BROWSER_STT_ONLY',
  'HEALTH_TTS_ENABLED',
  'HEALTH_SERVER_STT_ENABLED'
];

let failed = false;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[health-env] MISSING required: ${key}`);
    failed = true;
  } else {
    console.log(`[health-env] OK ${key}`);
  }
}

for (const key of recommended) {
  if (!process.env[key]) {
    const msg = `[health-env] MISSING recommended: ${key}`;
    if (strict) {
      console.error(msg);
      failed = true;
    } else {
      console.warn(`${msg} (dev continues — agent-events auth skipped when unset)`);
    }
  } else {
    console.log(`[health-env] OK ${key}`);
  }
}

for (const key of optional) {
  console.log(`[health-env] ${process.env[key] ? 'OK' : 'skip'} ${key}`);
}

if (process.env.DERM_EDUCATION_PIPELINE_ENABLED === 'true') {
  const ragUrl = process.env.RAG_EDUCATION_URL || 'http://localhost:4000/api/rag';
  console.log(`[health-env] RAG target: ${ragUrl} (verify /retrieve_passages separately)`);
}

console.log('[health-env] Phase 1 default: browser STT + Groq text UI (no Deepgram/TTS required)');

if (failed) {
  process.exit(1);
}
console.log('[health-env] Health video env OK.');
