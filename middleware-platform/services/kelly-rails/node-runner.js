'use strict';

const LLMRouter = require('../llm-router');
const KellyToolExecutor = require('../kelly-tool-executor');
const { getAllowedToolNames } = require('./tool-allowlists');
const { laneSystemPrompt } = require('./prompts');
const { loadHistory, appendHistory } = require('./history');

const MAX_ITERATIONS = parseInt(process.env.KELLY_RAILS_MAX_TOOL_ITERATIONS || '2', 10);
const KELLY_CHAT_MAX_TOKENS = parseInt(process.env.KELLY_CHAT_MAX_TOKENS || '300', 10);
const KELLY_VOICE_MAX_TOKENS = parseInt(process.env.KELLY_VOICE_MAX_TOKENS || '200', 10);

function getKellyTools() {
  const agent = require('../kelly-agent-service');
  return agent.KELLY_TOOLS || [];
}

function filterTools(allTools, allowedNames) {
  const set = new Set(allowedNames);
  return allTools.filter((t) => set.has(t?.function?.name));
}

/**
 * Bounded LLM + tool loop for one graph node step.
 */
async function runNodeStep(state, ctx) {
  const { sessionId, clinicId, patientId, callerPhone, channel, message } = ctx;
  const lane = state.active_lane;
  const step = state.step;
  const allowedNames = getAllowedToolNames(lane, step);
  const allTools = getKellyTools();
  const tools = filterTools(allTools, allowedNames);

  appendHistory(sessionId, 'user', message);
  const history = loadHistory(sessionId);
  const systemContent = laneSystemPrompt(lane, step, state);
  const maxTok = channel === 'voice' ? KELLY_VOICE_MAX_TOKENS : KELLY_CHAT_MAX_TOKENS;

  let messages = [{ role: 'system', content: systemContent }, ...history];
  const toolsUsed = [];
  let reply = '';
  let endCall = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response;
    try {
      response = await LLMRouter.call({
        messages,
        tools: tools.length ? tools : undefined,
        channel,
        maxTokens: maxTok
      });
    } catch (e) {
      console.warn('[kelly-rails] LLM call failed:', e.message);
      reply =
        channel === 'voice'
          ? "I'm having trouble right now. Please hold on a moment."
          : "I'm temporarily unavailable. Please try again in a moment.";
      break;
    }

    const choice = response?.choices?.[0];
    const msg = choice?.message;
    if (!msg) break;

    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name;
        if (!name || !allowedNames.includes(name)) continue;
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch (_) {}
        const result = await KellyToolExecutor.execute(name, args, {
          sessionId,
          clinicId,
          patientId,
          callerPhone,
          channel
        });
        toolsUsed.push(name);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result).slice(0, 4000)
        });
      }
      continue;
    }

    reply = String(msg.content || '').trim();
    break;
  }

  if (!reply) {
    reply = 'Thanks — I am still working on that. Could you tell me a bit more?';
  }

  appendHistory(sessionId, 'assistant', reply);
  return { reply, toolsUsed, endCall };
}

module.exports = { runNodeStep, filterTools, getKellyTools };
