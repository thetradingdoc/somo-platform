#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');
let lines = fs.readFileSync(serverPath, 'utf8').split('\n');
const blocks = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (!/^app\.(get|post|put|patch|delete)\(['"]\/voice\//.test(line)) {
    i += 1;
    continue;
  }
  const start = i;
  let depth = 0;
  let j = i;
  for (; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    if (j > start && depth <= 0 && /^\}\);?\s*$/.test(lines[j].trim())) {
      blocks.push(lines.slice(start, j + 1).join('\n'));
      i = j + 1;
      break;
    }
  }
  if (j >= lines.length) break;
}

const body = blocks.join('\n\n');
const out = `'use strict';

function registerVoiceAppointmentRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    scheduleCheckoutLimiter,
    voiceLimiter,
    withIdempotency,
    resolveClinicIdFromRequest,
    FALLBACK_CLINIC_ID,
    ensureSlotBundles,
  } = deps;

${body}
}

module.exports = { registerVoiceAppointmentRoutes };
`;

fs.writeFileSync(path.join(__dirname, '../routes/voice-appointments.js'), out);
let server = fs.readFileSync(serverPath, 'utf8');
for (const block of blocks) {
  const idx = server.indexOf(block);
  if (idx === -1) {
    console.warn('voice block missing');
    continue;
  }
  server = server.slice(0, idx) + server.slice(idx + block.length);
}
fs.writeFileSync(serverPath, server);
console.log('voice blocks', blocks.length, 'lines removed', body.split('\n').length);
