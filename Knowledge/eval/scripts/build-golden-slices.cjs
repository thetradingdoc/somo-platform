#!/usr/bin/env node
/**
 * Phase 1 — Build cleaned golden dataset + stratified eval slice.
 *
 * Reads:  ../datasets/golden_dataset.json
 * Writes: ../datasets/golden_dataset_cleaned.json
 *         ../datasets/golden_dataset_dropped.json  (audit trail)
 *         ../datasets/golden_stratified_slice_v1.json
 *         ../datasets/golden_phase1_manifest.json
 *
 * Usage: node build-golden-slices.cjs
 */

const fs = require('fs');
const path = require('path');

const DATASETS = path.join(__dirname, '..', 'datasets');

const NON_DERM_SUBSTRINGS = [
  'yesstyle',
  'preparing to ship',
  'anything goes saturday',
  'anything goes friday',
  'anything goes sunday',
  'price increase in u.s',
  'price increase in u.s.'
];

function hasNonDermNoise(q) {
  const s = (q || '').toLowerCase();
  return NON_DERM_SUBSTRINGS.some((x) => s.includes(x));
}

function classifyQueryStyle(question) {
  const q = (question || '').trim();
  const wc = q.split(/\s+/).filter(Boolean).length;
  const commas = (q.match(/,/g) || []).length;
  const hasQ = /\?/.test(q);
  const looksLikeStackedTerms =
    wc <= 14 && commas >= 2 && !hasQ && /^[a-z0-9\s,.()-]+$/i.test(q) && q.length < 120;
  const looksKeywordLine =
    wc <= 12 &&
    !hasQ &&
    (commas >= 1 || (wc >= 4 && wc <= 10 && /acne|dermatitis|folliculitis|treatment|retinoid/i.test(q)));

  if (looksLikeStackedTerms || (looksKeywordLine && wc <= 10)) {
    return 'keyword_synthetic';
  }
  return 'natural_language';
}

function classifyLanguage(question) {
  const q = question || '';
  if (/[а-яА-ЯёЁ]/.test(q)) return 'mixed_cyrillic';
  if (/[áàâãäéêëíïóôõöúçñ]/i.test(q) && /\b(nao|voce|por favor|regiao)\b/i.test(q)) return 'pt';
  if (/[áàâãéêíóôõúç]/i.test(q) && q.length > 20) return 'mixed_latin';
  return 'en';
}

function stratifyBucket(row) {
  const qq = (row.question || '').trim().toLowerCase();
  const shortQ = qq.length < 45;

  /** Vague / low-context titles — use question only so GT does not steal bucket */
  if (
    shortQ &&
    /please help|^is this concerning\??$|worried about family|worried about family member|^worried about$|not sure what it is|details in caption/i.test(
      qq
    ) &&
    !/mole|melanoma|changing|bleeding|ulcer|biopsy|cancer|leg |arm |back |grandma|grandfather|dad|mom/i.test(qq)
  ) {
    return 'vague_or_worried';
  }

  const qBoth = (row.question + ' ' + (row.ground_truth || '')).toLowerCase();
  if (
    /mole|melanoma|basal cell|squamous|biopsy|cancer|changing colour|changing color|bleeding|ulcer|sjs|dress|cellulitis|urgent|asap|see a dermatologist as soon|extremely concerning|high clinical suspicion/i.test(
      qBoth
    )
  ) {
    return 'high_risk';
  }
  if (
    /retinoid|tretinoin|spironolactone|purging|niacinamide|routine|product|moisturizer|cleanser/i.test(qBoth)
  ) {
    return 'routine_product';
  }
  if (classifyQueryStyle(row.question) === 'keyword_synthetic') {
    return 'keyword_synthetic';
  }
  return 'benign_education';
}

function pickStratified(rows, targetTotal = 120) {
  const buckets = {
    high_risk: [],
    vague_or_worried: [],
    routine_product: [],
    keyword_synthetic: [],
    benign_education: []
  };
  for (const row of rows) {
    const b = stratifyBucket(row);
    if (buckets[b]) buckets[b].push(row);
  }

  const quota = {
    high_risk: Math.min(35, buckets.high_risk.length),
    vague_or_worried: Math.min(25, buckets.vague_or_worried.length),
    routine_product: Math.min(20, buckets.routine_product.length),
    keyword_synthetic: Math.min(25, buckets.keyword_synthetic.length),
    benign_education: Math.min(25, buckets.benign_education.length)
  };

  let sum = Object.values(quota).reduce((a, x) => a + x, 0);
  if (sum > targetTotal) {
    const scale = targetTotal / sum;
    Object.keys(quota).forEach((k) => {
      quota[k] = Math.max(3, Math.floor(quota[k] * scale));
    });
  }

  const out = [];
  const take = (arr, n) => arr.slice(0, n);
  for (const k of Object.keys(quota)) {
    const tagged = take(buckets[k], quota[k]).map((r) => ({
      ...r,
      stratify_bucket: k
    }));
    out.push(...tagged);
  }

  if (out.length < targetTotal) {
    const used = new Set(out.map((r) => (r.post_id || '') + r.question));
    for (const r of rows) {
      if (out.length >= targetTotal) break;
      const key = (r.post_id || '') + r.question;
      if (!used.has(key)) {
        used.add(key);
        out.push({ ...r, stratify_bucket: stratifyBucket(r) });
      }
    }
  }

  return out.slice(0, targetTotal);
}

function main() {
  const inputPath = path.join(DATASETS, 'golden_dataset.json');
  if (!fs.existsSync(inputPath)) {
    console.error('Missing', inputPath);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(raw)) {
    console.error('golden_dataset.json must be a JSON array');
    process.exit(1);
  }

  const dropped = [];
  const enriched = [];

  for (const row of raw) {
    const question = row.question || '';
    if (hasNonDermNoise(question)) {
      dropped.push({ ...row, drop_reason: 'non_derm_noise_substring' });
      continue;
    }
    const query_style = classifyQueryStyle(question);
    const language = classifyLanguage(question);
    enriched.push({
      ...row,
      eval_phase1: {
        query_style,
        language,
        stratify_bucket: stratifyBucket({ ...row, question })
      }
    });
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    source_file: 'golden_dataset.json',
    total_input: raw.length,
    total_cleaned: enriched.length,
    total_dropped: dropped.length,
    query_style_counts: enriched.reduce((acc, r) => {
      const k = r.eval_phase1.query_style;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    language_counts: enriched.reduce((acc, r) => {
      const k = r.eval_phase1.language;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    stratify_bucket_counts: enriched.reduce((acc, r) => {
      const k = r.eval_phase1.stratify_bucket;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    non_derm_substrings: NON_DERM_SUBSTRINGS
  };

  const stratified = pickStratified(enriched, 120);
  manifest.stratified_slice_size = stratified.length;
  manifest.stratified_slice_buckets = stratified.reduce((acc, r) => {
    const k = r.stratify_bucket || r.eval_phase1?.stratify_bucket || 'unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  fs.writeFileSync(
    path.join(DATASETS, 'golden_dataset_cleaned.json'),
    JSON.stringify(enriched, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(DATASETS, 'golden_dataset_dropped.json'),
    JSON.stringify(dropped, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(DATASETS, 'golden_stratified_slice_v1.json'),
    JSON.stringify(stratified, null, 2),
    'utf8'
  );
  fs.writeFileSync(path.join(DATASETS, 'golden_phase1_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(JSON.stringify(manifest, null, 2));
}

main();
