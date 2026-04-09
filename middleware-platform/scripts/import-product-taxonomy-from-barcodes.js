#!/usr/bin/env node
'use strict';

const { fetchBeautyFactsByBarcode } = require('../services/open-beauty-facts-service');
const {
  upsertFromBeautyFacts,
  upsertProductTaxonomyFullPipeline,
  logBarcodeLookup
} = require('../services/product-taxonomy-repository');

const FULL_ENRICH = String(process.env.PRODUCT_TAXONOMY_FULL_ENRICH || '0') === '1';

async function run() {
  const barcodes = process.argv.slice(2).map((x) => String(x || '').trim()).filter(Boolean);
  if (barcodes.length === 0) {
    console.log('usage: node scripts/import-product-taxonomy-from-barcodes.js <barcode1> <barcode2> ...');
    process.exit(0);
  }
  for (const barcode of barcodes) {
    const out = await fetchBeautyFactsByBarcode(barcode);
    if (!out.success || !out.normalized?.found) {
      logBarcodeLookup({ barcode, source: 'open_beauty_facts', hit: false, details: { error: out.error || 'not_found' } });
      console.log(`MISS ${barcode} (${out.error || 'not_found'})`);
      continue;
    }
    const saved = FULL_ENRICH
      ? await upsertProductTaxonomyFullPipeline(out.normalized)
      : upsertFromBeautyFacts(out.normalized);
    if (!saved.ok) {
      logBarcodeLookup({
        barcode,
        source: 'open_beauty_facts',
        hit: false,
        details: { error: saved.reason || 'save_failed', product_name: out.normalized.product_name }
      });
      console.log(`MISS ${barcode} (${saved.reason || 'save_failed'})`);
      continue;
    }
    logBarcodeLookup({
      barcode,
      source: 'open_beauty_facts',
      hit: !!saved.ok,
      productId: saved.product_id,
      gradeClass: saved?.grade?.grade_class,
      confidence: saved?.grade?.confidence,
      details: { product_name: out.normalized.product_name }
    });
    const src = saved.grade?.source_priority || 'obf';
    console.log(`HIT ${barcode} -> ${saved.product_id} [${saved.grade.grade_class}/${saved.grade.confidence}] src=${src}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
