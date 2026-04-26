#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const { buildCanonicalEntities } = require('../services/payor-canonicalization-service');

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const policyVersion = getArg('policy-version', null);
const limit = Number(getArg('limit', '50000')) || 50000;
const offset = Number(getArg('offset', '0')) || 0;

const out = buildCanonicalEntities({ policyVersion, limit, offset });
const totals = db.db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM payor_canonical_entities) AS entities_total,
    (SELECT COUNT(*) FROM payor_entity_aliases) AS aliases_total,
    (SELECT COUNT(*) FROM payor_entity_links) AS links_total
`).get();

console.log(JSON.stringify({
  event: 'payor_resolution_decisions_promoted',
  promotion: out,
  totals
}, null, 2));
