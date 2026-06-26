#!/usr/bin/env node
'use strict';

/**
 * CI guard: warn when database.js or server.js grow via forbidden patterns.
 */
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const violations = [];

function gitDiff(file) {
  try {
    return execSync(`git diff --cached -- "${file}" 2>/dev/null || git diff -- "${file}"`, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024
    });
  } catch (_) {
    return '';
  }
}

const dbDiff = gitDiff('middleware-platform/database.js');
if (dbDiff && /CREATE TABLE/i.test(dbDiff) && !/migrations\//.test(dbDiff)) {
  violations.push('database.js diff adds CREATE TABLE — use migrations/ + database/repos/');
}

const serverDiff = gitDiff('middleware-platform/server.js');
if (serverDiff) {
  const addedHandlers = (serverDiff.match(/^\+.*app\.(get|post|put|delete|patch)\(/gm) || []).length;
  if (addedHandlers > 2) {
    violations.push(`server.js diff adds ${addedHandlers} inline handlers — prefer routes/*.js`);
  }
}

if (violations.length) {
  console.warn('check-monolith-growth: warnings\n');
  violations.forEach((v) => console.warn(`  - ${v}`));
  if (process.env.MONOLITH_GROWTH_STRICT === '1') process.exit(1);
}

console.log('check-monolith-growth: OK');
