/**
 * Phase 5 — Product wiring: derm patient Q&A pipeline (compose + optional LLM).
 * Feature flag: DERM_EDUCATION_PIPELINE_ENABLED=true
 */

function getGroqKey() {
  return String(process.env.GROQ_API_KEY || '').trim();
}

function getOpenAiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function isDermEducationPipelineEnabled() {
  return String(process.env.DERM_EDUCATION_PIPELINE_ENABLED || 'false').toLowerCase() === 'true';
}

function shouldSkipLlm(input) {
  if (input && input.skip_llm === true) return true;
  const v = process.env.DERM_QA_SKIP_LLM;
  return v === '1' || v === 'true';
}

function hasLlmKeys() {
  return !!(getGroqKey() || getOpenAiKey());
}

function buildAbstainUserText(compose) {
  const r = compose.abstain_reason;
  if (r === 'evidence_mismatch') {
    return "The reference material we have doesn't match your question closely enough to summarize safely. In one short sentence, what is your main concern? You can also discuss with a clinician for personalized advice.";
  }
  if (r === 'no_passages') {
    return "I don't have a verified excerpt for this right now. A clinician can examine your skin and discuss options.";
  }
  if (r === 'spam_filtered') {
    return "I couldn't find reliable reference passages for this question. Try rephrasing, or speak with a qualified clinician.";
  }
  return "I can't give a confident answer from the sources available. If you're worried about your symptoms, seek appropriate care.";
}

async function callDermQALlm(systemPrompt, userContent) {
  const groqKey = getGroqKey();
  const openAiKey = getOpenAiKey();
  const model =
    process.env.DERM_QA_LLM_MODEL ||
    (groqKey ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');
  if (groqKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: parseInt(process.env.DERM_QA_LLM_MAX_TOKENS || '1024', 10),
        temperature: parseFloat(process.env.DERM_QA_LLM_TEMPERATURE || '0.25')
      })
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Groq ${res.status}: ${err.slice(0, 200)}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() || '';
  }
  if (openAiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`
      },
      body: JSON.stringify({
        model: process.env.DERM_QA_OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: parseInt(process.env.DERM_QA_LLM_MAX_TOKENS || '1024', 10),
        temperature: parseFloat(process.env.DERM_QA_LLM_TEMPERATURE || '0.25')
      })
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenAI ${res.status}: ${err.slice(0, 200)}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() || '';
  }
  throw new Error('No LLM API key (GROQ_API_KEY or OPENAI_API_KEY)');
}

/**
 * @param {object} input — same options as composeDermPatientQAAnswer + skip_llm
 * @returns {Promise<object>}
 */
async function runDermPatientQAPipeline(input = {}) {
  if (!isDermEducationPipelineEnabled()) {
    return {
      success: false,
      error: 'derm_education_pipeline_disabled',
      message: 'Set DERM_EDUCATION_PIPELINE_ENABLED=true to use the derm Q&A pipeline.'
    };
  }

  const { composeDermPatientQAAnswer } = require('./derm-patient-qa-answer');
  const compose = await composeDermPatientQAAnswer({
    message: input.message,
    imageCaption: input.imageCaption,
    imagePresent: input.imagePresent,
    structuredIntake: input.structuredIntake,
    recentTurns: input.recentTurns,
    triage: input.triage,
    retrieval: input.retrieval,
    skip_retrieve: input.skip_retrieve,
    filters: input.filters,
    exclusion_terms: input.exclusion_terms,
    debug: input.debug
  });

  const skipLlm = shouldSkipLlm(input);
  let answer_text = null;
  let llm_used = false;

  if (skipLlm) {
    return {
      success: true,
      pipeline_enabled: true,
      compose,
      answer_text: null,
      llm_used: false,
      skip_llm: true
    };
  }

  if (compose.mode === 'clarify_only') {
    answer_text = `I'd like to understand your concern better. ${compose.clarifying_question || 'Could you share a bit more detail?'}`;
    return {
      success: true,
      pipeline_enabled: true,
      compose,
      answer_text,
      llm_used: false,
      skip_llm: false
    };
  }

  if (compose.mode === 'abstain') {
    answer_text = buildAbstainUserText(compose);
    return {
      success: true,
      pipeline_enabled: true,
      compose,
      answer_text,
      llm_used: false,
      skip_llm: false
    };
  }

  if (!compose.prompts || !compose.prompts.system) {
    return {
      success: false,
      error: 'compose_missing_prompts',
      compose
    };
  }

  if (!hasLlmKeys()) {
    return {
      success: false,
      error: 'no_llm_key',
      message: 'Set GROQ_API_KEY or OPENAI_API_KEY to generate an answer, or use skip_llm / DERM_QA_SKIP_LLM.',
      compose
    };
  }

  try {
    answer_text = await callDermQALlm(compose.prompts.system, compose.prompts.user);
    llm_used = true;
  } catch (e) {
    return {
      success: false,
      error: 'llm_failed',
      message: e.message,
      compose
    };
  }

  return {
    success: true,
    pipeline_enabled: true,
    compose,
    answer_text,
    llm_used,
    skip_llm: false
  };
}

module.exports = {
  isDermEducationPipelineEnabled,
  runDermPatientQAPipeline,
  shouldSkipLlm,
  buildAbstainUserText
};
