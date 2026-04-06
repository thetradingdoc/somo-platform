#!/usr/bin/env node
/**
 * End-to-end simulation: Reddit-style multi-turn → triage → retrieval (if enabled) → compose.
 * No HTTP server. Optional live RAG when RAG_API_URL/RAG_EDUCATION_URL points to a running index.
 *
 * Usage:
 *   node scripts/simulate-derm-reddit-conversation.cjs
 *   DERM_EDUCATION_PIPELINE_ENABLED=true DERM_QA_SKIP_LLM=true node scripts/simulate-derm-reddit-conversation.cjs
 */

const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { classifyDermPatientQA } = require('../services/derm-patient-qa-triage');
const { retrievePatientEducationForDermQA } = require('../services/layer2-rag/patient-education-client');
const { buildRetrievalFacingText } = require('../services/derm-patient-qa-image');
const { composeFromParts } = require('../services/derm-patient-qa-answer');
const { runDermPatientQAPipeline } = require('../services/derm-patient-qa-pipeline');

/** Inspired by golden_stratified_slice_v1.json (post_id 1mtwit5, vague titles, family concern). */
const SCENARIO = {
  title: 'Reddit-style thread: vague opener → mole concern → routine add-on',
  turns: [
    {
      label: 'Turn 1 — vague title (coverage-gap style)',
      message: 'Please help me',
      imageCaption: ''
    },
    {
      label:
        'Turn 2 — high_risk family + mole (golden slice 1mtwit5; includes "changing" + melanoma for derm-urgent rules)',
      message:
        "Mom refuses to see a dermatologist. Her mole changed color over two months and I'm worried it could be melanoma — she says it's nothing.",
      imageCaption: ''
    },
    {
      label: 'Turn 3 — routine product (same visit, different concern)',
      message: 'Separate question — month 3 on tretinoin and still purging, is that normal?',
      imageCaption: ''
    }
  ]
};

function short(obj, depth = 0) {
  return JSON.stringify(obj, null, depth ? 2 : 0);
}

async function runTurn(turn, recentTurns) {
  const triage = classifyDermPatientQA({
    message: turn.message,
    imageCaption: turn.imageCaption || '',
    recentTurns: recentTurns.length ? recentTurns : undefined
  });

  const facing = buildRetrievalFacingText({
    message: turn.message,
    imageCaption: turn.imageCaption || ''
  });

  let retrieval;
  try {
    retrieval = await retrievePatientEducationForDermQA({
      message: facing,
      retrieval_policy: triage.retrieval_policy,
      needs_clarification: triage.needs_clarification
    });
  } catch (e) {
    retrieval = { skipped: true, passages: [], metadata: { source: 'exception', detail: e.message } };
  }

  const compose = composeFromParts({
    triage,
    message: turn.message,
    imageCaption: turn.imageCaption || '',
    imagePresent: !!(turn.imageCaption && String(turn.imageCaption).trim()),
    debug: false,
    retrieval,
    retrievalFacingText: facing
  });

  const assistantStub =
    compose.mode === 'clarify_only'
      ? `[Clarify] ${compose.clarifying_question || 'One short follow-up?'}`
      : compose.mode === 'abstain'
        ? `[Abstain: ${compose.abstain_reason}] Short safe reply without unrelated filler.`
        : `[Draft] See compose.prompts (system+user) for LLM.`;

  const nextHistory = [
    ...recentTurns,
    { role: 'user', content: turn.message },
    { role: 'assistant', content: assistantStub }
  ];

  return { triage, retrieval, compose, assistantStub, nextHistory };
}

async function main() {
  console.log('═'.repeat(72));
  console.log('DERM PATIENT Q&A — Reddit conversation simulation');
  console.log('═'.repeat(72));
  console.log(`Scenario: ${SCENARIO.title}\n`);
  console.log('Env (relevant):');
  console.log(`  DERM_EDUCATION_PIPELINE_ENABLED=${process.env.DERM_EDUCATION_PIPELINE_ENABLED || '(unset)'}`);
  console.log(`  RAG_API_URL / RAG_EDUCATION_URL=${process.env.RAG_EDUCATION_URL || process.env.RAG_API_URL || '(unset → client may no-op or hit default)'}`);
  console.log(`  DERM_QA_SKIP_LLM=${process.env.DERM_QA_SKIP_LLM || '(unset)'}\n`);

  let recentTurns = [];

  for (const turn of SCENARIO.turns) {
    console.log('-'.repeat(72));
    console.log(turn.label);
    console.log(`User: ${turn.message.slice(0, 200)}${turn.message.length > 200 ? '…' : ''}\n`);

    const out = await runTurn(turn, recentTurns);

    console.log('Phase 2 — Triage');
    console.log(
      short(
        {
          intent: out.triage.intent,
          subkind: out.triage.subkind,
          needs_clarification: out.triage.needs_clarification,
          scheduling: out.triage.scheduling,
          retrieval_policy: out.triage.retrieval_policy
        },
        2
      )
    );

    console.log('\nPhase 3 — Retrieval (live call if URL configured)');
    console.log(
      short(
        {
          skipped: out.retrieval.skipped,
          passage_count: (out.retrieval.passages || []).length,
          metadata: out.retrieval.metadata || {},
          content_policy: out.retrieval.metadata && out.retrieval.metadata.content_policy
        },
        2
      )
    );

    console.log('\nPhase 4 — Compose');
    console.log(
      short(
        {
          mode: out.compose.mode,
          template_key: out.compose.template_key,
          abstain_reason: out.compose.abstain_reason || null,
          grounding: out.compose.grounding
            ? {
                best_score: out.compose.grounding.best_score,
                should_abstain: out.compose.grounding.should_abstain
              }
            : null,
          citations_for_ui_count: (out.compose.citations_for_ui || []).length
        },
        2
      )
    );

    console.log('\nAssistant (stub for next-turn context):');
    console.log(out.assistantStub.slice(0, 500) + (out.assistantStub.length > 500 ? '…' : ''));
    console.log('');

    recentTurns = out.nextHistory;
  }

  console.log('═'.repeat(72));
  console.log('Phase 5 — Full pipeline (same final turn, skip_llm)');
  process.env.DERM_EDUCATION_PIPELINE_ENABLED = process.env.DERM_EDUCATION_PIPELINE_ENABLED || 'true';
  process.env.DERM_QA_SKIP_LLM = 'true';
  const { isDermEducationPipelineEnabled } = require('../services/derm-patient-qa-pipeline');
  const pipelineOut = await runDermPatientQAPipeline({
    message: SCENARIO.turns[SCENARIO.turns.length - 1].message,
    skip_llm: true
  });
  console.log(
    short(
      {
        success: pipelineOut.success,
        skip_llm: pipelineOut.skip_llm,
        llm_used: pipelineOut.llm_used,
        compose_mode: pipelineOut.compose && pipelineOut.compose.mode,
        answer_text: pipelineOut.answer_text
      },
      2
    )
  );
  console.log(`\nPipeline enabled: ${isDermEducationPipelineEnabled()}`);

  console.log('\n' + '═'.repeat(72));
  console.log('Synthetic passages (no network) — shows generate path when RAG returns chunks');
  console.log('═'.repeat(72));
  const msgSynth =
    "Her mole changed color over two months — I'm worried about melanoma. She won't book a derm visit.";
  const triageUrgent = classifyDermPatientQA({ message: msgSynth });
  const facing2 = buildRetrievalFacingText({ message: msgSynth, imageCaption: '' });
  const retrievalMock = {
    skipped: false,
    passages: [
      {
        id: 'chunk-demo-1',
        text:
          'If a mole changed color over weeks to months, melanoma must be considered. Urgent dermatologist visit for exam; do not rely on reassurance alone when a family member refuses care — offer to accompany them.',
        source_id: 'guideline-demo',
        source_title: 'Derm education (demo chunk)',
        score: 0.88,
        metadata: { guideline: true }
      }
    ],
    metadata: { source: 'synthetic_demo' }
  };
  const composeGen = composeFromParts({
    triage: triageUrgent,
    message: msgSynth,
    retrieval: retrievalMock,
    retrievalFacingText: facing2
  });
  console.log(
    short(
      {
        triage: {
          intent: triageUrgent.intent,
          subkind: triageUrgent.subkind,
          retrieval_policy: triageUrgent.retrieval_policy
        },
        compose: {
          mode: composeGen.mode,
          abstain_reason: composeGen.abstain_reason,
          grounding: composeGen.grounding
            ? { best_score: composeGen.grounding.best_score, should_abstain: composeGen.grounding.should_abstain }
            : null,
          citations: (composeGen.citations_for_ui || []).slice(0, 3)
        }
      },
      2
    )
  );

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
