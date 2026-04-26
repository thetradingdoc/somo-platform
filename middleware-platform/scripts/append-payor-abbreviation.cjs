#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

const abbr = String(arg('abbr') || '').trim().toLowerCase();
const expanded = String(arg('expanded') || '').trim().toLowerCase();

if (!abbr || !expanded) {
  console.error('Usage: node scripts/append-payor-abbreviation.cjs --abbr=uhc --expanded=\"unitedhealthcare\"');
  process.exit(1);
}

db.bulkUpsertPayorAbbreviations([{ abbr, expanded_form: expanded, active: 1, source: 'manual_append' }]);
console.log(JSON.stringify({ event: 'payor_abbreviation_appended', abbr, expanded_form: expanded }, null, 2));

