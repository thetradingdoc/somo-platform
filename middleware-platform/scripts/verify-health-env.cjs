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

/** Nice for full STT pipeline; browser STT fallback works without Deepgram in dev */
const recommended = [
  'DEEPGRAM_API_KEY',
  'VIDEO_CONSULT_AGENT_SECRET'
];

const optional = [
  'DERM_EDUCATION_PIPELINE_ENABLED',
  'RAG_EDUCATION_URL',
  'MIDDLEWARE_URL',
  'ANTHROPIC_API_KEY'
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
      console.warn(`${msg} (dev continues — browser STT / local secret fallback)`);
    }
  } else {
    console.log(`[health-env] OK ${key}`);
  }
}

for (const key of optional) {
  console.log(`[health-env] ${process.env[key] ? 'OK' : 'skip'} ${key}`);
}

if (failed) {
  process.exit(1);
}
console.log('[health-env] Health video env OK.');
