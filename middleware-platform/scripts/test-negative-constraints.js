#!/usr/bin/env node
/**
 * Test script for negative constraints (Layer 2 Enhancement B).
 * Verifies extractNegativeFindings, perceptual negative_findings, and exclusion of "open" codes.
 */

const { extractNegativeFindings } = require('../services/perception-layer/text-encoder');
const { extractNegativeConstraints, filterCodesByNegativeConstraints } = require('../services/layer2-rag/negative-constraints');
const { buildSearchIntent } = require('../services/layer2-rag/search-intent-builder');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  console.log('=== Negative Constraints Tests ===\n');

  // 1. extractNegativeFindings (text-encoder)
  console.log('1. extractNegativeFindings');
  const note1 = 'Closed fracture of distal radius. No open wound. Denies infection.';
  const r1 = extractNegativeFindings(note1);
  assert(Array.isArray(r1.exclusion_keywords), 'returns exclusion_keywords');
  assert(r1.exclusion_keywords.includes('open'), 'closed fracture -> exclude open');
  assert(r1.exclusion_keywords.some(k => k === 'infection' || k === 'infected'), 'denies infection -> exclude');
  assert(r1.negative_findings.length > 0, 'has negative_findings');
  console.log('   ✅ extractNegativeFindings extracts exclusions\n');

  // 2. extractNegativeConstraints (raw text - existing)
  console.log('2. extractNegativeConstraints (raw)');
  const raw = extractNegativeConstraints(note1);
  assert(Array.isArray(raw), 'returns array');
  assert(raw.includes('open'), 'raw extract includes open');
  console.log('   ✅ extractNegativeConstraints works\n');

  // 3. filterCodesByNegativeConstraints
  console.log('3. filterCodesByNegativeConstraints');
  const codes = [
    { code: 'S52.501A', description: 'Unspecified fracture of radius, right, open' },
    { code: 'S52.502A', description: 'Closed fracture of distal radius, right' },
    { code: 'S52.501B', description: 'Open fracture type I' }
  ];
  const filtered = filterCodesByNegativeConstraints(codes, ['open']);
  assert(filtered.length < codes.length, 'filters out open codes');
  assert(!filtered.some(c => (c.description || '').toLowerCase().includes('open')), 'no open in result');
  assert(filtered.some(c => (c.description || '').toLowerCase().includes('closed')), 'closed kept');
  console.log('   ✅ filterCodesByNegativeConstraints excludes open codes\n');

  // 4. buildSearchIntent includes negative_constraints from perceptual state
  console.log('4. buildSearchIntent negative_constraints');
  const perceptualState = {
    textual_findings: [{ concept: 'closed_fracture', mention: 'closed fracture' }],
    specialty_tag: 'orthopedics',
    negative_findings: ['open', 'infection']
  };
  const intent = buildSearchIntent(perceptualState, '');
  assert(intent.filters?.negative_constraints?.exclusion_keywords, 'has negative_constraints');
  assert(intent.filters.negative_constraints.exclusion_keywords.includes('open'), 'exclusion includes open');
  console.log('   ✅ buildSearchIntent passes negative_findings to filters\n');

  // 5. More negation patterns
  console.log('5. Additional negation patterns');
  const note2 = 'Negative for chest pain. Rule out infection. Without acute symptoms.';
  const r2 = extractNegativeFindings(note2);
  assert(r2.exclusion_keywords.length > 0, 'extracts from negative/rule out/without');
  console.log('   ✅ Handles negative for, rule out, without\n');

  console.log('=== All negative constraints tests passed ===');
}

try {
  main();
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
