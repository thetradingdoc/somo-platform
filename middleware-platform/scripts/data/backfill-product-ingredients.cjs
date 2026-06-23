#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../database');
const { resolveInciTextToRows } = require('../../services/clinical/inci-resolve');

const args = process.argv.slice(2);
const batchSize = Math.max(50, Number(args.find((a) => a.startsWith('--batch='))?.split('=')[1] || 200));
const checkpointFile = args.find((a) => a.startsWith('--checkpoint='))?.split('=')[1]
  || path.join(__dirname, '.backfill-product-ingredients-checkpoint.json');
const catalogFilter = (args.find((a) => a.startsWith('--catalog='))?.split('=')[1] || 'all').toLowerCase();
const crypto = require('crypto');

function loadCheckpoint() {
  try {
    return JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  } catch (_) {
    return { obfOffset: 0, offOffset: 0 };
  }
}

function saveCheckpoint(cp) {
  fs.writeFileSync(checkpointFile, JSON.stringify(cp, null, 2));
}

function parseJsonArray(v) {
  try {
    const parsed = JSON.parse(v || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function upsertUnresolved(token, barcode) {
  if (!token) return;
  const key = String(token).trim().toLowerCase();
  if (!key) return;
  const row = db.db.prepare(`
    SELECT raw_token, occurrence_count, sample_barcodes_json
    FROM ingredient_unresolved_queue
    WHERE raw_token = ?
  `).get(key);
  if (!row) {
    db.db.prepare(`
      INSERT INTO ingredient_unresolved_queue (
        raw_token, occurrence_count, sample_barcodes_json, first_seen_at, last_seen_at, status
      ) VALUES (?, 1, ?, datetime('now'), datetime('now'), 'pending')
    `).run(key, JSON.stringify(barcode ? [barcode] : []));
    return;
  }
  const samples = parseJsonArray(row.sample_barcodes_json);
  if (barcode && !samples.includes(barcode) && samples.length < 5) samples.push(barcode);
  db.db.prepare(`
    UPDATE ingredient_unresolved_queue
    SET occurrence_count = COALESCE(occurrence_count, 0) + 1,
        sample_barcodes_json = ?,
        last_seen_at = datetime('now')
    WHERE raw_token = ?
  `).run(JSON.stringify(samples), key);
}

function processRows(rows, catalog) {
  let parsedIngredients = 0;
  let resolvedIngredients = 0;
  let skippedIdempotent = 0;
  for (const row of rows) {
    const code = String(row.code || '').trim();
    const text = String(row.ingredients_text || '').trim();
    if (!code || !text) continue;
    const productId = `${catalog}:${code}`;
    const textHash = crypto.createHash('sha256').update(text).digest('hex');
    const seen = db.db.prepare(`
      SELECT 1 FROM enrichment_backfill_applied
      WHERE product_id = ? AND text_hash = ?
      LIMIT 1
    `).get(productId, textHash);
    if (seen) {
      skippedIdempotent += 1;
      db.incrementOpsCounter('enrichment_backfill.idempotent_skip');
      continue;
    }
    const resolved = resolveInciTextToRows(text, {
      getCosingIngredientByInci: db.getCosingIngredientByInci,
      getAliasCanonical: db.getIngredientAliasCanonical,
      cosingCandidates: (
        (typeof db.getCosingInciCandidatesNormalized === 'function' && db.getCosingInciCandidatesNormalized())
        || (typeof db.getCosingInciCandidates === 'function' && db.getCosingInciCandidates())
        || []
      )
    });
    parsedIngredients += resolved.length;
    resolvedIngredients += resolved.filter((r) => String(r.match_method || '') !== 'unresolved').length;
    db.replaceProductIngredients(productId, resolved.map((r) => ({
      ...r,
      enrichment_version: 'phase2-v1',
      safety_flags_json: JSON.stringify([])
    })));
    for (const ing of resolved) {
      if (String(ing.match_method || '') === 'unresolved') upsertUnresolved(ing.normalized_inci || ing.raw_ingredient, code);
    }
    db.db.prepare(`
      INSERT OR IGNORE INTO enrichment_backfill_applied (
        id, product_id, catalog, code, text_hash, applied_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      `enrich_backfill:${productId}:${textHash.slice(0, 12)}`,
      productId,
      catalog,
      code,
      textHash
    );
    db.incrementOpsCounter('enrichment_backfill.row_applied');
  }
  return { parsedIngredients, resolvedIngredients, skippedIdempotent };
}

function run() {
  const startedAt = Date.now();
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS enrichment_backfill_applied (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      catalog TEXT NOT NULL,
      code TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, text_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_enrichment_backfill_applied_code
      ON enrichment_backfill_applied(catalog, code, applied_at DESC);
  `);
  const cp = loadCheckpoint();
  const out = { products: 0, parsedIngredients: 0, resolvedIngredients: 0, skippedIdempotent: 0 };

  if (catalogFilter === 'all' || catalogFilter === 'obf') {
    const obfRows = db.db.prepare(`
      SELECT code, ingredients_text
      FROM products_obf_index
      ORDER BY code ASC
      LIMIT ? OFFSET ?
    `).all(batchSize, Number(cp.obfOffset || 0));
    const stat = processRows(obfRows, 'obf');
    out.products += obfRows.length;
    out.parsedIngredients += stat.parsedIngredients;
    out.resolvedIngredients += stat.resolvedIngredients;
    out.skippedIdempotent += stat.skippedIdempotent;
    cp.obfOffset = Number(cp.obfOffset || 0) + obfRows.length;
  }

  if (catalogFilter === 'all' || catalogFilter === 'off') {
    const offRows = db.db.prepare(`
      SELECT code, ingredients_text
      FROM products_off_index
      ORDER BY code ASC
      LIMIT ? OFFSET ?
    `).all(batchSize, Number(cp.offOffset || 0));
    const stat = processRows(offRows, 'off');
    out.products += offRows.length;
    out.parsedIngredients += stat.parsedIngredients;
    out.resolvedIngredients += stat.resolvedIngredients;
    out.skippedIdempotent += stat.skippedIdempotent;
    cp.offOffset = Number(cp.offOffset || 0) + offRows.length;
  }

  saveCheckpoint(cp);
  const resolutionRate = out.parsedIngredients
    ? Math.round((out.resolvedIngredients / out.parsedIngredients) * 10000) / 100
    : 0;
  const elapsedMs = Date.now() - startedAt;
  db.incrementOpsCounter('enrichment_backfill.run');
  db.incrementOpsCounter(elapsedMs > 60000 ? 'enrichment_backfill.latency_over_60s' : 'enrichment_backfill.latency_under_60s');
  db.incrementOpsCounter(resolutionRate < 60 ? 'enrichment_backfill.coverage_below_60_pct' : 'enrichment_backfill.coverage_above_60_pct');
  console.log(JSON.stringify({
    success: true,
    batch_size: batchSize,
    checkpoint_file: checkpointFile,
    next_offsets: cp,
    products_processed: out.products,
    products_skipped_idempotent: out.skippedIdempotent,
    ingredients_parsed: out.parsedIngredients,
    ingredients_resolved: out.resolvedIngredients,
    resolution_rate_pct: resolutionRate,
    elapsed_ms: elapsedMs
  }, null, 2));
}

run();
