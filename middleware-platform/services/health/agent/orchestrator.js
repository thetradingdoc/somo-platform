'use strict';

require('../../../utils/langsmith-config');
const { buildSystemPrompt, emergencyReply, PROMPT_VERSION } = require('./prompt');
const modelRouter = require('../model-router');
const toolRegistry = require('../tools/registry');
const SafetyPreScreen = require('../../safety-prescreen');
const healthVideoOpqrst = require('../opqrst');
const healthSessionService = require('../session-service');
const skinRouter = require('../skin-router');
const tokenBudget = require('../../../utils/token-budget');

const MAX_TOOL_ROUNDS = parseInt(process.env.HEALTH_MAX_TOOL_ROUNDS || '3', 10);
const MAX_RAG_PER_TURN = parseInt(process.env.HEALTH_MAX_RAG_PER_TURN || '1', 10);

let ChatGroq = null;
let SystemMessage = null;
let HumanMessage = null;
let AIMessage = null;
let buildHealthLangChainTools = null;
try {
  const groqPkg = require('@langchain/groq');
  const corePkg = require('@langchain/core/messages');
  ChatGroq = groqPkg.ChatGroq;
  SystemMessage = corePkg.SystemMessage;
  HumanMessage = corePkg.HumanMessage;
  AIMessage = corePkg.AIMessage;
  buildHealthLangChainTools = require('./groq-tools').buildHealthLangChainTools;
} catch (_) {}

const USER_FACING_ERRORS = {
  RATE_LIMIT: 'Somo is busy right now. Please wait a moment and try again.',
  LLM_UNAVAILABLE: 'Somo is temporarily unavailable. You can keep typing or end the session.',
  BUDGET_EXCEEDED: 'This session has reached its usage limit. Please end and start a new chat if needed.'
};

function mapLlmError(err) {
  const status = err?.status || err?.statusCode || err?.response?.status;
  if (status === 429) return { code: 'RATE_LIMIT', message: USER_FACING_ERRORS.RATE_LIMIT };
  if (status >= 500 || status === 503) return { code: 'LLM_UNAVAILABLE', message: USER_FACING_ERRORS.LLM_UNAVAILABLE };
  return { code: 'LLM_ERROR', message: USER_FACING_ERRORS.LLM_UNAVAILABLE };
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function _useLangChain() {
  return ChatGroq && process.env.GROQ_API_KEY;
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

async function _invokeLlm(model, messages, tools) {
  const attempt = async () => {
    if (_useLangChain()) {
      return _langChainInvoke(model, messages, tools);
    }
    const completion = await modelRouter.chatCompletion({ messages, tools, model });
    return completion.choices?.[0]?.message;
  };
  try {
    return await attempt();
  } catch (err) {
    const status = err?.status || err?.statusCode || err?.response?.status;
    if (status === 429 || (status >= 500 && status < 600)) {
      await _sleep(600);
      return attempt();
    }
    throw err;
  }
}

function _resolveTools(sessionId, roomId) {
  if (buildHealthLangChainTools && _useLangChain()) {
    return buildHealthLangChainTools({ sessionId, roomId });
  }
  return toolRegistry.getToolDefinitions();
}

async function _maybeForceSkinTool(text, session, sessionId, roomId, toolEvents, ragUsed) {
  if (!skinRouter.isSkinConcern(text)) return ragUsed;
  if (ragUsed >= MAX_RAG_PER_TURN) return ragUsed;
  const metadata = session?.metadata || {};
  const caption = skinRouter.latestVisionCaption(metadata);
  const result = await toolRegistry.executeTool(
    'analyze_skin_concern',
    { message: text, image_caption: caption },
    { sessionId, roomId }
  );
  toolEvents.push({ name: 'analyze_skin_concern', args: { message: text, image_caption: caption }, result });
  return ragUsed + 1;
}

/**
 * Process one patient turn through Groq tool loop (max 3 rounds).
 */
async function processTurn({ text, history = [], session = null, roomId = null } = {}) {
  const replyLanguage = session?.reply_language || 'en';
  const locale = session?.locale || 'en';
  const sessionId = session?.id || healthSessionService.sessionIdFromRoom(roomId);

  const estTokens = tokenBudget.estimateTokens(text) + tokenBudget.estimateTokens(JSON.stringify(history.slice(-10)));
  if (sessionId && !tokenBudget.canProceedHealthSession(sessionId, { tokens: estTokens + 800 })) {
    return {
      text: USER_FACING_ERRORS.BUDGET_EXCEEDED,
      toolEvents: [],
      safety: { emergency: false, flags: [] },
      meta: { error: 'BUDGET_EXCEEDED' },
      error: { code: 'BUDGET_EXCEEDED', message: USER_FACING_ERRORS.BUDGET_EXCEEDED }
    };
  }

  try {

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

  let metadata = session?.metadata || {};
  if (sessionId) {
    metadata = healthVideoOpqrst.updateFromUtterance(metadata, text);
    healthSessionService.updateMetadata(sessionId, metadata);
    session = { ...session, metadata };
  }

  const messages = [
    {
      role: 'system',
      content: buildSystemPrompt({ replyLanguage, locale, metadata })
    },
    ...history.slice(-10),
    { role: 'user', content: text }
  ];
  const tools = _resolveTools(sessionId, roomId);
  const toolEvents = [];
  let priorToolCount = 0;
  let ragUsed = 0;
  let finalText = '';
  let tokensUsed = estTokens;

  ragUsed = await _maybeForceSkinTool(text, session, sessionId, roomId, toolEvents, ragUsed);
  if (toolEvents.length) priorToolCount = toolEvents.length;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const model = modelRouter.selectOrchestratorModel({ toolRound: round, priorToolCount });
    const msg = await _invokeLlm(model, messages, tools);
    const toolCalls = msg.tool_calls
      || msg.additional_kwargs?.tool_calls
      || (msg.tool_calls ? msg.tool_calls : []);

    const normalizedCalls = Array.isArray(toolCalls) ? toolCalls : [];

    if (normalizedCalls.length) {
      messages.push({
        role: 'assistant',
        content: _messageContent(msg) || null,
        tool_calls: normalizedCalls
      });
      for (const tc of normalizedCalls) {
        const fn = tc.name || tc.function?.name;
        if (fn === 'analyze_skin_concern') {
          if (ragUsed >= MAX_RAG_PER_TURN) continue;
          ragUsed++;
        }
        let args = tc.args || {};
        if (typeof tc.function?.arguments === 'string') {
          try { args = JSON.parse(tc.function.arguments); } catch (_) {}
        }
        if (fn === 'analyze_skin_concern' && !args.image_caption) {
          args.image_caption = skinRouter.latestVisionCaption(session?.metadata || {});
        }
        const result = await toolRegistry.executeTool(fn, args, { sessionId, roomId, session });
        toolEvents.push({ name: fn, args, result });
        priorToolCount++;
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }

    finalText = _messageContent(msg) || (msg.content || '').trim();
    tokensUsed += tokenBudget.estimateTokens(finalText);
    break;
  }

  if (!finalText && toolEvents.length) {
    const skin = toolEvents.find((t) => t.name === 'analyze_skin_concern');
    if (skin?.result?.answer) {
      finalText = skin.result.answer;
      if (skin.result.citations?.length) {
        const cites = skin.result.citations.map((c) => c.label || c.title || c.source).filter(Boolean).slice(0, 3);
        if (cites.length) finalText += `\n\nSources: ${cites.join('; ')}`;
      }
    } else {
      const last = toolEvents[toolEvents.length - 1];
      if (last.name === 'request_body_region_capture') {
        finalText = last.result.guidance || 'Please adjust your camera as guided.';
      } else if (last.name === 'recommend_care_pathway') {
        finalText = last.result.summary || 'Based on what you shared, consider following up with a clinician.';
      } else if (last.name === 'generate_visit_summary') {
        finalText = last.result.summary?.pathway_summary || 'Here is a summary of our conversation.';
      }
    }
  }

  if (!finalText) {
    finalText = replyLanguage === 'sw'
      ? 'Asante kwa kushiriki. Unaweza kuelezea zaidi dalili zako?'
      : 'Thank you for sharing. Can you tell me more about your symptoms?';
  }

  if (sessionId) {
    tokenBudget.addHealthSessionUsage(sessionId, { tokens: tokensUsed, rag: ragUsed });
  }

  return {
    text: finalText,
    toolEvents,
    safety: { emergency: false, flags: safety.flags || [] },
    meta: {
      promptVersion: PROMPT_VERSION,
      model: modelRouter.DEFAULT_MODEL,
      toolRounds: toolEvents.length,
      ragUsed
    }
  };
  } catch (err) {
    const mapped = mapLlmError(err);
    console.warn('[kelly-pa-video-orchestrator] turn failed:', err.message);
    return {
      text: mapped.message,
      toolEvents: [],
      safety: { emergency: false, flags: [] },
      meta: { error: mapped.code },
      error: mapped
    };
  }
}

module.exports = {
  processTurn,
  runHealthTurn: processTurn,
  PROMPT_VERSION
};
