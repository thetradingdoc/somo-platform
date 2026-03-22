/**
 * LLMRouter
 *
 * Routes LLM requests to Claude (default primary) or Groq (fallback).
 * Set KELLY_PRIMARY_PROVIDER=groq to force Groq-only. If the key is missing,
 * resolvePrimaryProvider() falls back to Groq when ANTHROPIC_API_KEY is unset.
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

const PROVIDER_TIMEOUT_MS = parseInt(process.env.KELLY_PROVIDER_TIMEOUT_MS || '20000', 10);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(label || `Timeout after ${ms}ms`)), ms)
    )
  ]);
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function _hasAnthropicKey() {
  return !!(process.env.ANTHROPIC_API_KEY || '').trim();
}

function _hasGroqKey() {
  return !!(process.env.GROQ_API_KEY || '').trim();
}

/** True when failing over from primary to secondary provider is reasonable. */
function _isCrossFallbackTransient(err) {
  const status = err?.status ?? err?.statusCode ?? 0;
  if (status === 401 || status === 403) return false;
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('anthropic provider timeout') || msg.includes('groq provider timeout')) return true;
  return (
    status === 529 ||
    msg.includes('overloaded') ||
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    status === 400 ||
    msg.includes('invalid_request') ||
    msg.includes('bad request') ||
    status === 408 ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('etimedout') ||
    msg.includes('deadline') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    (typeof status === 'number' && status >= 500 && status < 600) ||
    status === 413 ||
    msg.includes('too large') ||
    msg.includes('tokens per minute')
  );
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

/**
 * Effective Kelly primary: Claude when ANTHROPIC_API_KEY is set (default),
 * unless KELLY_PRIMARY_PROVIDER=groq. Missing Anthropic key → Groq only + warning.
 */
function resolvePrimaryProvider() {
  const raw = (process.env.KELLY_PRIMARY_PROVIDER || 'anthropic').trim().toLowerCase();
  if (raw === 'groq') return 'groq';
  if (!(process.env.ANTHROPIC_API_KEY || '').trim()) {
    console.warn('[LLMRouter] Claude is the default primary but ANTHROPIC_API_KEY is not set; using Groq only');
    return 'groq';
  }
  return 'anthropic';
}

/**
 * @param {object} opts
 * @param {string} [opts.forceProvider] - 'groq' | 'anthropic' — no cross-fallback
 */
async function call({ messages, tools, maxTokens, channel, forceProvider = null }) {
  if (forceProvider === 'groq') {
    return await _callGroq({ messages, tools, maxTokens, channel });
  }
  if (forceProvider === 'anthropic') {
    return await _callAnthropic({ messages, tools, maxTokens });
  }

  const primary = resolvePrimaryProvider();
  const order = [];
  if (primary === 'anthropic') {
    order.push('anthropic');
    if (_hasGroqKey()) order.push('groq');
  } else {
    order.push('groq');
    if (_hasAnthropicKey() && process.env.KELLY_GROQ_FALLBACK_TO_ANTHROPIC !== '0') {
      order.push('anthropic');
    }
  }

  let lastErr;
  for (let i = 0; i < order.length; i++) {
    const p = order[i];
    try {
      if (p === 'anthropic') {
        return await _callAnthropic({ messages, tools, maxTokens });
      }
      return await _callGroq({ messages, tools, maxTokens, channel });
    } catch (err) {
      lastErr = err;
      const hasNext = i < order.length - 1;
      if (hasNext && _isCrossFallbackTransient(err)) {
        console.warn(`[LLMRouter] ${p} failed, trying ${order[i + 1]}:`, err?.message || err);
        await _sleep(450);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('No LLM provider available');
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
    const payload = {
      model,
      max_tokens: maxTokens || 1024,
      system,
      messages: converted
    };
    if (anthropicTools.length > 0) payload.tools = anthropicTools;
    const response = await withTimeout(
      client.messages.create(payload),
      PROVIDER_TIMEOUT_MS,
      `Anthropic provider timeout after ${PROVIDER_TIMEOUT_MS}ms`
    );
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

  const maxAttempts = Math.max(1, parseInt(process.env.KELLY_GROQ_MAX_RETRIES || '4', 10));
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await withTimeout(
        client.chat.completions.create({
          model,
          messages,
          tools: tools || [],
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens: tokens
        }),
        PROVIDER_TIMEOUT_MS,
        `Groq provider timeout after ${PROVIDER_TIMEOUT_MS}ms`
      );
    } catch (err) {
      lastErr = err;
      const status = err?.status ?? err?.statusCode ?? 0;
      const msg = String(err?.message || '').toLowerCase();
      const is429 = status === 429 || msg.includes('rate_limit') || msg.includes('rate limit');
      const isTooLarge =
        status === 413 || msg.includes('tokens per minute') || msg.includes('too large');
      if ((!is429 && !isTooLarge) || attempt >= maxAttempts) {
        throw err;
      }
      const delay = Math.min(
        12000,
        parseInt(process.env.KELLY_GROQ_RETRY_BASE_MS || '1200', 10) * Math.pow(2, attempt - 1)
      );
      console.warn('[LLMRouter] Groq busy (attempt %s/%s), waiting %sms: %s',
        attempt, maxAttempts, delay, err?.message || err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

module.exports = { call, resolvePrimaryProvider, withTimeout };
