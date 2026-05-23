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
  if (!/^app\.(get|post|put|patch|delete)\(['"]\/api\/admin/.test(line)) {
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

function registerAdminPlatformRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requireAdminAuth,
    pricingRoutes,
  } = deps;

${body}
}

module.exports = { registerAdminPlatformRoutes };
`;

fs.writeFileSync(path.join(__dirname, '../routes/admin-platform.js'), out);
let server = fs.readFileSync(serverPath, 'utf8');
for (const block of blocks) {
  const idx = server.indexOf(block);
  if (idx === -1) continue;
  server = server.slice(0, idx) + server.slice(idx + block.length);
}
fs.writeFileSync(serverPath, server);
console.log('admin blocks', blocks.length, 'server lines', server.split('\n').length);
