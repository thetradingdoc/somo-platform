'use strict';

const path = require('path');
const { execSync } = require('child_process');

function seedPayerRules(cwd) {
  const mp = cwd || path.join(__dirname, '..', '..');
  try {
    execSync('node seeds/pilot-payer-rules.js', { cwd: mp, stdio: 'pipe', env: process.env });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { seedPayerRules };
