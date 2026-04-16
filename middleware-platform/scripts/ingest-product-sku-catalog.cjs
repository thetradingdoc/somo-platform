#!/usr/bin/env node
'use strict';

/**
 * B2 — Bulk upsert into product_sku_catalog (TSV/CSV).
 *
 * Usage:
 *   node scripts/ingest-product-sku-catalog.cjs --db ./data.db --file ./skus.tsv
 *
 * Header row (required columns): sku,product_id
 * Optional: gtin,brand,display_name,formulation_tags (JSON array string)
 *
 * For very large files, stdin is supported:
 *   zcat skus.tsv.gz | node scripts/ingest-product-sku-catalog.cjs --db ./data.db --stdin
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

const { up: m034 } = require('../migrations/034_product_sku_catalog');
const { createProductSkuCatalog } = require('../services/product-sku-catalog');

function parseArgs() {
  const out = { db: null, file: null, stdin: false, batch: 500 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) out.db = argv[++i];
    else if (argv[i] === '--file' && argv[i + 1]) out.file = argv[++i];
    else if (argv[i] === '--stdin') out.stdin = true;
    else if (argv[i] === '--batch' && argv[i + 1]) out.batch = Math.max(1, parseInt(argv[++i], 10) || 500);
  }
  return out;
}

function splitLine(line, delim) {
  if (delim === '\t') return line.split('\t').map((c) => c.trim());
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && ch === delim) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseRow(headers, cells) {
  const o = {};
  headers.forEach((h, j) => {
    o[h] = cells[j] != null ? cells[j] : '';
  });
  if (!o.sku || !o.product_id) return null;
  let formulation_tags = o.formulation_tags || '[]';
  if (formulation_tags && !formulation_tags.startsWith('[')) {
    formulation_tags = JSON.stringify(
      formulation_tags.split(/[,|]/).map((s) => s.trim()).filter(Boolean)
    );
  }
  return {
    sku: o.sku,
    product_id: o.product_id,
    gtin: o.gtin || null,
    brand: o.brand || null,
    display_name: o.display_name || null,
    formulation_tags,
    source: o.source || 'ingest-product-sku-catalog',
  };
}

async function main() {
  const args = parseArgs();
  if (!args.db || (!args.file && !args.stdin)) {
    console.error(
      'Usage: node scripts/ingest-product-sku-catalog.cjs --db <sqlite> (--file <path> | --stdin)',
    );
    process.exit(1);
  }

  const db = new Database(args.db);
  m034(db);
  const catalog = createProductSkuCatalog(db);

  const input = args.stdin ? process.stdin : fs.createReadStream(path.resolve(args.file));
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let lineNo = 0;
  let headers = null;
  let delim = '\t';
  const batch = [];
  let total = 0;

  const flush = () => {
    if (!batch.length) return;
    catalog.upsertBatch(batch.splice(0, batch.length));
  };

  for await (const line of rl) {
    lineNo++;
    if (!line.trim()) continue;
    if (!headers) {
      delim = line.includes('\t') ? '\t' : ',';
      headers = splitLine(line, delim).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
      if (!headers.includes('sku') || !headers.includes('product_id')) {
        console.error('Header must include sku and product_id');
        process.exit(1);
      }
      continue;
    }
    const cells = splitLine(line, delim);
    const row = parseRow(headers, cells);
    if (!row) continue;
    batch.push(row);
    total++;
    if (batch.length >= args.batch) flush();
  }
  flush();

  console.log(`ingest-product-sku-catalog: upserted ${total} rows`);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
