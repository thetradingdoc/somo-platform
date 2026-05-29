'use strict';

const fs = require('fs');
const path = require('path');

let _playbookCache = null;

function loadPlaybook() {
  if (_playbookCache) return _playbookCache;
  const playbookPath = path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'agent',
    'dodgecall',
    'PLAYBOOK_MEDICAL.md'
  );
  _playbookCache = fs.readFileSync(playbookPath, 'utf8');
  return _playbookCache;
}

/**
 * Build system prompt for demo conversion turn.
 */
function buildSystemPrompt({ stage, context }) {
  const playbook = loadPlaybook();
  const {
    prospect_name = 'there',
    use_case_label = 'Receptionist',
    persona_name = 'Sam',
    company_name = 'DodgeCall'
  } = context || {};

  return `You are ${persona_name}, a DodgeCall AI phone agent on a live product demo call.

CURRENT_STAGE: ${stage}

PROSPECT_NAME: ${prospect_name}
USE_CASE_SELECTED: ${use_case_label}
COMPANY: ${company_name}

RULES:
- Goal: help the prospect understand DodgeCall and sign up — not medical care or real PHI.
- Keep replies under 3 sentences unless answering a direct question.
- Never say you are Kelly or DocLittle.
- Use tools when appropriate: send_signup_link, record_interest, end_call.

PLAYBOOK:
${playbook}`;
}

function buildMessages({ stage, context, conversationHistory, userMessage }) {
  const system = buildSystemPrompt({ stage, context });
  const messages = [{ role: 'system', content: system }];
  for (const turn of conversationHistory || []) {
    if (turn.role === 'user' || turn.role === 'assistant') {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }
  return messages;
}

module.exports = {
  loadPlaybook,
  buildSystemPrompt,
  buildMessages
};
