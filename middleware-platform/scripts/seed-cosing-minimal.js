#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../database').db;

function run() {
  const p = path.join(__dirname, '../taxonomy/cosing-seed-minimal.v1.json');
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  const stmt = db.prepare(`
    INSERT INTO cosing_ingredients (inci_name, cas_number, ec_number, functions_json, restrictions_json, metadata_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(inci_name) DO UPDATE SET
      cas_number=excluded.cas_number,
      ec_number=excluded.ec_number,
      functions_json=excluded.functions_json,
      restrictions_json=excluded.restrictions_json,
      metadata_json=excluded.metadata_json,
      updated_at=CURRENT_TIMESTAMP
  `);
  for (const r of rows) {
    stmt.run(
      String(r.inci_name || '').trim(),
      r.cas_number || null,
      r.ec_number || null,
      r.functions_json || '[]',
      r.restrictions_json || '[]',
      r.metadata_json || '{}'
    );
  }
  console.log(`cosing seed: upserted ${rows.length} rows`);
}

run();
