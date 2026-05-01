#!/usr/bin/env node
/**
 * One-off: set covered=1 on payor_plan_benefits for benefit_category=b16_dental when the
 * CMS PBP row says the plan offers dental (pbp_a_ben_cov=1) and orgtype is not PACE (08).
 *
 * Fixes dental need returning 0 plans after ingests that lacked per-section *_bendesc_yn on pbp_b16_dental.txt.
 *
 * Usage:
 *   POSTGRES_URL=... node scripts/backfill-b16-dental-covered.cjs --zip=/path/to/pbp-benefits-2026.zip
 *   POSTGRES_URL=... node scripts/backfill-b16-dental-covered.cjs --file=/path/to/pbp_b16_dental.txt
 *
 * Dry run: add --dry-run (parses file and prints counts only)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createPool } = require('../utils/postgres');

function readTsv(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split('\t').map((h) => String(h || '').trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const obj = {};
    for (let i = 0; i < headers.length; i += 1) obj[headers[i]] = cells[i] ?? '';
    return obj;
  });
  return { headers, rows };
}

function loadDentalRows() {
  const zipArg = (process.argv.find((a) => a.startsWith('--zip=')) || '').replace('--zip=', '');
  const fileArg = (process.argv.find((a) => a.startsWith('--file=')) || '').replace('--file=', '');
  const zipPath = zipArg || process.env.PBP_BENEFITS_ZIP || '';
  const filePath = fileArg || process.env.PBP_B16_DENTAL_TXT || '';
  let raw;
  if (zipPath) {
    const zp = path.resolve(zipPath);
    if (!fs.existsSync(zp)) throw new Error(`Zip not found: ${zp}`);
    raw = execFileSync('unzip', ['-p', zp, 'pbp_b16_dental.txt'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } else if (filePath) {
    const fp = path.resolve(filePath);
    if (!fs.existsSync(fp)) throw new Error(`File not found: ${fp}`);
    raw = fs.readFileSync(fp, 'utf8');
  } else {
    throw new Error('Provide --zip=.../pbp-benefits-2026.zip or --file=.../pbp_b16_dental.txt (or PBP_BENEFITS_ZIP / PBP_B16_DENTAL_TXT)');
  }
  return readTsv(raw).rows;
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const rows = loadDentalRows();
  const keys = new Map();
  for (const row of rows) {
    const contract = String(row.pbp_a_hnumber || '').trim();
    const planId = String(row.pbp_a_plan_identifier || '').trim();
    const segment = String(row.segment_id || '').trim();
    const org = String(row.orgtype || '').trim();
    const benCov = String(row.pbp_a_ben_cov || '').trim();
    if (!contract || !planId) continue;
    if (org === '08') continue;
    if (benCov !== '1') continue;
    keys.set(`${contract}|${planId}|${segment}`, { contract, planId, segment });
  }
  const list = Array.from(keys.values());
  console.log(JSON.stringify({ dry, uniquePlansWithDentalBenCov: list.length, tsvDataRows: rows.length }, null, 2));

  if (dry) {
    console.log('Dry run: no updates applied.');
    return;
  }

  if (!process.env.POSTGRES_URL) {
    console.error('POSTGRES_URL is required when not using --dry-run');
    process.exit(1);
  }
  const sql = createPool();

  let updated = 0;
  let n = 0;
  for (const k of list) {
    n += 1;
    if (n % 5000 === 0) console.error(`progress ${n}/${list.length}`);
    const out = await sql.unsafe(
      `UPDATE payor_plan_benefits
          SET covered = 1,
              covered_source = 'plan_level_ben_cov_b16_backfill'
        WHERE benefit_category = 'b16_dental'
          AND contract_id = $1
          AND plan_id = $2
          AND COALESCE(segment_id, '') = COALESCE($3, '')
          AND covered = 0
          AND covered_source = 'bendesc_yn_blank_non_pace'
        RETURNING contract_id`,
      [k.contract, k.planId, k.segment]
    );
    updated += Array.isArray(out) ? out.length : 0;
  }
  console.log(JSON.stringify({ updateStatements: list.length, rowsUpdated: updated }, null, 2));
  await sql.end({ timeout: 30 }).catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
