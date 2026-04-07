#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('../database');

function parseArgs(argv) {
  const out = { file: null, source: 'obf', checkpoint: '.ingest-obf.checkpoint.json' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--source') out.source = argv[++i];
    else if (a === '--checkpoint') out.checkpoint = argv[++i];
  }
  return out;
}

function splitIngredients(inciText) {
  return String(inciText || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadCheckpoint(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) { return { line: 0 }; }
}

function saveCheckpoint(fp, cp) {
  try { fs.writeFileSync(fp, JSON.stringify(cp)); } catch (_) {}
}

async function run() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: node scripts/ingest-obf.js --file <obf.jsonl|obf.ndjson>');
    process.exit(1);
  }
  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const checkpointPath = path.resolve(process.cwd(), args.checkpoint);
  const cp = loadCheckpoint(checkpointPath);
  let lineNo = 0;
  let inserted = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    lineNo += 1;
    if (lineNo <= (cp.line || 0)) continue;
    if (!line || !line.trim()) continue;
    let obj = null;
    try { obj = JSON.parse(line); } catch (_) { continue; }
    const productName = String(obj.product_name || obj.product_name_en || '').trim();
    if (!productName) continue;
    const sourceId = String(obj._id || obj.id || '').trim() || `${lineNo}`;
    const brand = String(obj.brands || obj.brand || '').split(',')[0].trim();
    const inciText = String(obj.ingredients_text || obj.ingredients_text_en || '').trim();
    const normalizedName = productName.toLowerCase();

    const up = db.upsertProductCatalog({
      id: `obf:${sourceId}`,
      source: args.source,
      source_product_id: sourceId,
      brand,
      product_name: productName,
      normalized_name: normalizedName,
      inci_text: inciText,
      metadata: { categories: obj.categories || null }
    });
    if (!up?.success) continue;

    const ings = splitIngredients(inciText).map((ing, idx) => ({
      inci_name: ing.toLowerCase(),
      ingredient_order: idx,
      raw_ingredient: ing
    }));
    db.replaceProductIngredients(up.id, ings);
    inserted += 1;

    if (lineNo % 500 === 0) {
      saveCheckpoint(checkpointPath, { line: lineNo, inserted });
      console.log(`[ingest-obf] line=${lineNo} inserted=${inserted}`);
    }
  }

  saveCheckpoint(checkpointPath, { line: lineNo, inserted, done: true });
  console.log(`[ingest-obf] completed line=${lineNo} inserted=${inserted}`);
}

run().catch((e) => {
  console.error('[ingest-obf] fatal:', e);
  process.exit(1);
});
