#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

const MA_CONTRACT_RE = /^[A-Z]\d{4}$/;

function normalizeName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(v) {
  let s = normalizeName(v);
  s = s.replace(/\b(inc|llc|corp|corporation|l l c|ltd|co|company|pllc|pc|pa)\b/g, ' ');
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

function looksLikePlaceholder(existingValue) {
  const v = String(existingValue || '').trim();
  if (!v) return true;
  if (v.startsWith('payor_entity_norm_')) return true;
  if (v.startsWith('payor_entity_')) return true;
  if (/^\d{10}$/.test(v)) return true; // NPI-like, not MA contract id
  return false;
}

function addAliasRows(entityId, payerName, aliases, source, confidence, out) {
  const names = new Set([payerName, ...aliases].filter(Boolean));
  for (const n of names) {
    const norm = normalizeName(n);
    if (!norm) continue;
    out.push({
      id: `payor_alias_ma_bridge_${uuidv4()}`,
      entity_id: entityId,
      alias: n,
      alias_normalized: norm,
      source,
      confidence
    });
  }
}

function main() {
  const reviewPath = path.join(
    process.cwd(),
    'test-results/readiness-artifacts/payor-ma-bridge-cleaning-review.json'
  );

  const maPayers = db.db.prepare(`
    SELECT id, payer_id, payer_name, aliases
    FROM insurance_payers
    WHERE is_active = 1
      AND payer_id GLOB '[A-Z][0-9][0-9][0-9][0-9]'
    ORDER BY payer_name
  `).all();

  const canonical = db.db.prepare(`
    SELECT id, canonical_name, canonical_payer_id
    FROM payor_canonical_entities
  `).all();

  const aliasRowsAll = db.db.prepare(`
    SELECT a.entity_id, a.alias_normalized, e.canonical_payer_id
    FROM payor_entity_aliases a
    JOIN payor_canonical_entities e ON e.id = a.entity_id
  `).all();

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

  const outAliases = [];
  const review = [];
  let pass1Matched = 0;
  let pass2Matched = 0;
  let conflictResolved = 0;
  let conflictQueued = 0;
  let ambiguousSkipped = 0;

  function tryAssign(p, candidates, tag) {
    if (!candidates || !candidates.length) return { status: 'no_match' };
    const uniq = new Map();
    for (const c of candidates) uniq.set(c.id || c.entity_id, c);
    const rows = Array.from(uniq.values());
    if (rows.length !== 1) {
      ambiguousSkipped += 1;
      review.push({
        payer_id: p.payer_id,
        payer_name: p.payer_name,
        status: 'ambiguous',
        confidence_tag: tag,
        candidates: rows.slice(0, 5).map((r) => ({
          entity_id: r.id || r.entity_id,
          canonical_payer_id: r.canonical_payer_id || null
        }))
      });
      return { status: 'ambiguous' };
    }

    const target = rows[0];
    const entityId = target.id || target.entity_id;
    const existing = String(target.canonical_payer_id || '').trim();
    if (existing && existing !== p.payer_id) {
      if (looksLikePlaceholder(existing)) {
        db.db.prepare(`
          UPDATE payor_canonical_entities
          SET canonical_payer_id = ?, updated_at = ?
          WHERE id = ?
        `).run(p.payer_id, new Date().toISOString(), entityId);
        conflictResolved += 1;
        addAliasRows(entityId, p.payer_name, parseAliases(p.aliases), 'insurance_payers_bridge_conflict_resolved', 0.9, outAliases);
        return { status: 'conflict_resolved' };
      }
      conflictQueued += 1;
      review.push({
        payer_id: p.payer_id,
        payer_name: p.payer_name,
        status: 'conflict_queued',
        confidence_tag: 'conflict_queued',
        existing_canonical_payer_id: existing,
        target_entity_id: entityId
      });
      return { status: 'conflict_queued' };
    }

    db.db.prepare(`
      UPDATE payor_canonical_entities
      SET canonical_payer_id = ?, updated_at = ?
      WHERE id = ?
    `).run(p.payer_id, new Date().toISOString(), entityId);
    addAliasRows(entityId, p.payer_name, parseAliases(p.aliases), `insurance_payers_bridge_${tag}`, 0.95, outAliases);
    return { status: 'matched' };
  }

  for (const p of maPayers) {
    if (!MA_CONTRACT_RE.test(String(p.payer_id || '').trim())) continue;
    const key = cleanName(p.payer_name);
    if (!key) continue;

    // Pass 1: cleaned canonical_name exact.
    const r1 = tryAssign(p, exactMap.get(key) || [], 'exact_cleaned');
    if (r1.status === 'matched') {
      pass1Matched += 1;
      continue;
    }
    if (r1.status === 'conflict_resolved' || r1.status === 'conflict_queued') continue;

    // Pass 2: cleaned alias sweep.
    const r2 = tryAssign(p, aliasMap.get(key) || [], 'alias_hit');
    if (r2.status === 'matched') pass2Matched += 1;
  }

  db.upsertPayorEntityAliases(outAliases);

  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(reviewPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_rows: review.length,
    rows: review
  }, null, 2));

  const linked = db.db.prepare(`
    SELECT COUNT(*) AS c
    FROM insurance_payers p
    WHERE p.is_active = 1
      AND p.payer_id GLOB '[A-Z][0-9][0-9][0-9][0-9]'
      AND EXISTS (
        SELECT 1 FROM payor_canonical_entities e
        WHERE e.canonical_payer_id = p.payer_id
      )
  `).get().c;

  console.log(JSON.stringify({
    event: 'payor_bridge_ma_cleaning_pass_completed',
    insurance_payers_ma_total: maPayers.length,
    linked_after_pass: linked,
    pass1_exact_cleaned: pass1Matched,
    pass2_alias_hit: pass2Matched,
    conflict_resolved: conflictResolved,
    conflict_queued: conflictQueued,
    ambiguous_skipped: ambiguousSkipped,
    aliases_upserted: outAliases.length,
    review_file: reviewPath
  }, null, 2));
}

main();
