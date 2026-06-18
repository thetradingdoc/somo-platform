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
    'somo-demo',
    'QUALIFICATION_PLAYBOOK.md'
  );
  _playbookCache = fs.readFileSync(playbookPath, 'utf8');
  return _playbookCache;
}

/**
 * Build system prompt for qualification demo turn.
 */
function buildSystemPrompt({ stage, context }) {
  const playbook = loadPlaybook();
  const {
    prospect_name = 'there',
    use_case_label = 'Medical Clinic',
    persona_name = 'Kelly',
    company_name = 'Somo',
    detected_language,
    language,
    questions_asked,
    practice_specialty
  } = context || {};

  const lang = detected_language || language;
  const langLine =
    lang === 'es'
      ? '- Respond entirely in Spanish for the rest of this call.\n'
      : lang && lang !== 'en'
        ? `- Caller language hint: ${lang}. Mirror their language when possible.\n`
        : '';

  const formHints = [];
  if (practice_specialty) formHints.push(`Form specialty hint: ${practice_specialty}`);
  if (questions_asked) formHints.push(`Form context: ${questions_asked}`);
  const formBlock = formHints.length ? `\nFORM_CONTEXT:\n${formHints.join('\n')}\n` : '';

  return `You are ${persona_name}, an AI front desk assistant made by ${company_name}, on a live qualification demo call.

CURRENT_STAGE: ${stage}

PROSPECT_NAME: ${prospect_name}
USE_CASE_SELECTED: ${use_case_label}
COMPANY: ${company_name}
${formBlock}
RULES:
- Goal: learn about their practice in ~2 minutes and show ONE relevant capability — not clinical intake or a hard sales pitch.
- NEVER claim an appointment is booked or schedule a real visit on this demo — qualification only; no booking or slot tools.
- One question per turn; keep voice replies under ~25 words unless answering a direct question.
- Do not ask which language they speak; mirror English or Spanish from the caller.
- After QUALIFY, call record_interest with practice_type, practice_specialty, primary_problem, practice_size, language_detected, notes, and level (hot/warm/cold).
- In VALUE stage: roleplay one concrete front-desk moment (after-hours call → greet → triage → offer booking) — demonstrate Kelly, do not list product features.
- Use send_signup_email (preferred) or send_signup_link when they accept the CTA; end_call when done or at time limit.
- Emergency symptoms: direct to 911 — no signup or booking.
${langLine}
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
