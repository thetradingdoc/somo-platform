'use strict';

require('../utils/langsmith-config');
const { buildSystemPrompt, emergencyReply, PROMPT_VERSION } = require('./kelly-pa-video-prompt');
const modelRouter = require('./health-video-model-router');
const toolRegistry = require('./video-tool-registry');
const SafetyPreScreen = require('./safety-prescreen');
const healthVideoOpqrst = require('./health-video-opqrst');
const healthSessionService = require('./health-session-service');

const MAX_TOOL_ROUNDS = 3;

let ChatGroq = null;
let SystemMessage = null;
let HumanMessage = null;
let AIMessage = null;
try {
  const groqPkg = require('@langchain/groq');
  const corePkg = require('@langchain/core/messages');
  ChatGroq = groqPkg.ChatGroq;
  SystemMessage = corePkg.SystemMessage;
  HumanMessage = corePkg.HumanMessage;
  AIMessage = corePkg.AIMessage;
} catch (_) {}

function _useLangChain() {
  return ChatGroq && process.env.LANGCHAIN_TRACING_V2 !== 'false' && process.env.GROQ_API_KEY;
}

async function _langChainInvoke(model, messages, tools) {
  const llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model,
    temperature: 0.4,
    maxTokens: 600
  });
  const bound = tools?.length ? llm.bindTools(tools) : llm;
  const lcMessages = messages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content || '', { tool_calls: m.tool_calls });
    return new HumanMessage(m.content);
  });
  return bound.invoke(lcMessages);
}

function _messageContent(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content.trim();
  if (Array.isArray(msg.content)) {
    return msg.content.map((c) => c.text || c).join(' ').trim();
  }
  return String(msg.content || '').trim();
}

/**
 * Process one patient turn through Groq tool loop (max 3 rounds).
 */
async function processTurn({ text, history = [], session = null, roomId = null } = {}) {
  const replyLanguage = session?.reply_language || 'en';
  const locale = session?.locale || 'en';
  const sessionId = session?.id || healthSessionService.sessionIdFromRoom(roomId);

  const safety = SafetyPreScreen.evaluateSafety({
    text,
    eventType: 'chat_turn',
    payload: { message: text },
    roomId
  });
  if (safety.emergency || safety.status === 'red') {
    return {
      text: emergencyReply(replyLanguage),
      toolEvents: [],
      safety: { emergency: true, flags: safety.flags },
      meta: { promptVersion: PROMPT_VERSION, safety: 'red' }
    };
  }

  if (sessionId) {
    const meta = healthVideoOpqrst.updateFromUtterance(session?.metadata || {}, text);
    healthSessionService.updateMetadata(sessionId, meta);
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt({ replyLanguage, locale }) },
    ...history.slice(-10),
    { role: 'user', content: text }
  ];
  const tools = toolRegistry.getToolDefinitions();
  const toolEvents = [];
  let priorToolCount = 0;
  let finalText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const model = modelRouter.selectOrchestratorModel({ toolRound: round, priorToolCount });
    let completion;

    if (_useLangChain()) {
      const lcResult = await _langChainInvoke(model, messages, tools);
      const toolCalls = lcResult.tool_calls || lcResult.additional_kwargs?.tool_calls || [];
      if (toolCalls.length) {
        messages.push({
          role: 'assistant',
          content: _messageContent(lcResult) || null,
          tool_calls: toolCalls
        });
        for (const tc of toolCalls) {
          const fn = tc.name || tc.function?.name;
          let args = tc.args || {};
          if (typeof tc.function?.arguments === 'string') {
            try { args = JSON.parse(tc.function.arguments); } catch (_) {}
          }
          const result = await toolRegistry.executeTool(fn, args, { sessionId, roomId });
          toolEvents.push({ name: fn, args, result });
          priorToolCount++;
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        continue;
      }
      finalText = _messageContent(lcResult);
      break;
    }

    completion = await modelRouter.chatCompletion({ messages, tools, model });
    const choice = completion.choices?.[0]?.message;
    if (!choice) break;

    if (choice.tool_calls?.length) {
      messages.push({
        role: 'assistant',
        content: choice.content || null,
        tool_calls: choice.tool_calls
      });
      for (const tc of choice.tool_calls) {
        const fn = tc.function?.name;
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (_) {}
        const result = await toolRegistry.executeTool(fn, args, { sessionId, roomId });
        toolEvents.push({ name: fn, args, result });
        priorToolCount++;
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }

    finalText = (choice.content || '').trim();
    break;
  }

  if (!finalText && toolEvents.length) {
    const last = toolEvents[toolEvents.length - 1];
    if (last.name === 'analyze_skin_concern' && last.result?.answer) {
      finalText = last.result.answer;
    } else if (last.name === 'request_body_region_capture') {
      finalText = last.result.guidance || 'Please adjust your camera as guided.';
    } else if (last.name === 'recommend_care_pathway') {
      finalText = last.result.summary || 'Based on what you shared, consider following up with a clinician.';
    }
  }

  if (!finalText) {
    finalText = replyLanguage === 'sw'
      ? 'Asante kwa kushiriki. Unaweza kuelezea zaidi dalili zako?'
      : 'Thank you for sharing. Can you tell me more about your symptoms?';
  }

  return {
    text: finalText,
    toolEvents,
    safety: { emergency: false, flags: safety.flags || [] },
    meta: {
      promptVersion: PROMPT_VERSION,
      model: modelRouter.DEFAULT_MODEL,
      toolRounds: toolEvents.length
    }
  };
}

module.exports = {
  processTurn,
  PROMPT_VERSION
};
