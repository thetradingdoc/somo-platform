#!/usr/bin/env node
'use strict';

/**
 * Phase 1 F3 — live call checklist + optional verify-live-call runner.
 * Usage:
 *   node scripts/phase1-live-call-runner.cjs                    # print checklist
 *   node scripts/phase1-live-call-runner.cjs --session_id=ID   # verify after call
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mp = path.join(__dirname, '..');
const evidenceDir = path.join(mp, 'var', 'evidence', 'phase1');
fs.mkdirSync(evidenceDir, { recursive: true });

const sessionId = (process.argv.find((a) => a.startsWith('--session_id=')) || '').split('=')[1];

const CHECKLIST = `# Phase 1 Live Call Checklist

Place three live front-desk calls (no harness seeds):

1. **copay_due** — stomach pain, BCBS_PILOT plan_x → hard_number $35, book, pay
2. **fully_covered** — stomach pain, BCBS_PILOT plan_y → hard_number $0, book
3. **cannot_determine** — stomach pain, unknown_plan → quote blocked, no booking

After each call:
\`\`\`bash
cd middleware-platform
node scripts/verify-live-call.cjs --session_id=<SESSION_ID> --json | tee var/evidence/phase1/live_<scenario>.json
\`\`\`

Repeat call #1 for repeatability DoD.
`;

fs.writeFileSync(path.join(evidenceDir, 'LIVE_CALL_CHECKLIST.md'), CHECKLIST);

if (!sessionId) {
  console.log(CHECKLIST);
  console.log('\nProvide --session_id=<ID> after a live call to run verify-live-call.cjs');
  process.exit(0);
}

try {
  const out = execSync(`node scripts/verify-live-call.cjs --session_id=${sessionId} --json`, {
    cwd: mp,
    encoding: 'utf8',
    env: { ...process.env, DB_PATH: './var/db/middleware-dev.db' }
  });
  const logPath = path.join(evidenceDir, `live_verify_${sessionId}.json`);
  fs.writeFileSync(logPath, out);
  console.log(out);
  const parsed = JSON.parse(out);
  process.exit(parsed.success ? 0 : 2);
} catch (e) {
  console.error(e.stdout || e.message);
  process.exit(2);
}
