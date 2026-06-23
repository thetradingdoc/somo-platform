'use strict';

const Groq = require('groq-sdk');
const { buildMessages } = require('./somo-demo-prompt-builder');

const STAGES = ['OPEN', 'QUALIFY', 'VALUE', 'OBJECTION', 'CTA', 'CLOSE'];

const DEMO_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'record_interest',
      description: 'Log qualification fields after QUALIFY',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['hot', 'warm', 'cold'] },
          practice_type: { type: 'string' },
          practice_specialty: { type: 'string' },
          primary_problem: { type: 'string' },
          practice_size: { type: 'string' },
          language_detected: { type: 'string' },
          notes: { type: 'string' }
        },
        required: ['level']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_signup_email',
      description: 'Email the prospect a Somo signup link',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_signup_link',
      description: 'Text the prospect a Somo signup or booking link',
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

function isSpanishContext(context) {
  const lang = context?.detected_language || context?.language;
  return lang === 'es';
}

function initialStage() {
  return 'OPEN';
}

function advanceStage(current, userText) {
  const t = String(userText || '').toLowerCase();
  const idx = STAGES.indexOf(current);
  if (idx < 0) return 'OPEN';
  if (/\b(don't call|do not call|stop calling|remove me|unsubscribe)\b/.test(t)) return 'CLOSE';
  if (/\b(no|not interested|stop|goodbye|bye)\b/.test(t) && idx >= 2) return 'CLOSE';
  if (/\b(sign up|signup|link|text me|send link|envía|envíame|mándame|book a call|schedule a call|team call)\b/.test(t)) {
    return 'CTA';
  }
  if (/\b(expensive|already have|not sure|think about|caro|pensarlo)\b/.test(t)) return 'OBJECTION';
  if (
    current === 'VALUE' &&
    /\b(rash|pain|fever|symptom|appointment for my|book me for|see a doctor)\b/.test(t)
  ) {
    return 'CTA';
  }
  if (idx < STAGES.length - 1) return STAGES[idx + 1];
  return current;
}

function ruleBasedReply(stage, context) {
  const name = (context.prospect_name || 'there').split(' ')[0];
  const persona = context.persona_name || 'Kelly';
  const es = isSpanishContext(context);

  if (es) {
    switch (stage) {
      case 'OPEN':
        return `Hola ${name}, soy ${persona} de Somo. Pediste una llamada rápida — ¿ahora te viene bien?`;
      case 'QUALIFY':
        return 'Perfecto. ¿Qué tipo de consultorio tienes — dental, médico o especialidad?';
      case 'VALUE':
        return 'Somo contesta llamadas 24/7 y agenda citas con un solo panel. Puedo mostrarte cómo encaja con tu equipo.';
      case 'OBJECTION':
        return 'Entiendo. Muchos equipos lo usan fuera de horario para no saturar recepción. ¿Te envío un enlace por mensaje?';
    case 'CTA':
      return '¿Te envío un enlace para agendar una llamada con nuestro equipo o empezar el registro?';
      case 'CLOSE':
      default:
        return `Gracias por tu tiempo, ${name}. ¡Que tengas buen día!`;
    }
  }

  switch (stage) {
    case 'OPEN':
      return `Hi ${name}, this is ${persona} from Somo. You asked for a quick call — is now still a good time?`;
    case 'QUALIFY':
      return 'Great. What kind of practice do you run — dental, medical, or specialty?';
    case 'VALUE': {
      const label = context.use_case_label || 'practice';
      const q = context.questions_asked ? ` You mentioned ${String(context.questions_asked).slice(0, 60)}.` : '';
      return `Picture this: a patient calls after hours — I greet them, ask what they need, and book into your schedule.${q} That's Somo for a ${label}.`;
    }
    case 'OBJECTION':
      return 'Totally fair. Many teams use this for overflow and after-hours. Want me to text you a link?';
    case 'CTA':
      return 'I can text you a signup link, or our team can book a quick 15-minute call with you — which works better?';
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
    const wrap = isSpanishContext(context)
      ? `Quiero respetar tu tiempo — te envío un mensaje con más detalles. Gracias, ${(context.prospect_name || 'there').split(' ')[0]}.`
      : `I want to be respectful of your time — I'll text you a quick summary. Thanks, ${(context.prospect_name || 'there').split(' ')[0]}.`;
    return {
      stage: 'CLOSE',
      reply: wrap,
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
      model: require('../../lib/somo-demo-env').getGroqModel(),
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
  ruleBasedReply,
  isSpanishContext
};
