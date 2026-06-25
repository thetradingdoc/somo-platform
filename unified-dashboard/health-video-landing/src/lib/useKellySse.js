import { useEffect, useRef } from 'react';

export function createSseClient({ url, onPatientLine, onAssistantLine, onThinking, onToolEvent, onRisk, onMemoryHighlight }) {
  let evtSource = null;
  let backoff = 1000;
  let closed = false;
  let reconnectTimer = null;

  function connect() {
    if (closed) return;
    evtSource = new EventSource(url);

    evtSource.addEventListener('transcript_delta', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const items = data.payload?.transcript_delta || data.transcript_delta || data.items || [];
        items.forEach((d) => {
          if (!d.text) return;
          if (d.speaker === 'assistant') onAssistantLine?.(d.text);
          else if (d.speaker === 'patient' || d.speaker === 'user') onPatientLine?.(d.text);
        });
      } catch (_) {}
    });

    evtSource.addEventListener('assistant_update', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const payload = data.payload || data;
        const deltas = payload.transcript_delta || [];
        deltas.forEach((d) => {
          if (!d.text) return;
          if (d.speaker === 'assistant') onAssistantLine?.(d.text);
          else if (d.speaker === 'patient' || d.speaker === 'user') onPatientLine?.(d.text);
        });
        if (payload.risk) onRisk?.(payload.risk);
      } catch (_) {}
    });

    evtSource.addEventListener('assistant_message', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const payload = data.payload || data;
        if (payload.status === 'thinking') onThinking?.();
        if (payload.status === 'complete' && payload.text) onAssistantLine?.(payload.text);
      } catch (_) {}
    });

    evtSource.addEventListener('tool_event', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        onToolEvent?.(data.payload || data);
      } catch (_) {}
    });

    evtSource.addEventListener('risk_alert', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        onRisk?.(data.payload || data);
      } catch (_) {}
    });

    evtSource.addEventListener('memory_highlight', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        onMemoryHighlight?.(data.payload || data);
      } catch (_) {}
    });

    evtSource.onerror = () => {
      evtSource?.close();
      evtSource = null;
      if (closed) return;
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, 30000);
        connect();
      }, backoff);
    };
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      evtSource?.close();
    }
  };
}

export function useKellySse({ url, enabled, handlers }) {
  const clientRef = useRef(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || !url) return undefined;
    clientRef.current = createSseClient({
      url,
      onPatientLine: (t) => handlersRef.current.onPatientLine?.(t),
      onAssistantLine: (t) => handlersRef.current.onAssistantLine?.(t),
      onThinking: () => handlersRef.current.onThinking?.(),
      onToolEvent: (p) => handlersRef.current.onToolEvent?.(p),
      onRisk: (r) => handlersRef.current.onRisk?.(r),
      onMemoryHighlight: (m) => handlersRef.current.onMemoryHighlight?.(m)
    });
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [url, enabled]);

  return clientRef;
}
