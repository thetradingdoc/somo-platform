'use strict';

const Metrics = require('../shared/metrics');

/**
 * Speech observability — latency, RTF, STT confidence (G1 / S4–S6).
 */
function recordSttTurn(opts = {}) {
  const callId = String(opts.callId || '').trim();
  if (!callId) return;

  const confidence = Number(opts.confidence);
  const latencyMs = Number(opts.latencyMs);
  const audioDurationMs = Number(opts.audioDurationMs);
  const transcript = String(opts.transcript || '');

  Metrics.increment('voice.speech.stt_turns', 1);
  Metrics.increment(`voice.speech.call.${callId}.stt_turns`, 1);

  if (Number.isFinite(confidence)) {
    Metrics.increment('voice.speech.confidence_samples', 1);
    Metrics.gauge('voice.speech.confidence_last', confidence);
    if (confidence < 0.6) {
      Metrics.increment('voice.speech.low_confidence_turns', 1);
    }
  }

  if (Number.isFinite(latencyMs) && latencyMs >= 0) {
    Metrics.increment('voice.speech.end_of_turn_latency_ms_total', Math.round(latencyMs));
    Metrics.increment('voice.speech.end_of_turn_samples', 1);
  }

  if (Number.isFinite(audioDurationMs) && audioDurationMs > 0 && Number.isFinite(latencyMs)) {
    const rtf = latencyMs / audioDurationMs;
    Metrics.gauge('voice.speech.rtf_last', rtf);
    Metrics.increment('voice.speech.rtf_samples', 1);
  }

  if (transcript) {
    Metrics.increment('voice.speech.transcript_chars', transcript.length);
  }
}

function recordAssistantLatency(opts = {}) {
  const callId = String(opts.callId || '').trim();
  const latencyMs = Number(opts.latencyMs);
  if (!callId || !Number.isFinite(latencyMs)) return;
  Metrics.increment('voice.speech.assistant_latency_ms_total', Math.round(latencyMs));
  Metrics.increment(`voice.speech.call.${callId}.assistant_latency_ms_total`, Math.round(latencyMs));
}

module.exports = { recordSttTurn, recordAssistantLatency };
