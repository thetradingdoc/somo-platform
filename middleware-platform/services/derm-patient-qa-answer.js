/**
 * Phase 4 — Answer composition: templates, grounding, citations, image disclaimers.
 * Does not call an LLM; returns prompts for the caller (or a future Step10 node).
 */

const fs = require('fs');
const path = require('path');
const { classifyDermPatientQA } = require('./derm-patient-qa-triage');
const { retrievePatientEducationForDermQA } = require('./layer2-rag/patient-education-client');
const { assessPassageGrounding } = require('./derm-patient-qa-grounding');
const { buildCitationList, formatCitationsBlock } = require('./derm-patient-qa-citations');
const {
  buildImageBlockForPrompt,
  buildRetrievalFacingText,
  CANNOT_DIAGNOSE_FROM_IMAGE
} = require('./derm-patient-qa-image');

const TEMPLATES_PATH = path.resolve(__dirname, '../../Knowledge/prompts/derm-patient-qa-templates.json');

let templatesCache = null;
function loadTemplates() {
  if (templatesCache) return templatesCache;
  if (!fs.existsSync(TEMPLATES_PATH)) {
    throw new Error('derm-patient-qa-templates.json not found');
  }
  templatesCache = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  return templatesCache;
}

function resolveTemplateKey(triage) {
  if (triage.needs_clarification) return 'clarify';
  const intent = triage.intent;
  if (intent === 'off_topic') return 'off_topic';
  if (intent === 'urgent') return 'urgent';
  if (intent === 'routine') return 'routine';
  return 'education';
}

/** Prevent section text from injecting nested {{...}} placeholders (naive replace only). */
function sanitizeTemplateInterpolant(val) {
  return String(val || '').replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }');
}

function substituteSections(systemRaw, tmpl) {
  const s = tmpl.sections || {};
  return systemRaw
    .replace(/\{\{EVIDENCE\}\}/g, sanitizeTemplateInterpolant(s.evidence))
    .replace(/\{\{LIMITS\}\}/g, sanitizeTemplateInterpolant(s.limits))
    .replace(/\{\{NEXT_STEP\}\}/g, sanitizeTemplateInterpolant(s.next_step));
}

function buildPassagesBlock(passages) {
  if (!passages || passages.length === 0) return '(No passages retrieved.)';
  return passages
    .map((p, i) => {
      const t = ((p.text || p.passage || '') + '').slice(0, 4000);
      return `--- Excerpt ${i + 1} ---\n${t}`;
    })
    .join('\n\n');
}

function shouldRunGrounding(triage) {
  if (triage.needs_clarification) return false;
  if (triage.intent === 'off_topic') return false;
  return true;
}

function buildUserContent(message, imageCaption, imagePresent) {
  const m = (message || '').trim();
  const cap = (imageCaption || '').trim();
  let block = `Patient question:\n${m}`;
  if (cap) {
    block += `\n\nImage description (uncertain, not a diagnosis):\n${cap}`;
  } else if (imagePresent) {
    block += '\n\n(An image was provided without a usable description.)';
  }
  return block;
}

/**
 * Core composition given triage + retrieval outcome.
 */
function composeFromParts(input) {
  const tmpl = loadTemplates();
  const triage = input.triage;
  const message = (input.message || '').toString().trim();
  const imageCaption = (input.imageCaption || '').toString().trim();
  const imagePresent = !!input.imagePresent;
  const debug = !!input.debug;
  const retrieval = input.retrieval || { passages: [], skipped: true, metadata: {} };
  const passages = retrieval.passages || [];
  const retrievalText = input.retrievalFacingText || buildRetrievalFacingText({ message, imageCaption });

  const citations = buildCitationList(passages, { debug, previewChars: debug ? 400 : 120 });
  const citationsBlock = formatCitationsBlock(citations);
  const imageBlock = buildImageBlockForPrompt({ imagePresent, imageCaption });
  const passagesBlock = buildPassagesBlock(passages);

  const key = resolveTemplateKey(triage);
  const meta = tmpl.by_intent[key];
  if (!meta) throw new Error(`Unknown template key: ${key}`);

  let mode = 'generate';
  let abstain_reason = null;
  let grounding = null;

  if (triage.needs_clarification) {
    mode = 'clarify_only';
  } else if (triage.intent === 'off_topic') {
    mode = 'generate';
  } else {
    const spamAll = retrieval.metadata && retrieval.metadata.content_policy && retrieval.metadata.content_policy.all_filtered_spam;
    if (spamAll) {
      mode = 'abstain';
      abstain_reason = 'spam_filtered';
    } else if (shouldRunGrounding(triage) && passages.length > 0) {
      grounding = assessPassageGrounding({ query: retrievalText, passages });
      if (grounding.should_abstain) {
        mode = 'abstain';
        abstain_reason = 'evidence_mismatch';
      }
    } else if (
      shouldRunGrounding(triage) &&
      passages.length === 0 &&
      !retrieval.skipped &&
      (triage.intent === 'education' || triage.intent === 'routine')
    ) {
      mode = 'abstain';
      abstain_reason = 'no_passages';
    }
  }

  let systemPrompt = substituteSections(meta.system, tmpl);
  systemPrompt = systemPrompt
    .replace(/\{\{PASSAGES_BLOCK\}\}/g, passagesBlock)
    .replace(/\{\{CITATIONS_BLOCK\}\}/g, citationsBlock)
    .replace(/\{\{IMAGE_BLOCK\}\}/g, imageBlock || '(No image.)')
    .replace(/\{\{USER_MESSAGE\}\}/g, message);

  if (mode === 'abstain') {
    const hint = (tmpl.abstain && tmpl.abstain[abstain_reason]) || tmpl.abstain.no_passages;
    systemPrompt = `${systemPrompt}\n\n---\nGrounding / safety instruction: ${hint}`;
  }

  const userContent = buildUserContent(message, imageCaption, imagePresent);

  const clarifying_question =
    mode === 'clarify_only' ? triage.clarifying_hint || 'What body area is involved, how long has this been present, and has it changed?' : null;

  return {
    success: true,
    mode,
    template_key: key,
    abstain_reason,
    clarifying_question,
    prompts: {
      system: systemPrompt,
      user: userContent
    },
    citations,
    citations_for_ui: citations.map((c) => ({
      label: c.label,
      source_id: c.source_id,
      id: c.id
    })),
    grounding,
    triage_summary: {
      intent: triage.intent,
      subkind: triage.subkind,
      needs_clarification: triage.needs_clarification
    },
    retrieval: {
      skipped: !!retrieval.skipped,
      passage_count: passages.length,
      metadata: retrieval.metadata || {}
    },
    image_disclaimers: imagePresent || imageCaption ? [CANNOT_DIAGNOSE_FROM_IMAGE] : []
  };
}

/**
 * Full pipeline: triage → retrieve (optional) → compose prompts.
 * @param {object} input
 * @param {string} input.message
 * @param {string} [input.imageCaption]
 * @param {boolean} [input.imagePresent]
 * @param {object} [input.triage] - Precomputed triage
 * @param {object} [input.retrieval] - Precomputed retrieval
 * @param {boolean} [input.skip_retrieve]
 * @param {boolean} [input.debug] - Verbose citations
 */
async function composeDermPatientQAAnswer(input = {}) {
  const message = (input.message || '').toString().trim();
  const imageCaption = (input.imageCaption || '').toString().trim();
  const retrievalFacingText = buildRetrievalFacingText({ message, imageCaption });

  const triage = input.triage || classifyDermPatientQA({
    message,
    imageCaption,
    structuredIntake: input.structuredIntake,
    recentTurns: input.recentTurns
  });

  let retrieval = input.retrieval;
  if (!retrieval && input.skip_retrieve !== true) {
    retrieval = await retrievePatientEducationForDermQA({
      message: retrievalFacingText,
      retrieval_policy: triage.retrieval_policy,
      needs_clarification: triage.needs_clarification,
      filters: input.filters,
      exclusion_terms: input.exclusion_terms
    });
  }
  if (!retrieval) {
    retrieval = { skipped: true, passages: [], metadata: {} };
  }

  return composeFromParts({
    triage,
    message,
    imageCaption,
    imagePresent: input.imagePresent,
    debug: input.debug,
    retrieval,
    retrievalFacingText
  });
}

module.exports = {
  composeDermPatientQAAnswer,
  composeFromParts,
  resolveTemplateKey,
  loadTemplates
};
