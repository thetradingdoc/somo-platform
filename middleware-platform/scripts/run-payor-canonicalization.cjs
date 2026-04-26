#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const { buildCanonicalEntities, backfillFromInsurancePayers } = require('../services/payor-canonicalization-service');

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const policyVersion = getArg('policy-version', null);
const limit = Number(getArg('limit', '50000')) || 50000;
const offset = Number(getArg('offset', '0')) || 0;
const includeBridge = hasFlag('include-bridge');

const canonicalOut = buildCanonicalEntities({ policyVersion, limit, offset });
let bridgeOut = null;
if (includeBridge) {
  bridgeOut = backfillFromInsurancePayers({ limit: 5000 });
}

const totals = db.db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM payor_canonical_entities) AS entities_total,
    (SELECT COUNT(*) FROM payor_entity_aliases) AS aliases_total,
    (SELECT COUNT(*) FROM payor_entity_links) AS links_total
`).get();

const report = {
  generated_at: new Date().toISOString(),
  event: 'payor_canonicalization_run_completed',
  canonicalization: canonicalOut,
  bridge_backfill: bridgeOut,
  totals
};

const outPath = path.join(process.cwd(), 'test-results/readiness-artifacts/payor-canonicalization-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Canonicalization report written: ${outPath}`);
console.log(JSON.stringify(report, null, 2));

