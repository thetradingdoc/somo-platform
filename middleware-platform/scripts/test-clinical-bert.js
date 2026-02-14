#!/usr/bin/env node
/**
 * Test ClinicalBERT (biomedical NER) integration.
 * Run: node scripts/test-clinical-bert.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function main() {
  const clinicalBert = require('../services/perception-layer/clinical-bert-service');

  const sampleText = 'The patient reported pain in the left wrist after a fall. X-ray showed a distal radius fracture. No recurrence of palpitations at follow-up 6 months after the ablation.';

  console.log('Testing ClinicalBERT (biomedical NER)...');
  console.log('Model:', clinicalBert.CLINICAL_NER_MODEL);
  console.log('Sample:', sampleText.slice(0, 80) + '...\n');

  const t0 = Date.now();
  const { entities, chunks, ms } = await clinicalBert.extractClinicalEntities(sampleText);
  const total = Date.now() - t0;

  console.log(`Chunks: ${chunks}, inference: ${ms}ms, total: ${total}ms`);
  console.log('Entities:', JSON.stringify(entities, null, 2));
  console.log('\nDone.');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
