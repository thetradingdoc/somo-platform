'use strict';

/** Gate medical-coding state machine off routine front-desk voice turns (Phase 6.6). */

const CODING_ADJACENT_RE =
  /\b(cpt|icd[- ]?10|hcpcs|billing code|diagnosis code|procedure code|suggest.?codes?|medical cod|codebook|codificar|c[oó]digo de procedimiento)\b/i;

function isCodingAdjacentUtterance(text) {
  const m = String(text || '').trim();
  if (!m) return false;
  if (CODING_ADJACENT_RE.test(m)) return true;
  if (/\b(код|коды|диагноз|процедур)\b/i.test(m) && /\b(медицин|страхов|cpt|icd)\b/i.test(m)) return true;
  return false;
}

function shouldRunCodingStateOnTranscript(text, connection = {}) {
  if (connection?.routing_world === 'platform_support') return false;
  if (connection?.call_type === 'platform_support') return false;
  return isCodingAdjacentUtterance(text);
}

module.exports = {
  isCodingAdjacentUtterance,
  shouldRunCodingStateOnTranscript
};
