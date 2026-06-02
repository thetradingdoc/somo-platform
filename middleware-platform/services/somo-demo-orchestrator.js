'use strict';

const Groq = require('groq-sdk');
const { buildMessages } = require('./somo-demo-prompt-builder');

const STAGES = ['OPEN', 'QUALIFY', 'VALUE', 'OBJECTION', 'CTA', 'CLOSE'];

const DEMO_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'record_interest',
      description: 'Record prospect interest level',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['hot', 'warm', 'cold'] },
          notes: { type: 'string' }
        },
        required: ['level']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_signup_link',
      description: 'Text the prospect a Somo demo signup link',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'end_call',
      description: 'End the demo call politely',
      parameters: { type: 'object', properties: {} }
    }
  }
];

let _groq = null;
function getGroq() {
  if (_groq) return _groq;
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  _groq = new Groq({ apiKey: key });
  return _groq;
}

function initialStage() {
  return 'OPEN';
}

function advanceStage(current, userText) {
  const t = String(userText || '').toLowerCase();
  const idx = STAGES.indexOf(current);
  if (idx < 0) return 'OPEN';
  if (/\b(no|not interested|stop|goodbye|bye)\b/.test(t) && idx >= 2) return 'CLOSE';
  if (/\b(sign up|signup|link|text me|send link)\b/.test(t)) return 'CTA';
  if (/\b(expensive|already have|not sure|think about)\b/.test(t)) return 'OBJECTION';
  if (idx < STAGES.length - 1) return STAGES[idx + 1];
  return current;
}

function ruleBasedReply(stage, context) {
  const name = (context.prospect_name || 'there').split(' ')[0];
  const persona = context.persona_name || 'Sam';
  switch (stage) {
    case 'OPEN':
      return `Hi ${name}, this is ${persona} from Somo demo. You asked for a quick live demo — is now still a good time?`;
    case 'QUALIFY':
      return `Great. What kind of business are you running — clinic, med spa, or something else?`;
    case 'VALUE':
      return `Somo demo answers calls 24/7, books appointments, and gives you one dashboard to control scripts. Your ${context.use_case_label || 'team'} would sound like this on every call.`;
    case 'OBJECTION':
      return `Totally fair. Most teams use this for overflow and after-hours so staff stay focused on in-room care. Want me to text you a signup link?`;
    case 'CTA':
      return `I can text you a link to create your Somo demo account — takes about two minutes. Should I send it?`;
    case 'CLOSE':
    default:
      return `Thanks for your time, ${name}. Have a great day!`;
  }
}

async function processTurn({
  userMessage,
  stage,
  context,
  conversationHistory,
  elapsedSec,
  maxDurationSec
}) {
  let nextStage = stage || initialStage();
  if (userMessage) {
    nextStage = advanceStage(nextStage, userMessage);
  }

  if (elapsedSec >= maxDurationSec) {
    return {
      stage: 'CLOSE',
      reply: ruleBasedReply('CLOSE', context),
      endCall: true,
      toolCalls: [{ name: 'end_call', arguments: {} }]
    };
  }

  const groq = getGroq();
  if (!groq) {
    const reply = userMessage
      ? ruleBasedReply(nextStage, context)
      : ruleBasedReply('OPEN', context);
    return { stage: nextStage, reply, endCall: nextStage === 'CLOSE', toolCalls: [] };
  }

  const messages = buildMessages({
    stage: nextStage,
    context,
    conversationHistory,
    userMessage
  });

  try {
    const completion = await groq.chat.completions.create({
      model: process.env.DODGECALL_DEMO_GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages,
      tools: DEMO_TOOLS,
      tool_choice: 'auto',
      max_tokens: 256,
      temperature: 0.6
    });

    const choice = completion.choices[0];
    const msg = choice.message;
    const toolCalls = (msg.tool_calls || []).map((tc) => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || '{}')
    }));

    return {
      stage: nextStage,
      reply: msg.content || null,
      toolCalls,
      endCall: toolCalls.some((t) => t.name === 'end_call')
    };
  } catch (err) {
    console.warn('Somo demo orchestrator Groq failed:', err.message);
    return {
      stage: nextStage,
      reply: ruleBasedReply(nextStage, context),
      endCall: false,
      toolCalls: []
    };
  }
}

module.exports = {
  STAGES,
  DEMO_TOOLS,
  initialStage,
  advanceStage,
  processTurn,
  ruleBasedReply
};
