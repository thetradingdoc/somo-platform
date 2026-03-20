/**
 * LLMRouter
 *
 * Routes LLM requests to Claude (primary) or Groq (fallback).
 * Handles tool-calling format differences between providers.
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');

let _anthropic = null;
let _groq = null;

function getAnthropic() {
  if (_anthropic) return _anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
}

function getGroq() {
  if (_groq) return _groq;
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set');
  _groq = new Groq({ apiKey: key });
  return _groq;
}

function _toAnthropicTools(tools) {
  return (tools || []).map((t) => ({
    name: t.function.name,
    description: t.function.description || '',
    input_schema: t.function.parameters || { type: 'object', properties: {} }
  }));
}

/**
 * Convert OpenAI-style messages to Anthropic format.
 *
 * Guardrails:
 * - strips empty user/assistant messages (avoids Anthropic 400 non-empty content errors)
 * - groups tool_result blocks into user turns
 * - merges same-role consecutive messages to enforce strict alternation
 */
function _toAnthropicMessages(messages) {
  const systemMsg = messages.find((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  const converted = [];

  for (const msg of rest) {
    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const content = [];
        const text = String(msg.content || '').trim();
        if (text) content.push({ type: 'text', text });

        for (const tc of msg.tool_calls) {
          let input = {};
          try { input = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input
          });
        }
        converted.push({ role: 'assistant', content });
      } else {
        const text = String(msg.content || '').trim();
        if (text) converted.push({ role: 'assistant', content: text });
      }
      continue;
    }

    if (msg.role === 'tool') {
      const toolResult = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: String(msg.content || '(no result)')
      };
      const last = converted[converted.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(toolResult);
      } else {
        converted.push({ role: 'user', content: [toolResult] });
      }
      continue;
    }

    // regular user
    const text = String(msg.content || '').trim();
    if (text) converted.push({ role: msg.role, content: text });
  }

  const alternated = [];
  for (const msg of converted) {
    const last = alternated[alternated.length - 1];
    if (last && last.role === msg.role) {
      const mergeContent = (a, b) => {
        if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
        if (Array.isArray(a)) return [...a, { type: 'text', text: String(b) }];
        if (Array.isArray(b)) return [{ type: 'text', text: String(a) }, ...b];
        return `${String(a)}\n${String(b)}`;
      };
      last.content = mergeContent(last.content, msg.content);
    } else {
      alternated.push({ ...msg });
    }
  }

  const safe = alternated.filter((m) => {
    if (Array.isArray(m.content)) return m.content.length > 0;
    return m.content && String(m.content).trim().length > 0;
  });

  if (safe.length > 0 && safe[0].role === 'assistant') {
    safe.unshift({ role: 'user', content: '(conversation resumed)' });
  }

  return { system: systemMsg?.content || '', messages: safe };
}

function _fromAnthropicResponse(response) {
  const toolCalls = [];
  let textContent = '';

  for (const block of (response.content || [])) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {})
        }
      });
    }
  }

  const finishReason = response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop';

  return {
    choices: [
      {
        finish_reason: finishReason,
        message: {
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        }
      }
    ]
  };
}

async function call({ messages, tools, maxTokens, channel }) {
  const provider = process.env.KELLY_PRIMARY_PROVIDER || 'groq';

  if (provider === 'anthropic') {
    try {
      return await _callAnthropic({ messages, tools, maxTokens });
    } catch (err) {
      const status = err?.status ?? err?.statusCode ?? 0;
      const msg = String(err?.message || '').toLowerCase();

      const isOverload = status === 529 || msg.includes('overloaded');
      const isRateLimit = status === 429 || msg.includes('rate limit') || msg.includes('rate_limit');
      const isBadRequest = status === 400 || msg.includes('invalid_request') || msg.includes('bad request');

      if (isOverload || isRateLimit || isBadRequest) {
        console.warn('[LLMRouter] Claude unavailable (status=%s), falling back to Groq: %s',
          status || '?', err.message);
        return await _callGroq({ messages, tools, maxTokens, channel });
      }
      throw err;
    }
  }

  return await _callGroq({ messages, tools, maxTokens, channel });
}

async function _callAnthropic({ messages, tools, maxTokens }) {
  const client = getAnthropic();
  const model = process.env.KELLY_ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const { system, messages: converted } = _toAnthropicMessages(messages);
  const anthropicTools = _toAnthropicTools(tools || []);

  if (process.env.KELLY_DEBUG_ANTHROPIC === '1') {
    const payload = JSON.stringify({ system: system?.slice(0, 200), messages: converted, tools: anthropicTools?.length });
    console.log('[LLMRouter] Anthropic payload (first 1500 chars):', payload?.slice(0, 1500));
  }

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens || 1024,
      system,
      messages: converted,
      tools: anthropicTools
    });
    return _fromAnthropicResponse(response);
  } catch (err) {
    const status = err?.status ?? err?.statusCode ?? err?.httpStatus ?? '?';
    const errType = err?.type ?? err?.name ?? 'Error';
    const reqBody = JSON.stringify({
      model,
      system: system?.slice(0, 100),
      message_count: converted?.length,
      tools: anthropicTools?.length,
      first_msg: converted?.[0],
      last_msg: converted?.[converted?.length - 1]
    });
    console.error('[LLMRouter] Anthropic API error: status=%s type=%s message=%s',
      status, errType, err?.message || err);
    console.error('[LLMRouter] Request body (first 500 chars):', reqBody?.slice(0, 500));
    throw err;
  }
}

async function _callGroq({ messages, tools, maxTokens, channel }) {
  const client = getGroq();
  const model = process.env.KELLY_GROQ_MODEL || 'llama-3.3-70b-versatile';
  const tokens =
    maxTokens ||
    (channel === 'voice'
      ? parseInt(process.env.KELLY_VOICE_MAX_TOKENS || '150', 10)
      : parseInt(process.env.KELLY_CHAT_MAX_TOKENS || '200', 10));

  return await client.chat.completions.create({
    model,
    messages,
    tools: tools || [],
    tool_choice: 'auto',
    temperature: 0.3,
    max_tokens: tokens
  });
}

module.exports = { call };
