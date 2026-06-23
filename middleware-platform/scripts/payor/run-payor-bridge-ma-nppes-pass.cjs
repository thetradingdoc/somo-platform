#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

const MA_CONTRACT_RE = /^[A-Z]\d{4}$/;
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const DB_PATH = process.env.DB_PATH || path.join(process.env.HOME || '', 'payor-db', 'payor-prod.db');
const MA_CSV = process.env.MA_CSV;
const REVIEW_PATH = path.join(
  process.cwd(),
  'test-results/readiness-artifacts/payor-ma-bridge-nppes-review.json'
);

if (!DB_PATH || !fs.existsSync(DB_PATH)) {
  console.error(JSON.stringify({ event: 'error', reason: 'db_not_found', db_path: DB_PATH }, null, 2));
  process.exit(1);
}
if (!MA_CSV || !fs.existsSync(MA_CSV)) {
  console.error(JSON.stringify({ event: 'error', reason: 'ma_csv_not_found', ma_csv: MA_CSV }, null, 2));
  process.exit(1);
}

function normalizeName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(v) {
  let s = normalizeName(v);
  s = s.replace(/\b(inc|llc|corp|corporation|l l c|ltd|co|company|pllc|pc|pa|lp|llp)\b/g, ' ');
  s = s.replace(/\b(health plan|insurance|of america)\b/g, ' ');
  s = s.replace(/\bof\s+[a-z]+\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function parseAliases(v) {
  try {
    const arr = JSON.parse(v || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
  } catch (_) {
    return [];
  }
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function indexOfHeader(headers, name) {
  const idx = headers.findIndex((h) => String(h || '').toLowerCase() === name.toLowerCase());
  if (idx === -1) throw new Error(`Missing required MA CSV header: ${name}`);
  return idx;
}

function loadMaByContract(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim());
  const iContract = indexOfHeader(headers, 'Contract Number');
  const iLegal = indexOfHeader(headers, 'Legal Entity Name');
  const iMarketing = indexOfHeader(headers, 'Organization Marketing Name');
  const iState = indexOfHeader(headers, 'Legal Entity State Code');

  const byContract = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const c = parseCsvLine(lines[i]);
    const contract = String(c[iContract] || '').trim().toUpperCase();
    const legal = String(c[iLegal] || '').trim();
    const marketing = String(c[iMarketing] || '').trim();
    const state = String(c[iState] || '').trim().toUpperCase();
    if (!MA_CONTRACT_RE.test(contract) || !/^[A-Z]{2}$/.test(state)) continue;
    byContract.set(contract, { contract, legal, marketing, state });
  }
  return byContract;
}

function main() {
  const maByContract = loadMaByContract(MA_CSV);
  const db = new Database(DB_PATH, { fileMustExist: true });
  db.pragma('busy_timeout = 30000');

  const maPayers = db.prepare(`
    SELECT id, payer_id, payer_name, aliases
    FROM insurance_payers
    WHERE is_active = 1
      AND payer_id GLOB '[A-Z][0-9][0-9][0-9][0-9]'
    ORDER BY payer_name
  `).all();

  const canonical = db.prepare(`
    SELECT id, canonical_name, canonical_payer_id
    FROM payor_canonical_entities
  `).all();

  const aliasRowsAll = db.prepare(`
    SELECT a.entity_id, a.alias_normalized, e.canonical_payer_id
    FROM payor_entity_aliases a
    JOIN payor_canonical_entities e ON e.id = a.entity_id
  `).all();

  const nppesCandidatesStmt = db.prepare(`
    SELECT DISTINCT
      e.id AS entity_id,
      e.canonical_payer_id AS canonical_payer_id
    FROM payor_normalized_records n
    JOIN payor_source_records s ON s.id = n.source_record_id
    JOIN payor_entity_links l ON l.source_record_id = s.id
    JOIN payor_canonical_entities e ON e.id = l.entity_id
    WHERE n.source = 'nppes_bulk'
      AND n.normalized_name = ?
      AND s.raw_npi IS NOT NULL AND TRIM(s.raw_npi) <> ''
      AND UPPER(COALESCE(NULLIF(TRIM(s.raw_state_hint), ''), n.stripped_state, '')) = ?
  `);

  const entityByPayerIdStmt = db.prepare(`
    SELECT id FROM payor_canonical_entities WHERE canonical_payer_id = ? LIMIT 1
  `);
  const updateEntityPayerIdStmt = db.prepare(`
    UPDATE payor_canonical_entities
    SET canonical_payer_id = ?, updated_at = ?
    WHERE id = ?
  `);
  const insertAliasStmt = db.prepare(`
    INSERT OR IGNORE INTO payor_entity_aliases
      (id, entity_id, alias, alias_normalized, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const exactMap = new Map();
  for (const e of canonical) {
    const k = cleanName(e.canonical_name);
    if (!k) continue;
    if (!exactMap.has(k)) exactMap.set(k, []);
    exactMap.get(k).push(e);
  }

  const aliasMap = new Map();
  for (const a of aliasRowsAll) {
    const k = cleanName(a.alias_normalized);
    if (!k) continue;
    if (!aliasMap.has(k)) aliasMap.set(k, []);
    aliasMap.get(k).push(a);
  }

  const nowIso = new Date().toISOString();
  const writeLink = db.transaction((entityId, contract, namesForAlias) => {
    updateEntityPayerIdStmt.run(contract, nowIso, entityId);
    for (const n of namesForAlias) {
      const aliasNorm = normalizeName(n);
      if (!aliasNorm) continue;
      insertAliasStmt.run(
        `payor_alias_ma_nppes_${uuidv4()}`,
        entityId,
        n,
        aliasNorm,
        'insurance_payers_bridge_nppes',
        0.96,
        nowIso
      );
    }
  });

  const stats = {
    insurance_payers_ma_total: maPayers.length,
    already_linked: 0,
    pass1_nppes: 0,
    pass2_exact_cleaned: 0,
    pass3_alias_hit: 0,
    ambiguous_pass1: 0,
    ambiguous_pass2: 0,
    ambiguous_pass3: 0,
    conflict_queued: 0,
    unmatched: 0,
    aliases_upserted: 0,
    dry_run: DRY_RUN
  };
  const review = [];

  function doAssign(p, entity, namesForAlias, tag) {
    const existing = String(entity.canonical_payer_id || '').trim();
    if (existing && existing !== p.payer_id) {
      stats.conflict_queued += 1;
      review.push({
        payer_id: p.payer_id,
        payer_name: p.payer_name,
        status: 'conflict_queued',
        pass: tag,
        target_entity_id: entity.entity_id || entity.id,
        existing_canonical_payer_id: existing
      });
      return false;
    }
    if (!DRY_RUN) writeLink(entity.entity_id || entity.id, p.payer_id, namesForAlias);
    stats.aliases_upserted += namesForAlias.length;
    return true;
  }

  for (const p of maPayers) {
    const payerId = String(p.payer_id || '').trim().toUpperCase();
    if (!MA_CONTRACT_RE.test(payerId)) continue;

    if (entityByPayerIdStmt.get(payerId)) {
      stats.already_linked += 1;
      continue;
    }

    const ma = maByContract.get(payerId) || null;
    const names = new Set([
      ma?.legal || '',
      ma?.marketing || '',
      p.payer_name || '',
      ...parseAliases(p.aliases)
    ].filter(Boolean));
    const cleanedNames = Array.from(new Set(Array.from(names).map(cleanName).filter(Boolean)));
    const state = String(ma?.state || '').toUpperCase();

    let linked = false;

    if (state) {
      for (const n of cleanedNames) {
        const candidates = nppesCandidatesStmt.all(n, state);
        const uniq = Array.from(new Map(candidates.map((c) => [c.entity_id, c])).values());
        if (uniq.length === 1) {
          if (doAssign(p, uniq[0], Array.from(names), 'pass1_nppes')) {
            stats.pass1_nppes += 1;
            linked = true;
          }
          break;
        }
        if (uniq.length > 1) {
          stats.ambiguous_pass1 += 1;
          if (VERBOSE) {
            console.log(`[ambiguous:pass1] ${payerId} ${p.payer_name} candidates=${uniq.length} name=${n} state=${state}`);
          }
        }
      }
    }
    if (linked) continue;

    for (const n of cleanedNames) {
      const rows = Array.from(new Map((exactMap.get(n) || []).map((r) => [r.id, r])).values());
      if (rows.length === 1) {
        if (doAssign(p, rows[0], Array.from(names), 'pass2_exact_cleaned')) {
          stats.pass2_exact_cleaned += 1;
          linked = true;
        }
        break;
      }
      if (rows.length > 1) stats.ambiguous_pass2 += 1;
    }
    if (linked) continue;

    for (const n of cleanedNames) {
      const rows = Array.from(new Map((aliasMap.get(n) || []).map((r) => [r.entity_id, r])).values());
      if (rows.length === 1) {
        if (doAssign(p, rows[0], Array.from(names), 'pass3_alias_hit')) {
          stats.pass3_alias_hit += 1;
          linked = true;
        }
        break;
      }
      if (rows.length > 1) stats.ambiguous_pass3 += 1;
    }

    if (!linked) {
      stats.unmatched += 1;
      review.push({
        payer_id: p.payer_id,
        payer_name: p.payer_name,
        status: 'unmatched',
        state: state || null
      });
    }
  }

  const linkedAfterPass = db.prepare(`
    SELECT COUNT(*) AS c
    FROM insurance_payers p
    WHERE p.is_active = 1
      AND p.payer_id GLOB '[A-Z][0-9][0-9][0-9][0-9]'
      AND EXISTS (
        SELECT 1 FROM payor_canonical_entities e
        WHERE e.canonical_payer_id = p.payer_id
      )
  `).get().c;

  const summary = {
    event: 'payor_bridge_ma_nppes_pass_completed',
    ...stats,
    linked_after_pass: linkedAfterPass,
    cumulative_coverage_pct: Number(((linkedAfterPass / Math.max(stats.insurance_payers_ma_total, 1)) * 100).toFixed(2)),
    review_file: REVIEW_PATH
  };

  fs.mkdirSync(path.dirname(REVIEW_PATH), { recursive: true });
  fs.writeFileSync(REVIEW_PATH, JSON.stringify({ generated_at: new Date().toISOString(), total_rows: review.length, rows: review }, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  db.close();
}

main();
