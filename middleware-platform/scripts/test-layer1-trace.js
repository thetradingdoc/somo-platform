#!/usr/bin/env node
/**
 * Test Layer 1 Perception - sends traces to LangSmith project "layer1-perception"
 * Run: node scripts/test-layer1-trace.js
 *
 * Scenarios: text-only, negative findings, specialty inference
 */

require('dotenv').config();
require('../utils/langsmith-config');

// Force Layer 1 project so traces are grouped
process.env.LANGCHAIN_PROJECT = 'layer1-perception';
process.env.LANGSMITH_PROJECT = 'layer1-perception';
process.env.LANGCHAIN_TRACING_V2 = 'true';
process.env.PERCEPTION_GRAPH_ENABLED = '1';

const hasKey = !!(process.env.LANGSMITH_API_KEY || process.env.AP_Langchain);
if (!hasKey) {
  console.error('❌ Set LANGSMITH_API_KEY or AP_Langchain in .env');
  process.exit(1);
}

const SCENARIOS = [
  {
    name: 'Ortho / FOOSH',
    clinicalText: 'Patient has right wrist pain after FOOSH. Denies open wound. No infection.',
    expectedSpecialty: 'orthopedics'
  },
  {
    name: 'Chest / Cardiology',
    clinicalText: 'Patient reports chest pain and shortness of breath. Denies palpitations.',
    expectedSpecialty: 'cardiology'
  },
  {
    name: 'Negative constraints',
    clinicalText: 'Closed fracture of distal radius. No open wound. Rule out infection.',
    expectNegative: ['open']
  }
];

async function runScenario(scenario, index) {
  const { buildPerceptualState } = require('../services/perception-layer');
  const db = require('../database');

  const r = await buildPerceptualState(
    {
      callId: `layer1-test-${index}-${Date.now()}`,
      clinicalText: scenario.clinicalText,
      modality: 'text'
    },
    db
  );

  return {
    scenario: scenario.name,
    specialty: r.specialty_tag,
    textual_count: r.textual_findings?.length || 0,
    negative_findings: r.negative_findings || [],
    success:
      (!scenario.expectedSpecialty || r.specialty_tag === scenario.expectedSpecialty) &&
      (!scenario.expectNegative || scenario.expectNegative.every(n => (r.negative_findings || []).includes(n)))
  };
}

async function main() {
  console.log('\n🔬 Layer 1 Perception Trace Test');
  console.log(`   Project: ${process.env.LANGCHAIN_PROJECT}`);
  console.log(`   Scenarios: ${SCENARIOS.length}\n`);

  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    process.stdout.write(`   [${i + 1}/${SCENARIOS.length}] ${s.name}... `);
    try {
      const result = await runScenario(s, i);
      console.log(result.success ? '✅' : '⚠️', `specialty=${result.specialty}, neg=${(result.negative_findings || []).join(',') || 'none'}`);
    } catch (e) {
      console.log('❌', e.message);
    }
  }

  console.log('\n✅ Layer 1 trace test complete.');
  console.log(`\n📊 View traces in LangSmith:`);
  console.log(`   → https://smith.langchain.com`);
  console.log(`   → Tracing → project "${process.env.LANGCHAIN_PROJECT}"`);
  console.log('   (Wait 10-30s, then refresh)\n');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
