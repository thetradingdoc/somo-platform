const LLMRouter = require('./llm-router');

const FIELD_PROMPTS = {
  chief_complaint: 'Ask one concise question to capture the main complaint or concern.',
  body_sites: 'Ask one concise question to capture the body area(s) affected.',
  severity: 'Ask one concise question to capture symptom severity, ideally on a 1-10 scale.',
  timeline: 'Ask one concise question to capture onset/timeline (when it started and pattern).'
};

async function generateQuestion({ missingField, pathway = 'triage', preferredLanguage = 'en' } = {}) {
  const instruction = FIELD_PROMPTS[missingField] || 'Ask one concise question for the next missing intake field.';
  const system = `You are a clinical intake assistant. Return exactly one short question and nothing else.`;
  const user = `Pathway: ${pathway}. Language: ${preferredLanguage || 'en'}. ${instruction}`;
  try {
    const out = await LLMRouter.call({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      maxTokens: 80,
      channel: 'chat'
    });
    const text = String(out?.text || '').trim();
    if (text) return text;
  } catch (_) {}

  // Safe deterministic fallback
  if (missingField === 'chief_complaint') return 'What is the main symptom or concern you want help with today?';
  if (missingField === 'body_sites') return 'Which part of your body is affected?';
  if (missingField === 'severity') return 'How severe is it right now on a scale from 1 to 10?';
  if (missingField === 'timeline') return 'When did this start, and is it constant or does it come and go?';
  return 'Could you share one more detail so I can continue your assessment?';
}

module.exports = {
  generateQuestion
};
