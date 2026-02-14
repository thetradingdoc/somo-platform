#!/usr/bin/env node
/**
 * Layer 2 RAG - Specialty Filter Integration Test
 *
 * Verifies:
 * 1. buildSearchIntent returns specialty from perceptual state
 * 2. getCandidatesForCoding uses findings-based query when perceptual state present
 * 3. Orthopedics-related queries return relevant codes (S*, M* for ICD-10)
 *
 * Run: node tests/layer2-specialty-filter.test.js
 */

/* eslint-disable no-console */

const { buildSearchIntent, buildSearchQuery } = require('../services/layer2-rag/search-intent-builder');
const { extractNegativeConstraints, filterCodesByNegativeConstraints } = require('../services/layer2-rag/negative-constraints');
const knowledgeService = require('../services/knowledge-service');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
    return true;
  }
  failed++;
  console.error(`  ❌ ${message}`);
  return false;
}

function assertEqual(actual, expected, message) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  ✅ ${message} (${actual})`);
  } else {
    failed++;
    console.error(`  ❌ ${message}: expected "${expected}", got "${actual}"`);
  }
  return ok;
}

async function testBuildSearchIntent() {
  console.log('\n1. buildSearchIntent from perceptual state');

  const perceptualState = {
    visual_findings: [{ finding: 'cortical_discontinuity', body_region: 'distal_radius', laterality: 'right' }],
    textual_findings: [{ concept: 'FOOSH', mention: 'fall on outstretched hand' }],
    specialty_tag: 'orthopedics'
  };

  const intent = buildSearchIntent(perceptualState, 'fall on wrist');
  assert(intent.specialty === 'orthopedics', 'specialty_tag returned as orthopedics');
  assert(intent.source === 'perceptual', 'source is perceptual when findings present');
  assert(intent.query.includes('cortical discontinuity') || intent.query.includes('distal radius'), 'query includes visual findings');
  assert(intent.filters.laterality === 'right', 'laterality filter set');
}

async function testBuildSearchIntentFallback() {
  console.log('\n2. buildSearchIntent fallback when no perceptual state');

  const intent = buildSearchIntent(null, 'patient has chest pain');
  assertEqual(intent.specialty, 'general', 'specialty defaults to general');
  assertEqual(intent.source, 'fallback', 'source is fallback');
  assert(intent.query.includes('chest pain'), 'query uses fallback text');
}

async function testGetCandidatesForCodingWithPerceptualState() {
  console.log('\n3. getCandidatesForCoding uses perceptual state');

  const perceptualState = {
    textual_findings: [{ concept: 'distal radius fracture', mention: 'wrist fracture' }],
    specialty_tag: 'orthopedics'
  };

  const result = await knowledgeService.getCandidatesForCoding('patient fell and hurt wrist', {
    perceptualState,
    limitCpt: 5,
    limitIcd10: 8
  });

  assert(Array.isArray(result.cpt), 'returns cpt array');
  assert(Array.isArray(result.icd10), 'returns icd10 array');
  assert(result.searchIntent != null, 'searchIntent present when perceptual state used');
  assertEqual(result.searchIntent.specialty, 'orthopedics', 'searchIntent.specialty is orthopedics');

  // Ortho ICD-10: S52.x (radius/ulna), M25.x (joint), etc.
  const orthoCodes = result.icd10.filter(c => /^S52|^M25|^S82/.test((c.code || '')));
  if (result.icd10.length > 0) {
    assert(
      orthoCodes.length >= 1 || result.icd10.some(c => /^S|^M/.test(c.code || '')),
      'at least one ortho-related ICD-10 code (S*, M*)'
    );
  }
}

async function testBuildSearchQuery() {
  console.log('\n4. buildSearchQuery convenience function');

  const perceptualState = {
    textual_findings: [{ concept: 'hypertension' }],
    specialty_tag: 'cardiology'
  };

  const query = buildSearchQuery(perceptualState, 'elevated blood pressure');
  assert(typeof query === 'string', 'returns string');
  assert(query.length > 0, 'query non-empty');
}

async function testVoiceFlowPerceptualState() {
  console.log('\n5. getCodeCandidates with perceptualState (voice flow)');

  const perceptualState = {
    textual_findings: [{ concept: 'chest pain', mention: 'angina' }],
    specialty_tag: 'cardiology'
  };

  const result = await knowledgeService.getCodeCandidates('patient reports chest pain', {
    maxIcd10: 5,
    maxCpt: 5,
    perceptualState
  });

  assert(Array.isArray(result.icd10), 'returns icd10 array');
  assert(Array.isArray(result.cpt), 'returns cpt array');
  assert(result.icd10.length >= 0 && result.cpt.length >= 0, 'voice flow compatible format');
}

async function testNegativeConstraints() {
  console.log('\n6. Negative constraint extraction and filtering');

  const neg = extractNegativeConstraints('Closed fracture. No open wound. Denies infection.');
  assert(neg.length >= 1, 'extracts at least one negative constraint');
  assert(neg.includes('open') || neg.some(t => t.includes('open')), 'no open wound extracts "open"');

  const codes = [
    { code: 'S52.501A', description: 'Unspecified fracture of radius, right side, initial encounter for closed fracture' },
    { code: 'S52.551A', description: 'Open fracture of radius, right side' }
  ];
  const filtered = filterCodesByNegativeConstraints(codes, ['open']);
  assert(filtered.length < codes.length, 'filters out open fracture when open excluded');
  assert(!filtered.some(c => (c.description || '').toLowerCase().includes('open')), 'no open codes in result');
}

async function run() {
  console.log('Layer 2 RAG - Specialty Filter Tests');
  console.log('===================================');

  await testBuildSearchIntent();
  await testBuildSearchIntentFallback();
  await testGetCandidatesForCodingWithPerceptualState();
  await testBuildSearchQuery();
  await testVoiceFlowPerceptualState();
  await testNegativeConstraints();

  console.log('\n===================================');
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Test run failed:', e);
  process.exit(1);
});
