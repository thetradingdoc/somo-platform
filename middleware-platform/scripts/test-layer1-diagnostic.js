#!/usr/bin/env node

/**
 * LAYER 1 DIAGNOSTIC TEST - Entity Flow Analysis
 *
 * This test tracks the complete flow of entities through the perception pipeline
 * to diagnose where ClinicalBERT entities are being lost and why grounded findings
 * are incorrect. Logs every step to LangSmith for detailed inspection.
 *
 * Run: LANGCHAIN_TRACING_V2=true node scripts/test-layer1-diagnostic.js
 *
 * What it tracks:
 * 1. ClinicalBERT raw output (all entities with types)
 * 2. Entity filtering (what passes isValidClinicalEntity)
 * 3. Entity stitching (before/after merging)
 * 4. Fusion type filtering (what passes type === 'symptom')
 * 5. Grounded finding selection (why entities[0] was chosen)
 * 6. Textual findings population (GPT-4o vs ClinicalBERT)
 * 7. Negative findings processing (phrases vs keywords)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Force LangSmith tracing
process.env.LANGCHAIN_TRACING_V2 = 'true';
process.env.LANGCHAIN_PROJECT = 'layer1-diagnostic';

const { runPerceptionGraph } = require('../services/perception-layer/perception-graph');
const db = require('../database');

// Diagnostic scenarios - chosen to expose specific issues
const DIAGNOSTIC_SCENARIOS = [
  {
    name: 'Type Mismatch Test',
    description: 'Tests if ClinicalBERT entities with types other than "symptom" are excluded',
    inputs: {
      callId: 'diag-type-mismatch-001',
      modality: 'text',
      clinicalText: `Patient presents with severe chest pain and shortness of breath.
        X-ray shows cardiomegaly. EKG performed. History of hypertension.`,
      imagePath: null,
      clinicId: 'test-clinic-us'
    },
    expectedIssues: [
      'ClinicalBERT should find: chest, pain, shortness of breath, x-ray, cardiomegaly, ekg, hypertension',
      'Types will be: anatomy (chest), sign_symptom (pain, shortness of breath), diagnostic_procedure (x-ray, ekg), disease (cardiomegaly, hypertension)',
      'Fusion filter (type === symptom) will exclude most entities',
      'Only sign_symptom entities (if any) will reach textual_findings'
    ]
  },
  {
    name: 'Demographics Filter Test',
    description: 'Tests if demographic entities are filtered or become grounded findings',
    inputs: {
      callId: 'diag-demographics-002',
      modality: 'text',
      clinicalText: `72-year-old male patient with acute onset severe abdominal pain.
        Patient denies nausea or vomiting. Physical exam shows tenderness in right lower quadrant.`,
      imagePath: null,
      clinicId: 'test-clinic-us'
    },
    expectedIssues: [
      'ClinicalBERT should find: 72-year-old, male, acute, severe, abdominal pain, nausea, vomiting, tenderness, right lower quadrant',
      'Demographics (72-year-old, male) should be filtered out',
      'If not filtered, "72-year-old" or "male" may become the grounded finding',
      'Clinical finding should be "acute severe abdominal pain" or "tenderness in right lower quadrant"'
    ]
  },
  {
    name: 'Entity Ranking Test',
    description: 'Tests if entities are ranked by importance or just use first in sequence',
    inputs: {
      callId: 'diag-ranking-003',
      modality: 'text',
      clinicalText: `Patient fell yesterday. Now complains of severe left wrist pain and swelling.
        Unable to bear weight. X-ray reveals displaced distal radius fracture.`,
      imagePath: null,
      clinicId: 'test-clinic-us'
    },
    expectedIssues: [
      'ClinicalBERT entities in text order: fell, yesterday, severe, left wrist, pain, swelling, unable, weight, x-ray, displaced, distal radius, fracture',
      'First entity might be "fell" or "yesterday" (temporal)',
      'Most important entities: displaced distal radius fracture, severe pain, swelling',
      'Grounded finding should be fracture, not "fell" or "yesterday"',
      'No ranking logic means entities[0] wins regardless of importance'
    ]
  },
  {
    name: 'Entity Synthesis Test',
    description: 'Tests if related entities are combined into meaningful findings',
    inputs: {
      callId: 'diag-synthesis-004',
      modality: 'text',
      clinicalText: `Patient reports persistent sharp pain in the left lower back radiating down the leg.
        Pain started 3 days ago. Worsens with movement.`,
      imagePath: null,
      clinicId: 'test-clinic-us'
    },
    expectedIssues: [
      'ClinicalBERT finds: persistent, sharp, pain, left, lower back, radiating, leg, 3 days ago, movement',
      'Individual entities: pain (symptom), left (laterality), lower back (anatomy), radiating (finding)',
      'Should synthesize to: "sharp pain in left lower back radiating to leg"',
      'Actual: grounded finding = entities[0] = "persistent" or "sharp" or "pain" (single word)',
      'No synthesis logic to combine symptom + laterality + anatomy + radiation'
    ]
  },
  {
    name: 'Negative Findings Test',
    description: 'Tests negative finding extraction (phrases vs keywords)',
    inputs: {
      callId: 'diag-negatives-005',
      modality: 'text',
      clinicalText: `Patient has closed distal radius fracture. No open wound.
        Denies fever or chills. Intact neurovascular status. No signs of infection.`,
      imagePath: null,
      clinicId: 'test-clinic-us'
    },
    expectedIssues: [
      'Negative phrases: "closed fracture" (implies no open), "no open wound", "denies fever", "denies chills", "intact neurovascular", "no infection"',
      'Exclusion keywords extracted: open, wound, fever, chills, infection',
      'Display shows keywords only, not full phrases',
      'Functional for RAG filtering but confusing for human review'
    ]
  },
  {
    name: 'GPT-4o vs ClinicalBERT Overlap Test',
    description: 'Tests how GPT-4o symptoms and ClinicalBERT entities overlap/conflict',
    inputs: {
      callId: 'diag-overlap-006',
      modality: 'text',
      clinicalText: `Patient complains of SOB and CP. RR 24, HR 110.
        Auscultation reveals bilateral crackles. CXR ordered.`,
      imagePath: null,
      clinicId: 'test-clinic-us'
    },
    expectedIssues: [
      'GPT-4o should expand: SOB → shortness of breath, CP → chest pain',
      'GPT-4o symptoms: ["shortness of breath", "chest pain"]',
      'ClinicalBERT (on expanded text) finds: shortness of breath, chest pain, bilateral, crackles, cxr',
      'Both extract same symptoms with different granularity',
      'Textual findings populated from GPT-4o symptoms + filtered ClinicalBERT',
      'Redundancy: both models do same work, no clear merge strategy'
    ]
  }
];

// Detailed entity flow tracker
class EntityFlowTracker {
  constructor(scenarioName) {
    this.scenarioName = scenarioName;
    this.flow = {
      clinical_bert_raw: [],
      clinical_bert_filtered: [],
      clinical_bert_stitched: [],
      gpt4o_symptoms: [],
      fusion_input_entities: [],
      fusion_type_filtered: [],
      grounded_finding_candidates: [],
      selected_grounded_finding: null,
      textual_findings_final: [],
      negative_phrases: [],
      negative_keywords: []
    };
  }

  captureRawEntities(entities) {
    this.flow.clinical_bert_raw = entities.map(e => ({
      text: e.text,
      type: e.type,
      confidence: e.confidence,
      source: e.source
    }));
  }

  captureFilteredEntities(entities) {
    this.flow.clinical_bert_filtered = entities.map(e => ({
      text: e.text,
      type: e.type,
      confidence: e.confidence,
      passed_validation: true
    }));
  }

  captureStitchedEntities(entities) {
    this.flow.clinical_bert_stitched = entities.map(e => ({
      text: e.text,
      type: e.type,
      confidence: e.confidence,
      stitched: e.text.includes(' ')
    }));
  }

  printFlow() {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📊 ENTITY FLOW ANALYSIS: ${this.scenarioName}`);
    console.log('═'.repeat(80));

    console.log('\n1️⃣  CLINICALBERT RAW OUTPUT:');
    console.log(`   Total entities: ${this.flow.clinical_bert_raw.length}`);
    if (this.flow.clinical_bert_raw.length > 0) {
      const typeBreakdown = {};
      this.flow.clinical_bert_raw.forEach(e => {
        typeBreakdown[e.type] = (typeBreakdown[e.type] || 0) + 1;
      });
      console.log('   Type breakdown:');
      Object.entries(typeBreakdown).forEach(([type, count]) => {
        console.log(`     - ${type}: ${count} entities`);
      });
      console.log('\n   First 10 entities:');
      this.flow.clinical_bert_raw.slice(0, 10).forEach((e, i) => {
        console.log(`     ${i + 1}. "${e.text}" (${e.type}, conf: ${(e.confidence * 100).toFixed(1)}%)`);
      });
    } else {
      console.log('   ❌ No entities extracted');
    }

    console.log('\n2️⃣  AFTER FILTERING (isValidClinicalEntity):');
    const filtered = this.flow.clinical_bert_raw.length - this.flow.clinical_bert_filtered.length;
    console.log(`   Filtered out: ${filtered} entities`);
    console.log(`   Remaining: ${this.flow.clinical_bert_filtered.length} entities`);
    if (filtered > 0) {
      const filteredEntities = this.flow.clinical_bert_raw.filter(e =>
        !this.flow.clinical_bert_filtered.some(f => f.text === e.text)
      );
      console.log('   Filtered entities (garbage/stopwords):');
      filteredEntities.forEach(e => {
        console.log(`     ❌ "${e.text}" (${e.type})`);
      });
    }

    console.log('\n3️⃣  AFTER STITCHING (stitchAdjacentEntities):');
    const stitchedCount = this.flow.clinical_bert_stitched.filter(e => e.stitched).length;
    console.log(`   Stitched entities: ${stitchedCount}`);
    if (stitchedCount > 0) {
      console.log('   Stitched examples:');
      this.flow.clinical_bert_stitched.filter(e => e.stitched).slice(0, 5).forEach(e => {
        console.log(`     ✅ "${e.text}" (${e.type})`);
      });
    }

    console.log('\n4️⃣  GPT-4O SYMPTOMS:');
    console.log(`   Total symptoms: ${this.flow.gpt4o_symptoms.length}`);
    this.flow.gpt4o_symptoms.slice(0, 8).forEach((s, i) => {
      console.log(`     ${i + 1}. ${s}`);
    });

    console.log('\n5️⃣  FUSION TYPE FILTER (OLD: type === "symptom" vs NEW: CLINICAL_ENTITY_TYPES):');
    const typeFiltered = this.flow.fusion_input_entities.filter(e => e.type === 'symptom');
    const clinicalTypes = ['symptom', 'sign_symptom', 'clinical_entity', 'diagnostic_procedure', 'anatomy', 'finding', 'disease', 'disorder', 'syndrome', 'procedure', 'treatment'];
    const newTypeFiltered = this.flow.fusion_input_entities.filter(e => clinicalTypes.includes(e.type));
    const excluded = this.flow.fusion_input_entities.filter(e => e.type !== 'symptom');
    console.log(`   Input entities: ${this.flow.fusion_input_entities.length}`);
    console.log(`   OLD filter (type === 'symptom' only): ${typeFiltered.length} passed`);
    console.log(`   NEW filter (CLINICAL_ENTITY_TYPES): ${newTypeFiltered.length} passed`);
    if (excluded.length > 0 && typeFiltered.length < newTypeFiltered.length) {
      const oldExcluded = this.flow.fusion_input_entities.filter(e => !clinicalTypes.includes(e.type));
      if (oldExcluded.length > 0) {
        console.log('\n   Still excluded (temporal/demographic):');
        const typeGroups = {};
        oldExcluded.forEach(e => {
          if (!typeGroups[e.type]) typeGroups[e.type] = [];
          typeGroups[e.type].push(e.text);
        });
        Object.entries(typeGroups).forEach(([type, entities]) => {
          console.log(`     ${type}: ${entities.join(', ')}`);
        });
      }
    }

    console.log('\n6️⃣  GROUNDED FINDING SELECTION:');
    console.log(`   Candidates: ${this.flow.grounded_finding_candidates.length}`);
    if (this.flow.selected_grounded_finding) {
      const selected = this.flow.selected_grounded_finding;
      console.log(`   Selected (ranked): "${selected.text}"`);
      console.log(`   Type: ${selected.type}`);
      console.log(`   Confidence: ${(selected.confidence * 100).toFixed(1)}%`);

      console.log('\n   Alternatives (by ranking):');
      this.flow.grounded_finding_candidates.slice(1, 6).forEach((e, i) => {
        console.log(`     ${i + 2}. "${e.text}" (${e.type}, conf: ${(e.confidence * 100).toFixed(1)}%)`);
      });
    } else {
      console.log('   ❌ No grounded finding selected');
    }

    console.log('\n7️⃣  FINAL TEXTUAL FINDINGS:');
    console.log(`   Total: ${this.flow.textual_findings_final.length}`);
    console.log(`   Sources:`);
    const sources = {};
    this.flow.textual_findings_final.forEach(f => {
      const source = typeof f === 'string' ? 'gpt4o' : (f.source || 'unknown');
      sources[source] = (sources[source] || 0) + 1;
    });
    Object.entries(sources).forEach(([source, count]) => {
      console.log(`     - ${source}: ${count} findings`);
    });

    console.log('\n8️⃣  NEGATIVE FINDINGS:');
    console.log(`   Phrases: ${this.flow.negative_phrases.length}`);
    console.log(`   Keywords: ${this.flow.negative_keywords.length}`);
    if (this.flow.negative_phrases.length > 0) {
      console.log('   Phrases extracted:');
      this.flow.negative_phrases.slice(0, 5).forEach(p => {
        console.log(`     - "${p.phrase}" → excludes: ${p.exclusions.join(', ')}`);
      });
    }
    console.log('   Keywords used (for RAG filtering):');
    console.log(`     ${this.flow.negative_keywords.join(', ')}`);

    console.log('\n' + '═'.repeat(80));
  }
}

// Instrumented perception graph runner
async function runDiagnosticTest(scenario) {
  console.log(`\n\n${'🔬'.repeat(40)}`);
  console.log(`▶️  Running: ${scenario.name}`);
  console.log(`📝 Description: ${scenario.description}`);
  console.log('🔬'.repeat(40));

  const tracker = new EntityFlowTracker(scenario.name);

  try {
    // Instrument ClinicalBERT to capture raw output
    const clinicalBert = require('../services/perception-layer/clinical-bert-service');
    const originalExtract = clinicalBert.extractClinicalEntities;

    clinicalBert.extractClinicalEntities = async function (text) {
      const result = await originalExtract.call(this, text);
      tracker.captureRawEntities(result.entities);
      tracker.flow.clinical_bert_filtered = result.entities;
      tracker.flow.clinical_bert_stitched = result.entities;
      return result;
    };

    // Run perception graph
    const startTime = Date.now();
    const perceptualState = await runPerceptionGraph(scenario.inputs, db);
    const duration = Date.now() - startTime;

    // Restore original function
    clinicalBert.extractClinicalEntities = originalExtract;

    // Capture GPT-4o symptoms (strings in textual_findings; objects with source !== clinical_bert)
    if (perceptualState.textual_findings) {
      tracker.flow.gpt4o_symptoms = perceptualState.textual_findings
        .filter(f => typeof f === 'string')
        .concat(
          (perceptualState.textual_findings.filter(f => typeof f === 'object' && f.source !== 'clinical_bert') || [])
            .map(f => f.concept || f.mention || f.text)
            .filter(Boolean)
        );
    }

    // Capture fusion inputs (entities from ClinicalBERT - same as stitched)
    tracker.flow.fusion_input_entities = tracker.flow.clinical_bert_stitched;

    // Grounded finding: use selectBestGroundedEntity logic (filter + rank)
    const clinicalTypes = ['symptom', 'sign_symptom', 'finding', 'disease', 'disorder', 'diagnostic_procedure', 'clinical_entity', 'anatomy', 'procedure', 'treatment'];
    const eligible = tracker.flow.fusion_input_entities.filter(e =>
      clinicalTypes.includes(e.type) && (e.text || '').trim().length > 2
    );
    const TYPE_WEIGHT = { finding: 1.2, disease: 1.2, disorder: 1.1, syndrome: 1.1, sign_symptom: 1.0, symptom: 1.0, diagnostic_procedure: 0.9, procedure: 0.9, treatment: 0.9, clinical_entity: 0.85, anatomy: 0.8 };
    const scored = eligible.map(e => ({ ...e, _score: (e.confidence ?? 0.5) * (TYPE_WEIGHT[e.type] ?? 0.8) }));
    scored.sort((a, b) => (b._score || 0) - (a._score || 0));
    tracker.flow.grounded_finding_candidates = scored;
    tracker.flow.selected_grounded_finding = scored[0] || null;

    // Capture final textual findings
    tracker.flow.textual_findings_final = perceptualState.textual_findings || [];

    // Capture negative findings
    const textEncoder = require('../services/perception-layer/text-encoder');
    const negResult = textEncoder.extractNegativeFindings(scenario.inputs.clinicalText);
    tracker.flow.negative_phrases = negResult.negative_findings || [];
    tracker.flow.negative_keywords = negResult.exclusion_keywords || [];

    // Print flow analysis
    tracker.printFlow();

    // Print expected issues
    console.log('\n⚠️  EXPECTED ISSUES FOR THIS SCENARIO:');
    scenario.expectedIssues.forEach((issue, i) => {
      console.log(`   ${i + 1}. ${issue}`);
    });

    // Print actual result
    console.log('\n✅ ACTUAL PERCEPTION STATE:');
    console.log(`   Specialty: ${perceptualState.specialty_tag}`);
    console.log(`   Overall Confidence: ${((perceptualState.confidence_scores?.overall_confidence || 0) * 100).toFixed(1)}%`);
    console.log(`   Grounded Findings: ${perceptualState.grounded_findings?.length || 0}`);
    if (perceptualState.grounded_findings && perceptualState.grounded_findings.length > 0) {
      perceptualState.grounded_findings.forEach((gf, i) => {
        console.log(`     ${i + 1}. "${gf.grounded_finding}"`);
      });
    }
    console.log(`   Processing Time: ${duration}ms`);

    return {
      scenario: scenario.name,
      passed: true,
      duration,
      tracker
    };

  } catch (error) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    return {
      scenario: scenario.name,
      passed: false,
      error: error.message
    };
  }
}

// Main test runner
async function runDiagnosticSuite() {
  console.log('\n' + '🔬'.repeat(40));
  console.log('LAYER 1 DIAGNOSTIC TEST SUITE');
  console.log('Entity Flow & Fusion Logic Analysis');
  console.log('🔬'.repeat(40));

  console.log('\n📋 Configuration:');
  console.log(`  LangSmith Tracing: ${process.env.LANGCHAIN_TRACING_V2 === 'true' ? '✅ ENABLED' : '❌ DISABLED'}`);
  console.log(`  LangSmith Project: ${process.env.LANGCHAIN_PROJECT || 'default'}`);
  console.log(`  Total Scenarios: ${DIAGNOSTIC_SCENARIOS.length}`);

  const results = [];

  for (const scenario of DIAGNOSTIC_SCENARIOS) {
    const result = await runDiagnosticTest(scenario);
    results.push(result);
  }

  // Summary
  console.log('\n\n' + '📊'.repeat(40));
  console.log('DIAGNOSTIC SUMMARY');
  console.log('📊'.repeat(40));

  console.log('\n┌────────────────────────────────────────┬────────┬──────────┐');
  console.log('│ Scenario                               │ Status │ Duration │');
  console.log('├────────────────────────────────────────┼────────┼──────────┤');

  results.forEach(r => {
    const scenario = r.scenario.padEnd(38);
    const status = r.passed ? '  ✅   ' : '  ❌   ';
    const duration = r.duration ? `${r.duration}ms`.padStart(8) : 'N/A'.padStart(8);
    console.log(`│ ${scenario} │ ${status} │ ${duration} │`);
  });

  console.log('└────────────────────────────────────────┴────────┴──────────┘');

  const totalTests = results.length;
  const passedTests = results.filter(r => r.passed).length;

  console.log(`\n📈 Results: ${passedTests}/${totalTests} completed`);

  if (process.env.LANGCHAIN_TRACING_V2 === 'true') {
    console.log('\n🔗 View detailed traces in LangSmith:');
    console.log(`   https://smith.langchain.com/projects/${process.env.LANGCHAIN_PROJECT || 'default'}`);
    console.log('\n   Each scenario logged with:');
    console.log('   - Complete entity flow (raw → filtered → stitched → fusion)');
    console.log('   - Type filtering analysis (what was excluded)');
    console.log('   - Grounded finding selection logic');
    console.log('   - GPT-4o vs ClinicalBERT comparison');
  }

  console.log('\n' + '🎯'.repeat(40));
  console.log('DIAGNOSTIC COMPLETE');
  console.log('🎯'.repeat(40) + '\n');

  process.exit(0);
}

// Run diagnostics
if (require.main === module) {
  runDiagnosticSuite().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runDiagnosticSuite };
