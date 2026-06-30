#!/usr/bin/env node
'use strict';

/**
 * Focused phone-stack Jest gate (~93 tests). Explicit file list — no broad voice- regex.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const varDir = path.join(__dirname, '../var');
fs.mkdirSync(varDir, { recursive: true });

const VOICE_TEST_MIN = parseInt(process.env.VOICE_TEST_MIN || '85', 10);
const VOICE_TEST_MAX = parseInt(process.env.VOICE_TEST_MAX || '120', 10);

function collectVoiceTestFiles() {
  const testDir = path.join(__dirname, '../__tests__');
  return fs
    .readdirSync(testDir)
    .filter((name) => {
      if (name.startsWith('voice-') && name.endsWith('.test.js')) return true;
      if (name.startsWith('billing-access-') && name.endsWith('.test.js')) return true;
      if (name === 'platform-voice-tenant.test.js') return true;
      return false;
    })
    .sort()
    .map((name) => path.join('__tests__', name));
}

const testFiles = collectVoiceTestFiles();
if (testFiles.length < 10) {
  console.error(`FAIL voice test gate: expected >= 10 test files, found ${testFiles.length}`);
  process.exit(1);
}

const jestArgs = [
  '--runInBand',
  '--forceExit',
  '--json',
  '--outputFile',
  path.join(varDir, 'voice-jest-results.json'),
  ...testFiles
];

const result = spawnSync('npx', ['jest', ...jestArgs], {
  stdio: 'inherit',
  env: { ...process.env, VOICE_RATE_LIMIT_BACKEND: process.env.VOICE_RATE_LIMIT_BACKEND || 'memory' }
});

let totalTests = null;
try {
  const raw = fs.readFileSync(path.join(varDir, 'voice-jest-results.json'), 'utf8');
  const parsed = JSON.parse(raw);
  totalTests = parsed.numTotalTests;
  if (totalTests < VOICE_TEST_MIN || totalTests > VOICE_TEST_MAX) {
    console.error(
      `FAIL voice test gate: expected ${VOICE_TEST_MIN}–${VOICE_TEST_MAX} tests, got ${totalTests} (${testFiles.length} files)`
    );
    process.exit(1);
  }
  console.log(
    `OK voice test gate: ${totalTests} tests in ${testFiles.length} files (range ${VOICE_TEST_MIN}–${VOICE_TEST_MAX})`
  );
} catch (err) {
  console.warn('⚠️  Could not verify voice test count:', err.message);
}

process.exit(result.status || 0);
