#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createGunzip } = require('zlib');
const { parse } = require('csv-parse');
const { resolveCategoryRoute } = require('../services/category-route-resolver');

const DEFAULT_GCS_OBF =
  process.env.OBF_GCS_BASELINE_URI ||
  'gs://skinandcare-media-staging/obf/raw/full/en.openbeautyfacts.org.products.csv.gz';

function parseArgs(argv) {
  const out = {
    gcsUri: DEFAULT_GCS_OBF,
    top: 500,
    outputCsv: path.join(__dirname, '..', 'tmp', 'unknown-tag-backlog.top500.csv'),
    outputJson: path.join(__dirname, '..', 'tmp', 'unknown-tag-backlog.summary.json')
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--gcs-uri') out.gcsUri = String(argv[++i] || out.gcsUri);
    else if (a === '--top') out.top = Math.max(1, Number(argv[++i] || out.top) || out.top);
    else if (a === '--output-csv') out.outputCsv = String(argv[++i] || out.outputCsv);
    else if (a === '--output-json') out.outputJson = String(argv[++i] || out.outputJson);
  }
  return out;
}

function splitTags(raw) {
  return String(raw || '')
    .split(',')
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean);
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (!/[,"\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

async function main() {
  const args = parseArgs(process.argv);
  const gs = spawn('gsutil', ['cat', args.gcsUri], { stdio: ['ignore', 'pipe', 'inherit'] });
  const gunzip = createGunzip();
  gs.stdout.pipe(gunzip);

  let parseFailed = 0;
  const parser = gunzip.pipe(
    parse({
      delimiter: '\t',
      columns: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_records_with_error: true,
      on_skip: () => {
        parseFailed += 1;
      },
      bom: true
    })
  );

  let total = 0;
  let unknown = 0;
  let withAnyTag = 0;
  const tagCounts = new Map();
  const hierarchyCounts = new Map();
  const sampleByTag = new Map();

  for await (const row of parser) {
    total += 1;
    const categoriesTags = splitTags(row.categories_tags);
    const categoriesHierarchy = splitTags(row.categories_hierarchy);
    const resolved = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: categoriesTags,
      categories_hierarchy: categoriesHierarchy,
      product_name: row.product_name || '',
      ingredients_text: row.ingredients_text || ''
    });
    if (resolved.route !== 'unknown') continue;
    unknown += 1;
    if (categoriesTags.length || categoriesHierarchy.length) withAnyTag += 1;

    for (const t of categoriesTags) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      if (!sampleByTag.has(t)) {
        sampleByTag.set(t, {
          code: String(row.code || '').trim(),
          product_name: String(row.product_name || '').trim().slice(0, 120)
        });
      }
    }
    for (const h of categoriesHierarchy) {
      hierarchyCounts.set(h, (hierarchyCounts.get(h) || 0) + 1);
    }
  }

  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, args.top)
    .map(([tag, count], idx) => {
      const sample = sampleByTag.get(tag) || {};
      return {
        rank: idx + 1,
        tag,
        count,
        sample_code: sample.code || '',
        sample_product_name: sample.product_name || ''
      };
    });

  const topHierarchy = [...hierarchyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, args.top)
    .map(([tag, count], idx) => ({ rank: idx + 1, hierarchy_tag: tag, count }));

  fs.mkdirSync(path.dirname(args.outputCsv), { recursive: true });
  fs.mkdirSync(path.dirname(args.outputJson), { recursive: true });

  const csvHeader = ['rank', 'tag', 'count', 'sample_code', 'sample_product_name'];
  const csvLines = [csvHeader.join(',')];
  for (const row of topTags) {
    csvLines.push(csvHeader.map((k) => csvEscape(row[k])).join(','));
  }
  fs.writeFileSync(args.outputCsv, `${csvLines.join('\n')}\n`, 'utf8');

  const summary = {
    source: args.gcsUri,
    generated_at: new Date().toISOString(),
    total_rows: total,
    unknown_rows: unknown,
    unknown_rate: total > 0 ? Number((unknown / total).toFixed(6)) : 0,
    unknown_rows_with_any_tag_or_hierarchy: withAnyTag,
    parse_failed: parseFailed,
    top_tags: topTags,
    top_hierarchy_tags: topHierarchy
  };
  fs.writeFileSync(args.outputJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log('[unknown-tag-backlog] done');
  console.log(JSON.stringify({
    total_rows: summary.total_rows,
    unknown_rows: summary.unknown_rows,
    unknown_rate: summary.unknown_rate,
    parse_failed: summary.parse_failed,
    output_csv: args.outputCsv,
    output_json: args.outputJson,
    top_5_tags: topTags.slice(0, 5)
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
