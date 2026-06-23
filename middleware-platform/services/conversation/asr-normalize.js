'use strict';

/**
 * ASR transcript normalization for intent detection ONLY.
 * Does not mutate stored conversation history.
 */

const FILLER_WORDS = [
  'um',
  'uh',
  'er',
  'ah',
  'like',
  'you know',
  'i mean',
  'eh',
  'este',
  'pues',
  'o sea',
  'entonces'
];

const MIN_TOKENS_FOR_PARTIAL = 2;

function stripFillers(text) {
  let out = String(text || '');
  for (const f of FILLER_WORDS) {
    const re = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[,\\s]*`, 'gi');
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function normalizePunctuation(text) {
  return String(text || '')
    .replace(/\.{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([,.!?])([^\s])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyPartialUtterance(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/\.{2,}$/.test(t)) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  return tokens.length < MIN_TOKENS_FOR_PARTIAL && !/\b(yes|no|sí|si|cancel|book|pay)\b/i.test(t);
}

/**
 * @returns {{ normalized: string, wasPartial: boolean, original: string }}
 */
function normalizeForIntentDetection(utterance) {
  const original = String(utterance || '').trim();
  if (!original) {
    return { normalized: '', wasPartial: true, original };
  }
  let normalized = stripFillers(original);
  normalized = normalizePunctuation(normalized);
  const wasPartial = isLikelyPartialUtterance(original);
  return { normalized: normalized || original, wasPartial, original };
}

module.exports = {
  normalizeForIntentDetection,
  stripFillers,
  normalizePunctuation,
  isLikelyPartialUtterance,
  FILLER_WORDS
};
