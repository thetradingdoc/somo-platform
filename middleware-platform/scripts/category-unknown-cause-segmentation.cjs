#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createGunzip } = require('zlib');
const { parse } = require('csv-parse');
const { resolveCategoryRoute, normalizeTags } = require('../services/catalog/category-route-resolver');

const DEFAULT_GCS_OBF =
  process.env.OBF_GCS_BASELINE_URI ||
  'gs://somo-catalog-somo-callsomo/obf/raw/full/en.openbeautyfacts.org.products.csv.gz';

function parseArgs(argv) {
  const out = {
    gcsUri: DEFAULT_GCS_OBF,
    outputJson: path.join(__dirname, '..', 'tmp', 'unknown-cause-segmentation.json'),
    outputCsv: path.join(__dirname, '..', 'tmp', 'unknown-cause-segmentation.csv'),
    top: 200
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--gcs-uri') out.gcsUri = String(argv[++i] || out.gcsUri);
    else if (a === '--output-json') out.outputJson = String(argv[++i] || out.outputJson);
    else if (a === '--output-csv') out.outputCsv = String(argv[++i] || out.outputCsv);
    else if (a === '--top') out.top = Math.max(10, Number(argv[++i] || out.top) || out.top);
  }
  return out;
}

function splitTags(raw) {
  return String(raw || '')
    .split(',')
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean);
}

function tokenizeText(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s:-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function detectCause(row, rawTags, normalizedTags) {
  const hasRaw = rawTags.length > 0;
  const hasNorm = normalizedTags.length > 0;
  const hasIngredients = !!String(row.ingredients_text || '').trim();
  const hasName = !!String(row.product_name || '').trim();
  const hasHierarchy = splitTags(row.categories_hierarchy).length > 0;
  const nonEnTag = rawTags.some((t) => /^[a-z]{2}:/.test(t) && !t.startsWith('en:'));

  if (!hasRaw && !hasHierarchy) return 'missing_tags_and_hierarchy';
  if (hasRaw && !hasNorm) return 'all_tags_suppressed_or_normalized_away';
  if (nonEnTag && hasNorm) return 'non_en_or_locale_variant_unmapped';
  if (!hasIngredients && !hasName) return 'missing_name_and_ingredients';
  if (!hasIngredients || !hasName) return 'partial_text_signals';
  return 'ambiguous_semantics_needs_review';
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

  const causeCounts = new Map();
  const causeExamples = new Map();
  const tagByCause = new Map();
  let total = 0;
  let unknown = 0;

  for await (const row of parser) {
    total += 1;
    const rawTags = splitTags(row.categories_tags);
    const rawHierarchy = splitTags(row.categories_hierarchy);
    const normalizedTags = normalizeTags(rawTags);
    const normalizedHierarchy = normalizeTags(rawHierarchy);
    const out = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: rawTags,
      categories_hierarchy: rawHierarchy,
      product_name: row.product_name || '',
      ingredients_text: row.ingredients_text || ''
    });
    if (out.route !== 'unknown') continue;
    unknown += 1;
    const cause = detectCause(row, rawTags, normalizedTags);
    causeCounts.set(cause, (causeCounts.get(cause) || 0) + 1);
    if (!causeExamples.has(cause)) {
      causeExamples.set(cause, {
        code: String(row.code || '').trim(),
        product_name: String(row.product_name || '').trim().slice(0, 120)
      });
    }
    if (!tagByCause.has(cause)) tagByCause.set(cause, new Map());
    const m = tagByCause.get(cause);
    const signalTags = normalizedTags.length ? normalizedTags : tokenizeText(row.product_name).slice(0, 3);
    for (const t of signalTags.slice(0, 5)) m.set(t, (m.get(t) || 0) + 1);
  }

  const causes = [...causeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cause, count]) => {
      const topTags = [...(tagByCause.get(cause) || new Map()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, args.top)
        .map(([tag, n]) => ({ tag, count: n }));
      return {
        cause,
        count,
        sample: causeExamples.get(cause) || null,
        top_tags: topTags
      };
    });

  const out = {
    source: args.gcsUri,
    generated_at: new Date().toISOString(),
    total_rows: total,
    unknown_rows: unknown,
    unknown_rate: total > 0 ? Number((unknown / total).toFixed(6)) : 0,
    parse_failed: parseFailed,
    causes
  };

  fs.mkdirSync(path.dirname(args.outputJson), { recursive: true });
  fs.writeFileSync(args.outputJson, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

  const csvLines = ['cause,count,sample_code,sample_product_name'];
  for (const c of causes) {
    csvLines.push(
      [c.cause, c.count, c.sample?.code || '', c.sample?.product_name || ''].map(csvEscape).join(',')
    );
  }
  fs.writeFileSync(args.outputCsv, `${csvLines.join('\n')}\n`, 'utf8');

  console.log('[unknown-cause-segmentation] done');
  console.log(
    JSON.stringify(
      {
        total_rows: out.total_rows,
        unknown_rows: out.unknown_rows,
        unknown_rate: out.unknown_rate,
        parse_failed: out.parse_failed,
        causes: causes.map((c) => ({ cause: c.cause, count: c.count })),
        output_json: args.outputJson,
        output_csv: args.outputCsv
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
