#!/usr/bin/env node
/**
 * Test LangSmith tracing - sends to project "Doctor Little" and runs a perception trace.
 * Run: node scripts/test-langsmith-trace.js
 *
 * Then check LangSmith UI → Doctor Little project for trace results.
 */

require('dotenv').config();

// MUST load langsmith-config first so LANGCHAIN_TRACING_V2 and API key are set
require('../utils/langsmith-config');

// Use "Doctor Little" to match existing project in LangSmith UI
const PROJECT = process.env.LANGCHAIN_PROJECT || process.env.LANGSMITH_PROJECT || 'Doctor Little';
process.env.LANGCHAIN_PROJECT = PROJECT;
process.env.LANGSMITH_PROJECT = PROJECT;
process.env.LANGCHAIN_TRACING_V2 = 'true';  // Force on
process.env.PERCEPTION_GRAPH_ENABLED = '1';

const hasKey = !!(process.env.LANGSMITH_API_KEY || process.env.AP_Langchain);
if (!hasKey) {
  console.error('❌ Set LANGSMITH_API_KEY or AP_Langchain in .env');
  process.exit(1);
}

async function main() {
  console.log(`\n🔬 LangSmith Trace Test`);
  console.log(`   Project: ${PROJECT}`);
  console.log(`   Tracing: ${process.env.LANGCHAIN_TRACING_V2}`);
  console.log(`   Sending trace...\n`);

  // 1. Minimal LangChain call to guarantee a trace (verifies pipeline works)
  if (process.env.OPENAI_API_KEY) {
    const { ChatOpenAI } = require('@langchain/openai');
    const { HumanMessage } = require('@langchain/core/messages');
    const model = new ChatOpenAI({ modelName: 'gpt-4o-mini', temperature: 0, maxTokens: 10 });
    await model.invoke([new HumanMessage('Reply with one word: OK')]);
    console.log('   [1/2] LangChain ping trace sent');
  }

  // 2. Perception graph trace
  const { buildPerceptualState } = require('../services/perception-layer');
  const db = require('../database');
  const r = await buildPerceptualState(
    {
      callId: 'langsmith-test-' + Date.now(),
      clinicalText: 'Patient has right wrist pain after FOOSH. Denies open wound. No infection.',
      modality: 'text'
    },
    db
  );

  console.log(`   [2/2] Perception graph trace sent`);
  console.log(`✅ Done. specialty: ${r.specialty_tag}, textual_findings: ${r.textual_findings?.length || 0}`);
  console.log(`\n📊 View traces in LangSmith UI:`);
  console.log(`   → https://smith.langchain.com`);
  console.log(`   → Tracing → click project "${PROJECT}"`);
  console.log(`   (Wait 10-30 seconds, then refresh)\n`);
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
