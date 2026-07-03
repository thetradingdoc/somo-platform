'use strict';

const { displayName } = require('./kelly-rails/language');
const { DEFAULT_KELLY_ASR_MIN_CONFIDENCE } = require('../config/voice-thresholds');

function minAsrConfidence() {
  const raw = process.env.KELLY_ASR_MIN_CONFIDENCE;
  const value = raw === undefined || raw === '' ? String(DEFAULT_KELLY_ASR_MIN_CONFIDENCE) : raw;
  const v = parseFloat(value);
  return Number.isFinite(v) ? v : null;
}

function extractAsrConfidence(metadata = {}) {
  if (metadata == null || typeof metadata !== 'object') return null;
  const candidates = [
    metadata.confidence,
    metadata.asr_confidence,
    metadata.transcript_confidence,
    metadata.stt_confidence
  ];
  for (const c of candidates) {
    const n = parseFloat(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractAsrLanguage(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') return null;
  const lang = metadata.language || metadata.detected_language || metadata.asr_language;
  return lang ? String(lang).slice(0, 8) : null;
}

function pickFiniteNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/**
 * Extract end-of-turn latency and audio duration from Retell WS metadata.
 */
function extractAsrTiming(metadata = {}, opts = {}) {
  const latencyMs = pickFiniteNumber(
    metadata.latency_ms,
    metadata.transcript_latency_ms,
    metadata.stt_latency_ms,
    metadata.end_of_turn_latency_ms,
    opts.fallbackLatencyMs
  );
  const audioDurationMs = pickFiniteNumber(
    metadata.audio_duration_ms,
    metadata.duration_ms,
    metadata.utterance_duration_ms,
    metadata.speech_duration_ms,
    opts.fallbackAudioDurationMs
  );
  return { latencyMs, audioDurationMs };
}

function clarifyReply(locale) {
  const code = String(locale || 'en').slice(0, 2);
  if (code === 'es') {
    return 'No pude escuchar bien. ¿Puede repetir eso un poco más despacio, por favor?';
  }
  if (code === 'pt') {
    return 'Não consegui ouvir bem. Pode repetir um pouco mais devagar, por favor?';
  }
  return "I didn't catch that clearly. Could you repeat that a little slower, please?";
}

/**
 * @returns {{ allow: boolean, confidence: number|null, clarifyReply: string|null, asrLanguage: string|null }}
 */
function evaluateAsr(transcript, metadata = {}, opts = {}) {
  const threshold = minAsrConfidence();
  const confidence = extractAsrConfidence(metadata);
  const asrLanguage = extractAsrLanguage(metadata);
  const locale = opts.locale || 'en';

  try {
    const { recordSttTurn } = require('./voice-speech-metrics');
    recordSttTurn({
      callId: opts.callId,
      confidence,
      transcript,
      latencyMs: opts.latencyMs,
      audioDurationMs: opts.audioDurationMs
    });
  } catch (_) { /* non-fatal */ }

  if (threshold == null || confidence == null) {
    return { allow: true, confidence, clarifyReply: null, asrLanguage };
  }

  if (confidence >= threshold) {
    return { allow: true, confidence, clarifyReply: null, asrLanguage };
  }

  return {
    allow: false,
    confidence,
    clarifyReply: clarifyReply(locale),
    asrLanguage
  };
}

module.exports = {
  minAsrConfidence,
  evaluateAsr,
  extractAsrConfidence,
  extractAsrLanguage,
  extractAsrTiming,
  clarifyReply,
  displayName
};
