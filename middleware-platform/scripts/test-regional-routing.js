#!/usr/bin/env node
/**
 * Test script for regional policy routing (Layer 2 Enhancement A).
 * Verifies US vs UK/ZA regional configs, specialty mapping, and CPT/HCPCS exclusion.
 */

const path = require('path');
const buildSearchIntent = require('../services/layer2-rag/search-intent-builder').buildSearchIntent;
const { getRegionalConfig, mapSpecialtyToRegion } = require('../config/regional-policies');
const { inferRegion } = require('../services/perception-layer/perceptual-state-builder');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  console.log('=== Regional Policy Routing Tests ===\n');

  // 1. Regional config retrieval
  console.log('1. getRegionalConfig');
  const us = getRegionalConfig('US');
  const uk = getRegionalConfig('UK');
  const za = getRegionalConfig('ZA');
  assert(us.coding_system === 'ICD10CM_CPT', 'US uses ICD10CM_CPT');
  assert(uk.coding_system === 'ICD10_OPCS4', 'UK uses ICD10_OPCS4');
  assert(za.coding_system === 'ICD10_CCSA', 'ZA uses ICD10_CCSA');
  assert(us.modifiers_enabled === true, 'US modifiers enabled');
  assert(uk.modifiers_enabled === false, 'UK modifiers disabled');
  assert(uk.tariff_based === true, 'UK tariff_based');
  console.log('   ✅ US/UK/ZA configs correct\n');

  // 2. Specialty mapping
  console.log('2. mapSpecialtyToRegion');
  assert(mapSpecialtyToRegion('orthopedics', 'US') === 'ama_ortho', 'US ortho -> ama_ortho');
  assert(mapSpecialtyToRegion('orthopedics', 'UK') === 'nhs_trauma_ortho', 'UK ortho -> nhs_trauma_ortho');
  assert(mapSpecialtyToRegion('cardiology', 'ZA') === 'ccsa_cardio', 'ZA cardio -> ccsa_cardio');
  console.log('   ✅ Specialty mapping per region correct\n');

  // 3. buildSearchIntent with region_tag
  console.log('3. buildSearchIntent region_tag');
  const perceptualUS = {
    textual_findings: [{ concept: 'chest_pain', mention: 'angina' }],
    specialty_tag: 'cardiology',
    region_tag: 'US'
  };
  const intentUS = buildSearchIntent(perceptualUS, '');
  assert(intentUS.region === 'US', 'intent region US');
  assert(intentUS.regional_config.modifiers_enabled === true, 'US modifiers in intent');
  assert(intentUS.specialty === 'cardiology', 'specialty (base) for semantic search');
  assert(intentUS.regional_specialty === 'ama_cardio', 'regional_specialty mapped for US');

  const perceptualUK = { ...perceptualUS, region_tag: 'UK' };
  const intentUK = buildSearchIntent(perceptualUK, '');
  assert(intentUK.region === 'UK', 'intent region UK');
  assert(intentUK.regional_config.modifiers_enabled === false, 'UK modifiers disabled in intent');
  assert(intentUK.regional_specialty === 'nhs_cardio', 'regional_specialty mapped for UK');
  console.log('   ✅ buildSearchIntent applies regional config\n');

  // 4. inferRegion (requires DB - may default to US if no clinic)
  console.log('4. inferRegion');
  const r1 = inferRegion(null);
  assert(r1 === 'US', 'null clinicId -> US');
  const r2 = inferRegion('nonexistent_clinic');
  assert(r2 === 'US', 'unknown clinic -> US');
  console.log('   ✅ inferRegion defaults to US when no clinic\n');

  // 5. Fallback intent
  console.log('5. Fallback intent (no perceptual state)');
  const fallback = buildSearchIntent(null, 'patient has fracture');
  assert(fallback.region === 'US', 'fallback region US');
  assert(fallback.source === 'fallback', 'fallback source');
  console.log('   ✅ Fallback uses US default\n');

  console.log('=== All regional routing tests passed ===');
}

try {
  main();
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
