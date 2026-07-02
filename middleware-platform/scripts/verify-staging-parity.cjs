#!/usr/bin/env node
'use strict';

/**
 * Compare local/staging Kelly flag env vars against front-desk deploy checklist in docs.
 * Usage: node scripts/verify-staging-parity.cjs
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

/** SSOT: docs/deployment/FRONT_DESK_DEPLOY_CHECKLIST.md + OPERATIONS.md Kelly rails gates */
const REQUIRED = [
  { key: 'KELLY_RAILS_V2', type: 'truthy' },
  { key: 'KELLY_ALLOW_HYBRID_GRAPH', type: 'falsy_or_unset' },
  { key: 'KELLY_RAILS_ROLLOUT_PCT', type: 'min', min: 1 },
  { key: 'CONVERSATION_MODE_ROUTING', type: 'equals', value: 'enforce' }
];

const OPTIONAL_DOC_KEYS = ['OPQRST_FIELD_GATE_ENABLED', 'RETELL_LLM_WEBSOCKET_URL', 'BASE_URL'];

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}

function main() {
  console.log('\n=== Staging Kelly env parity (vs deploy checklist) ===\n');

  const checklistPath = path.join(REPO_ROOT, 'docs/deployment/FRONT_DESK_DEPLOY_CHECKLIST.md');
  const opsPath = path.join(REPO_ROOT, 'docs/deployment/OPERATIONS.md');
  let pass = true;

  if (!fs.existsSync(checklistPath)) {
    pass = check('FRONT_DESK_DEPLOY_CHECKLIST.md exists', false, checklistPath) && pass;
  } else {
    const body = fs.readFileSync(checklistPath, 'utf8');
    const missing = REQUIRED.filter((r) => !body.includes(r.key)).map((r) => r.key);
    pass = check(
      'deploy checklist documents Kelly flags',
      missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : undefined
    ) && pass;
  }

  if (fs.existsSync(opsPath)) {
    const ops = fs.readFileSync(opsPath, 'utf8');
    pass = check('OPERATIONS.md references KELLY_RAILS_V2', ops.includes('KELLY_RAILS_V2')) && pass;
  }

  console.log('\n--- Local / staging env ---\n');
  const snapshot = {};
  for (const rule of REQUIRED) {
    const raw = process.env[rule.key];
    snapshot[rule.key] = raw ?? '(unset)';

    if (rule.type === 'truthy') {
      pass = check(`${rule.key}=1`, truthy(raw), `current=${raw ?? '(unset)'}`) && pass;
      continue;
    }
    if (rule.type === 'falsy_or_unset') {
      pass = check(
        `${rule.key} off or unset`,
        raw === undefined || raw === '' || !truthy(raw),
        `current=${raw ?? '(unset)'}`
      ) && pass;
      continue;
    }
    if (rule.type === 'min') {
      const n = raw === undefined || raw === '' ? 1 : parseFloat(raw);
      pass = check(
        `${rule.key}>=${rule.min}`,
        Number.isFinite(n) && n >= rule.min,
        `current=${raw ?? '(unset)'}`
      ) && pass;
      continue;
    }
    if (rule.type === 'equals') {
      const val = String(raw ?? '').trim().toLowerCase();
      pass = check(`${rule.key}=${rule.value}`, val === rule.value, `current=${val || '(unset)'}`) && pass;
    }
  }

  for (const k of OPTIONAL_DOC_KEYS) {
    if (process.env[k]) snapshot[k] = process.env[k];
  }

  console.log('\n' + JSON.stringify({ pass, env: snapshot }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
