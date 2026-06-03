'use strict';

const { displayName } = require('./kelly-rails/language');

function minAsrConfidence() {
  const raw = process.env.KELLY_ASR_MIN_CONFIDENCE;
  if (raw === undefined || raw === '') return null;
  const v = parseFloat(raw);
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
  clarifyReply,
  displayName
};
