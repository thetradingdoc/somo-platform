#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');
const lines = fs.readFileSync(serverPath, 'utf8').split('\n');

const GROUPS = [
  { file: 'patient-profile.js', paths: ['/api/patient/support-config', '/api/patient/me', '/api/patient/intake', '/api/patient/identity', '/api/patient/features', '/api/patient/analytics/event', '/api/patient/health/catalog', '/api/patient/documents/export', '/api/patient/profile', '/api/patient/my-records', '/api/patient/records/query', '/api/patient/receipts'] },
  { file: 'patient-auth.js', paths: ['/api/patient/verify/send', '/api/patient/verify/confirm', '/api/patient/logout'] },
  { file: 'patient-documents.js', paths: ['/api/patient/send-upload-link', '/api/patient/visits/', '/api/patient/documents'] },
  { file: 'patient-wallet.js', paths: ['/api/patient/wallet/', '/api/patient/hsa-wallet', '/api/patient/:patientId/hsa-wallet', '/api/patient/cards', '/api/patient/:patientId/cards', '/api/patient/:patientId/transactions'] },
  { file: 'patient-insurance.js', paths: ['/api/patient/insurance'] },
];

function lineStartsRoute(line) {
  const m = line.match(/^app\.(get|post|put|patch|delete)\(/);
  if (!m) return null;
  const pathMatch = line.match(/['"]([^'"]+)['"]/);
  return pathMatch ? pathMatch[1] : null;
}

function routeOwner(routePath) {
  for (const g of GROUPS) {
    for (const p of g.paths) {
      if (routePath === p || routePath.startsWith(p)) return g.file;
    }
  }
  return null;
}

const blocks = Object.fromEntries(GROUPS.map((g) => [g.file, []]));
let i = 0;
while (i < lines.length) {
  const routePath = lineStartsRoute(lines[i]);
  if (!routePath) {
    i += 1;
    continue;
  }
  const owner = routeOwner(routePath);
  if (!owner) {
    i += 1;
    continue;
  }
  const start = i;
  let depth = 0;
  let j = i;
  for (; j < lines.length; j++) {
    const l = lines[j];
    for (const ch of l) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    if (j > start && depth <= 0 && /^\}\);?\s*$/.test(l.trim())) {
      blocks[owner].push(lines.slice(start, j + 1).join('\n'));
      i = j + 1;
      break;
    }
  }
  if (j >= lines.length) break;
}

const WRAP = (name, body) => `'use strict';

function ${name}(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requirePatientSession,
    resolvePatientIdFromSession,
    recordPatientPortalEvent,
    PatientPortalService,
    blockWalletWhenDisabled,
    blockChatWhenDisabled,
    withIdempotency,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
    requireAdminAuth,
    sendUploadLinkHandler,
    issuePatientDocumentDownloadUrl,
    parseBillingDocumentUpload,
    billingOk,
    billingErr,
    resolveBillingSubscription,
    requirePlusForBillingFeature,
    isPatientWalletEnabled,
    isPatientChatEnabled,
    parseBooleanFlag,
  } = deps;

${body}
}

module.exports = { ${name} };
`;

const removed = [];
for (const g of GROUPS) {
  const body = blocks[g.file].join('\n\n');
  if (!body.trim()) {
    console.warn('skip empty', g.file);
    continue;
  }
  const regName = `register${g.file.replace('.js', '').split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')}Routes`;
  const outPath = path.join(__dirname, '../routes', g.file);
  fs.writeFileSync(outPath, WRAP(regName, body));
  removed.push(...blocks[g.file]);
  console.log('wrote', g.file, body.split('\n').length, 'lines');
}

// Remove extracted blocks from server (longest-first by position)
const sortedBlocks = GROUPS.flatMap((g) => blocks[g.file].map((b) => ({ b, lines: b.split('\n').length })))
  .filter((x) => x.lines > 2);

let serverLines = fs.readFileSync(serverPath, 'utf8');
for (const g of GROUPS) {
  for (const block of blocks[g.file]) {
    if (!block.trim()) continue;
    const idx = serverLines.indexOf(block);
    if (idx === -1) {
      console.warn('block not found for', g.file);
      continue;
    }
    serverLines = serverLines.slice(0, idx) + serverLines.slice(idx + block.length);
  }
}
fs.writeFileSync(serverPath, serverLines);
console.log('server.js lines', serverLines.split('\n').length);
