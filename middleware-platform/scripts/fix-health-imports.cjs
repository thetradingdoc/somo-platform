#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const HEALTH = path.join(__dirname, '..', 'services', 'health');

const PARENT_SERVICES = [
  'video-consult-service', 'video-consult-sse', 'video-consult-sse-schema',
  'safety-prescreen', 'insurance-service', 'rcm-journey-orchestrator',
  'vision-capture-store', 'kelly-tool-executor'
];

function walk(dir, files = []) {
  for (const n of fs.readdirSync(dir)) {
    const f = path.join(dir, n);
    if (fs.statSync(f).isDirectory()) walk(f, files);
    else if (n.endsWith('.js')) files.push(f);
  }
  return files;
}

function fixFile(filePath) {
  const rel = path.relative(HEALTH, filePath);
  const depth = rel.split(path.sep).length - 1;
  const up = depth === 0 ? '..' : '../'.repeat(depth + 1);
  let c = fs.readFileSync(filePath, 'utf8');

  for (const mod of PARENT_SERVICES) {
    c = c.replace(new RegExp(`require\\('\\.\\/${mod}`, 'g'), `require('${up}${mod}`);
  }
  c = c.replace(/require\('\.\/layer2-rag\//g, `require('${up}layer2-rag/`);
  c = c.replace(/require\('\.\/conversation-mode\//g, `require('${up}conversation-mode/`);

  if (rel.startsWith('agent' + path.sep)) {
    c = c.replace(/require\('\.\/agent\/prompt'/g, "require('./prompt'");
    c = c.replace(/require\('\.\/agent\/groq-tools'/g, "require('./groq-tools'");
    c = c.replace(/require\('\.\/model-router'/g, "require('../model-router'");
    c = c.replace(/require\('\.\/opqrst'/g, "require('../opqrst'");
    c = c.replace(/require\('\.\/session-service'/g, "require('../session-service'");
    c = c.replace(/require\('\.\/skin-router'/g, "require('../skin-router'");
    c = c.replace(/require\('\.\/tools\/registry'/g, "require('../tools/registry'");
  }

  if (rel.startsWith('tools' + path.sep)) {
    c = c.replace(/require\('\.\/session-service'/g, "require('../session-service'");
    c = c.replace(/require\('\.\/care-pathway'/g, "require('../care-pathway'");
    c = c.replace(/require\('\.\/visit-summary'/g, "require('../visit-summary'");
    c = c.replace(/require\('\.\/skin-router'/g, "require('../skin-router'");
    c = c.replace(/require\('\.\/education-retriever'/g, "require('../education-retriever'");
  }

  if (rel === 'agent' + path.sep + 'prompt.js') {
    c = c.replace(/require\('\.\/opqrst'/g, "require('../opqrst'");
  }

  if (rel === 'agent' + path.sep + 'groq-tools.js') {
    c = c.replace(/require\('\.\/tools\/registry'/g, "require('../tools/registry'");
  }

  fs.writeFileSync(filePath, c);
}

for (const f of walk(HEALTH)) fixFile(f);
console.log('fixed health import paths');
