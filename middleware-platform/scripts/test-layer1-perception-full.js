#!/usr/bin/env node

/**
 * LAYER 1 PERCEPTION GRAPH - COMPREHENSIVE TEST
 *
 * Tests the full perception pipeline with LangSmith tracing:
 * - Vision Node (GPT-4o) - image analysis
 * - Text Node (GPT-4o) - translation + normalization
 * - ClinicalBERT Node - biomedical NER (107 entity types)
 * - Fusion Node - multimodal synthesis
 * - Grounding Verification - hallucination check
 * - Confidence Threshold - quality gate
 *
 * Run: LANGCHAIN_TRACING_V2=true node scripts/test-layer1-perception-full.js
 *
 * View results: https://smith.langchain.com
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Force LangSmith tracing
process.env.LANGCHAIN_TRACING_V2 = 'true';
process.env.LANGCHAIN_PROJECT = 'layer1-perception-test';

const fs = require('fs');
const path = require('path');

// Import perception graph components
const { runPerceptionGraph } = require('../services/perception-layer/perception-graph');
const db = require('../database');

// Test scenarios
const TEST_SCENARIOS = [
  {
    name: 'Text-Only: Wrist Fracture',
    inputs: {
      callId: 'test-text-only-001',
      modality: 'text',
      clinicalText: `The patient reported pain in the left wrist after a fall.
        X-ray showed a distal radius fracture with no displacement.
        No open wound. Intact skin. No recurrence of palpitations.
        Follow-up scheduled for 6 months after initial treatment.`,
      imagePath: null,
      clinicId: 'test-clinic-us'
    },
    expectedFindings: {
      symptoms: ['pain', 'palpitations'],
      anatomy: ['left wrist', 'distal radius'],
      procedures: ['x-ray'],
      negations: ['no displacement', 'no open wound', 'intact skin', 'no recurrence'],
      specialty: 'orthopedics'
    }
  },
  {
    name: 'Text-Only: Multilingual (Spanish)',
    inputs: {
      callId: 'test-multilingual-002',
      modality: 'text',
      clinicalText: `El paciente se queja de dolor en el pecho y dificultad para respirar.
        Antecedentes de hipertensión y diabetes tipo 2.
        Frecuencia cardíaca: 110 lpm. Presión arterial: 160/95.`,
      imagePath: null,
      clinicId: 'test-clinic-us'
    },
    expectedFindings: {
      symptoms: ['chest pain', ['shortness of breath', 'difficulty breathing']],
      vitals: { hr: 110, bp: '160/95' },
      conditions: ['hypertension', 'type 2 diabetes'],
      specialty: 'cardiology'
    }
  },
  {
    name: 'Multimodal: X-ray + Clinical Note (if image available)',
    inputs: {
      callId: 'test-multimodal-003',
      modality: 'xray',
      clinicalText: `55-year-old male with FOOSH injury 2 hours ago.
        Severe pain and swelling in left wrist. Unable to bear weight on hand.`,
      imagePath: null,
      clinicId: 'test-clinic-us'
    },
    expectedFindings: {
      symptoms: ['severe pain', 'swelling'],
      anatomy: ['left wrist'],
      mechanism: 'FOOSH',
      specialty: 'orthopedics'
    }
  }
];

// Helper: Pretty print perceptual state
function printPerceptualState(state, scenarioName) {
  console.log('\n' + '='.repeat(80));
  console.log(`📊 SCENARIO: ${scenarioName}`);
  console.log('='.repeat(80));

  console.log('\n🔍 INPUT SUMMARY:');
  console.log(`  Call ID: ${state.call_id || 'N/A'}`);
  console.log(`  Modality: ${state.modality || 'N/A'}`);
  console.log(`  Specialty: ${state.specialty_tag || 'N/A'}`);
  console.log(`  Region: ${state.region_tag || 'N/A'}`);

  if (state.visual_findings && state.visual_findings.length > 0) {
    console.log('\n👁️  VISUAL FINDINGS (GPT-4o Vision):');
    state.visual_findings.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.finding || 'Unknown'}`);
      console.log(`     - Body Region: ${f.body_region || 'N/A'}`);
      console.log(`     - Laterality: ${f.laterality || 'N/A'}`);
      console.log(`     - Confidence: ${(f.confidence * 100).toFixed(1)}%`);
    });
  }

  if (state.textual_findings && state.textual_findings.length > 0) {
    console.log('\n📝 TEXTUAL FINDINGS (GPT-4o Text + ClinicalBERT):');
    const uniqueFindings = new Map();
    state.textual_findings.forEach(f => {
      const key = typeof f === 'string' ? f : (f.concept || f.mention || f.text);
      if (!uniqueFindings.has(key)) {
        uniqueFindings.set(key, f);
      }
    });

    Array.from(uniqueFindings.values()).forEach((f, i) => {
      const text = typeof f === 'string' ? f : (f.concept || f.mention || f.text);
      const conf = typeof f === 'object' ? (f.confidence || 0) : 0;
      const source = typeof f === 'object' ? (f.source || 'unknown') : 'unknown';
      console.log(`  ${i + 1}. ${text}`);
      if (conf > 0) {
        console.log(`     - Confidence: ${(conf * 100).toFixed(1)}%`);
        console.log(`     - Source: ${source}`);
      }
    });
  }

  if ((state.negative_phrases && state.negative_phrases.length > 0) || (state.negative_findings && state.negative_findings.length > 0)) {
    console.log('\n🚫 NEGATIVE FINDINGS (Negation Detection):');
    if (state.negative_phrases && state.negative_phrases.length > 0) {
      state.negative_phrases.forEach((p, i) => console.log(`  ${i + 1}. [phrase] ${p}`));
    }
    if (state.negative_findings && state.negative_findings.length > 0) {
      console.log(`  Keywords for RAG exclusion: ${state.negative_findings.join(', ')}`);
    }
  }

  if (state.grounded_findings && state.grounded_findings.length > 0) {
    console.log('\n🎯 GROUNDED FINDINGS (Fusion Result):');
    state.grounded_findings.forEach((gf, i) => {
      console.log(`  ${i + 1}. ${gf.grounded_finding}`);
      console.log(`     - Specialty: ${gf.specialty || 'N/A'}`);
      console.log(`     - Conflict: ${gf.conflict_flag ? '⚠️  YES' : '✅ NO'}`);
      if (gf.evidence) {
        if (gf.evidence.image && gf.evidence.image.length > 0) {
          console.log(`     - Image Evidence: ${gf.evidence.image.length} finding(s)`);
        }
        if (gf.evidence.text && gf.evidence.text.length > 0) {
          console.log(`     - Text Evidence: ${gf.evidence.text.slice(0, 3).join(', ')}`);
        }
      }
    });
  }

  console.log('\n📈 CONFIDENCE & QUALITY:');
  const overallConf = state.confidence_scores?.overall_confidence || state.confidence_score || 0;
  console.log(`  Overall Confidence: ${(overallConf * 100).toFixed(1)}%`);

  if (state.requires_human_review) {
    const flag = state.requires_human_review.flag || false;
    const severity = state.requires_human_review.severity || 'NONE';
    const reasons = state.requires_human_review.reasons || [];

    console.log(`  Human Review: ${flag ? '⚠️  REQUIRED' : '✅ NOT REQUIRED'}`);
    if (flag) {
      console.log(`  Severity: ${severity}`);
      console.log(`  Reasons:`);
      reasons.forEach(r => console.log(`    - ${r}`));
    }
  }

  if (state.processing_metadata) {
    console.log('\n⏱️  PROCESSING METRICS:');
    const meta = state.processing_metadata;
    if (meta.vision_ms) console.log(`  Vision: ${meta.vision_ms}ms`);
    if (meta.text_ms) console.log(`  Text: ${meta.text_ms}ms`);
    if (meta.bert_ms) console.log(`  ClinicalBERT: ${meta.bert_ms}ms (${meta.bert_chunks || 1} chunks)`);
    if (meta.fusion_ms !== undefined) console.log(`  Fusion: ${meta.fusion_ms}ms`);
  }

  if (state.expanded_text) {
    console.log('\n📄 NORMALIZED TEXT (GPT-4o):');
    console.log(`  ${state.expanded_text.slice(0, 200)}...`);
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

// Helper: Validate expectations
function validateExpectations(state, expected, scenarioName) {
  console.log(`\n🧪 VALIDATING EXPECTATIONS: ${scenarioName}`);

  const issues = [];

  // Check specialty
  if (expected.specialty) {
    const actualSpecialty = (state.specialty_tag || '').toLowerCase();
    const expectedSpecialty = expected.specialty.toLowerCase();
    if (actualSpecialty !== expectedSpecialty) {
      issues.push(`❌ Specialty mismatch: expected "${expectedSpecialty}", got "${actualSpecialty}"`);
    } else {
      console.log(`✅ Specialty: ${expectedSpecialty}`);
    }
  }

  // Check for expected symptoms (supports alternatives: ['shortness of breath', 'difficulty breathing'])
  if (expected.symptoms) {
    const allFindings = (state.textual_findings || []).map(f =>
      typeof f === 'string' ? f.toLowerCase() : (f.concept || f.mention || f.text || '').toLowerCase()
    );
    expected.symptoms.forEach(symptom => {
      const alternatives = Array.isArray(symptom) ? symptom : [symptom];
      const found = alternatives.some(alt =>
        allFindings.some(f => f.includes(String(alt).toLowerCase()))
      );
      if (!found) {
        issues.push(`⚠️  Expected symptom not found: ${alternatives.join(' or ')}`);
      } else {
        console.log(`✅ Found symptom: ${alternatives.join(' or ')}`);
      }
    });
  }

  // Check for negations
  if (expected.negations) {
    const negFindings = (state.negative_findings || []).map(n => n.toLowerCase());
    let foundNegations = 0;
    expected.negations.forEach(neg => {
      const found = negFindings.some(nf => nf.includes(neg.toLowerCase()) || neg.toLowerCase().includes(nf));
      if (found) {
        foundNegations++;
        console.log(`✅ Found negation: ${neg}`);
      }
    });
    if (foundNegations === 0 && expected.negations.length > 0) {
      issues.push(`⚠️  No expected negations found (expected ${expected.negations.length})`);
    }
  }

  // Check confidence threshold
  const overallConf = state.confidence_scores?.overall_confidence || state.confidence_score || 0;
  const threshold = parseFloat(process.env.PERCEPTION_CONFIDENCE_THRESHOLD || '0.85');
  if (overallConf < threshold) {
    issues.push(`⚠️  Confidence ${(overallConf * 100).toFixed(1)}% below threshold ${(threshold * 100).toFixed(1)}%`);
  } else {
    console.log(`✅ Confidence above threshold: ${(overallConf * 100).toFixed(1)}%`);
  }

  if (issues.length > 0) {
    console.log('\n⚠️  VALIDATION ISSUES:');
    issues.forEach(issue => console.log(`  ${issue}`));
  } else {
    console.log('\n✅ ALL VALIDATIONS PASSED');
  }

  return issues.length === 0;
}

// Main test runner
async function runTests() {
  console.log('\n' + '🧬'.repeat(40));
  console.log('LAYER 1 PERCEPTION GRAPH - COMPREHENSIVE TEST SUITE');
  console.log('🧬'.repeat(40));

  console.log('\n📋 Configuration:');
  console.log(`  LangSmith Tracing: ${process.env.LANGCHAIN_TRACING_V2 === 'true' ? '✅ ENABLED' : '❌ DISABLED'}`);
  console.log(`  LangSmith Project: ${process.env.LANGCHAIN_PROJECT || 'default'}`);
  console.log(`  Confidence Threshold: ${process.env.PERCEPTION_CONFIDENCE_THRESHOLD || '0.85'}`);
  console.log(`  ClinicalBERT Model: ${process.env.CLINICAL_NER_MODEL || 'onnx-community/biomedical-ner-all-ONNX'}`);

  const results = [];

  for (const scenario of TEST_SCENARIOS) {
    try {
      console.log(`\n\n${'🔬'.repeat(40)}`);
      console.log(`▶️  Running: ${scenario.name}`);
      console.log('🔬'.repeat(40));

      const startTime = Date.now();

      // Run perception graph
      const perceptualState = await runPerceptionGraph(scenario.inputs, db);

      const duration = Date.now() - startTime;

      // Print results
      printPerceptualState(perceptualState, scenario.name);

      // Validate
      const passed = validateExpectations(perceptualState, scenario.expectedFindings, scenario.name);

      results.push({
        scenario: scenario.name,
        passed,
        duration,
        confidence: perceptualState.confidence_scores?.overall_confidence || perceptualState.confidence_score || 0,
        requiresReview: perceptualState.requires_human_review?.flag || false
      });

    } catch (error) {
      console.error(`\n❌ ERROR in scenario "${scenario.name}":`, error.message);
      console.error(error.stack);
      results.push({
        scenario: scenario.name,
        passed: false,
        error: error.message
      });
    }
  }

  // Final summary
  console.log('\n\n' + '📊'.repeat(40));
  console.log('TEST SUMMARY');
  console.log('📊'.repeat(40));

  console.log('\n┌─────────────────────────────────────────┬────────┬──────────┬────────────┬─────────────┐');
  console.log('│ Scenario                                │ Status │ Duration │ Confidence │ Needs Review│');
  console.log('├─────────────────────────────────────────┼────────┼──────────┼────────────┼─────────────┤');

  results.forEach(r => {
    const scenario = r.scenario.padEnd(39);
    const status = r.passed ? '  ✅   ' : (r.error ? '  ❌   ' : '  ⚠️   ');
    const duration = r.duration ? `${r.duration}ms`.padStart(8) : 'N/A'.padStart(8);
    const confidence = r.confidence ? `${(r.confidence * 100).toFixed(1)}%`.padStart(10) : 'N/A'.padStart(10);
    const review = r.requiresReview ? '     ⚠️      ' : '     ✅      ';

    console.log(`│ ${scenario} │ ${status} │ ${duration} │ ${confidence} │ ${review}│`);
  });

  console.log('└─────────────────────────────────────────┴────────┴──────────┴────────────┴─────────────┘');

  const totalTests = results.length;
  const passedTests = results.filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;

  console.log(`\n📈 Results: ${passedTests}/${totalTests} passed (${((passedTests / totalTests) * 100).toFixed(1)}%)`);

  if (process.env.LANGCHAIN_TRACING_V2 === 'true') {
    console.log('\n🔗 View detailed traces in LangSmith:');
    console.log(`   https://smith.langchain.com/projects/${process.env.LANGCHAIN_PROJECT || 'default'}`);
    console.log('\n   Each scenario is logged as a separate run with:');
    console.log('   - Vision Node (GPT-4o) execution trace');
    console.log('   - Text Node (GPT-4o) execution trace');
    console.log('   - ClinicalBERT inference metrics');
    console.log('   - Fusion logic & reasoning');
    console.log('   - Grounding verification results');
    console.log('   - Confidence threshold evaluation');
  }

  console.log('\n' + '🎯'.repeat(40));
  console.log(failedTests === 0 ? '✅ ALL TESTS PASSED' : `⚠️  ${failedTests} TEST(S) FAILED`);
  console.log('🎯'.repeat(40) + '\n');

  process.exit(failedTests > 0 ? 1 : 0);
}

// Run tests
if (require.main === module) {
  runTests().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
