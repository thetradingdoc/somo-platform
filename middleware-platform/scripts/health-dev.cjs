#!/usr/bin/env node
'use strict';

/**
 * Health MVP dev — same as npm start with LOCAL_DEV_ROOT=health.
 * Single process; browser STT in health-video.html (no Python agent).
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

require('dotenv').config({ path: path.join(root, '.env') });

const env = {
  ...process.env,
  LOCAL_DEV_ROOT: process.env.LOCAL_DEV_ROOT || 'health'
};

console.log('[health:dev] Starting middleware (LOCAL_DEV_ROOT=health) — http://localhost:4000/health-video.html');

const child = spawn('npm', ['start'], {
  cwd: root,
  stdio: 'inherit',
  env
});

child.on('exit', (code) => process.exit(code ?? 0));
