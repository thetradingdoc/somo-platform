#!/usr/bin/env node
'use strict';

/**
 * R-03-3: Fail CI if voice-tagged files call getFHIRPatientByPhone without clinic scope wrapper.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VOICE_PATH_HINTS = [
  'voice-incoming-handler',
  'retell-websocket',
  'fhir-service.js',
  'routes/voice.js',
  'voice-appointments',
  'fhir-voice-lookup'
];

const ALLOWLIST = new Set([
  path.join(ROOT, 'database.js'),
  path.join(ROOT, 'services/fhir-voice-lookup.js'),
  path.join(ROOT, '__tests__'),
  path.join(ROOT, 'scripts/audit-voice-fhir-callers.cjs')
]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walk(p, out);
    } else if (/\.(js|cjs|mjs)$/.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

function isAllowlisted(file) {
  for (const a of ALLOWLIST) {
    if (file.includes(a)) return true;
  }
  return false;
}

function isVoiceTagged(file, content) {
  if (VOICE_PATH_HINTS.some((h) => file.includes(h))) return true;
  return /\b(channel\s*[=:]\s*['"]voice['"]|call_type.*voice|voice call|processVoiceCall)\b/i.test(content);
}

const offenders = [];
for (const file of walk(ROOT)) {
  if (isAllowlisted(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes('getFHIRPatientByPhone')) continue;
  if (!isVoiceTagged(file, content)) continue;
  if (content.includes('findFHIRPatientForVoice')) continue;
  const rel = path.relative(ROOT, file);
  offenders.push(rel);
}

if (offenders.length) {
  console.error('❌ Voice FHIR callers must use findFHIRPatientForVoice:');
  for (const f of offenders) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('✅ audit-voice-fhir-callers: no unscoped voice getFHIRPatientByPhone callers');
