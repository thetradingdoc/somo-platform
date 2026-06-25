'use strict';

const Groq = require('groq-sdk');

const DEFAULT_MODEL = process.env.HEALTH_ORCHESTRATOR_MODEL || 'llama-3.1-8b-instant';
const ESCALATE_MODEL = process.env.HEALTH_ORCHESTRATOR_ESCALATE_MODEL || 'llama-3.3-70b-versatile';
const VISION_MODEL = process.env.HEALTH_VISION_MODEL || 'claude-3-5-haiku-20241022';

let groqClient = null;
if (process.env.GROQ_API_KEY) {
  groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

function selectOrchestratorModel({ toolRound = 0, priorToolCount = 0 } = {}) {
  if (toolRound >= 2 || priorToolCount >= 2) return ESCALATE_MODEL;
  return DEFAULT_MODEL;
}

async function chatCompletion({ messages, tools, model, temperature = 0.4, maxTokens = 600 }) {
  if (!groqClient) {
    const err = new Error('GROQ_API_KEY not configured');
    err.statusCode = 503;
    throw err;
  }
  const opts = {
    model: model || DEFAULT_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  if (tools && tools.length) {
    opts.tools = tools;
    opts.tool_choice = 'auto';
  }
  return groqClient.chat.completions.create(opts);
}

function canUseAnthropicVision() {
  return !!(process.env.ANTHROPIC_API_KEY && process.env.HEALTH_VISION_ANTHROPIC_ENABLED !== 'false');
}

function getVisionModel() {
  return VISION_MODEL;
}

module.exports = {
  DEFAULT_MODEL,
  ESCALATE_MODEL,
  selectOrchestratorModel,
  chatCompletion,
  canUseAnthropicVision,
  getVisionModel,
  isAvailable: () => !!groqClient
};
