/**
 * SSE stream parsing for checkout-chat Kelly turns.
 */
(function (global) {
  'use strict';

  /**
   * Parse one SSE chunk (may contain multiple events).
   * @returns {{ donePayload: object|null, doneHandled: boolean, error: Error|null }}
   */
  function parseCheckoutChatSseChunk(part, state, handlers) {
    const line = part.trim();
    if (!line.startsWith('data:')) return state;
    const jsonStr = line.replace(/^data:\s*/, '');
    let d;
    try {
      d = JSON.parse(jsonStr);
    } catch (_) {
      return state;
    }
    if (d.type === 'tool_status' && d.text && handlers.onToolStatus) {
      handlers.onToolStatus(String(d.text));
    }
    if (d.type === 'delta' && d.text && handlers.onDelta) {
      handlers.onDelta(String(d.text));
    }
    if (d.type === 'done') {
      if (state.doneHandled) return state;
      state.doneHandled = true;
      state.donePayload = d;
      if (state.donePayload && state.donePayload.reply && handlers.normalizeReply) {
        state.donePayload.reply = handlers.normalizeReply(state.donePayload.reply);
      }
      if (handlers.onDone) handlers.onDone(state.donePayload);
    }
    if (d.type === 'error') {
      state.error = new Error(d.error || 'Stream error');
    }
    return state;
  }

  /**
   * Read full SSE body from fetch Response body stream.
   */
  async function consumeCheckoutChatSseStream(reader, handlers) {
    const decoder = new TextDecoder();
    let buffer = '';
    let state = { donePayload: null, doneHandled: false, error: null };
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (let i = 0; i < parts.length; i++) {
        state = parseCheckoutChatSseChunk(parts[i], state, handlers);
        if (state.error) throw state.error;
      }
    }
    return state.donePayload;
  }

  global.SomoCheckoutChat = global.SomoCheckoutChat || {};
  global.SomoCheckoutChat.consumeCheckoutChatSseStream = consumeCheckoutChatSseStream;
})(typeof window !== 'undefined' ? window : global);
