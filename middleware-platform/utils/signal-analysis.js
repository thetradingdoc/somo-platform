/**
 * Signal analysis pre-step for triage RAG (M-S2.A)
 * Extracts lab values (AST, ALT, WBC, NLR, etc.) from clinical text,
 * computes key ratios, and returns a normalized block for LLM context.
 */

const LAB_PATTERNS = [
  { key: 'ast', regex: /\bAST\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:U\/L|IU\/L)?/i },
  { key: 'alt', regex: /\bALT\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:U\/L|IU\/L)?/i },
  { key: 'alp', regex: /\bALP\s*[=:]\s*(\d+(?:\.\d+)?)/i },
  { key: 'bilirubin', regex: /\b(?:total\s+)?bilirubin\s*[=:]\s*(\d+(?:\.\d+)?)/i },
  { key: 'wbc', regex: /\bWBC\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:\/\s*)?(?:μL|mcL)?/i },
  { key: 'rbc', regex: /\bRBC\s*[=:]\s*(\d+(?:\.\d+)?)/i },
  { key: 'hemoglobin', regex: /\b(?:Hgb|hemoglobin)\s*[=:]\s*(\d+(?:\.\d+)?)/i },
  { key: 'platelets', regex: /\b(?:plt|platelets?)\s*[=:]\s*(\d+(?:\.\d+)?)/i },
  { key: 'creatinine', regex: /\bcreatinine\s*[=:]\s*(\d+(?:\.\d+)?)/i },
  { key: 'glucose', regex: /\b(?:glucose|glu)\s*[=:]\s*(\d+(?:\.\d+)?)/i },
  { key: 'neutrophils', regex: /\bneutrophils?\s*[=:]\s*(\d+(?:\.\d+)?)\s*%?/i },
  { key: 'lymphocytes', regex: /\blymphocytes?\s*[=:]\s*(\d+(?:\.\d+)?)\s*%?/i }
];

function extractLabSignals(text) {
  if (!text || typeof text !== 'string') return {};
  const signals = {};
  for (const { key, regex } of LAB_PATTERNS) {
    const m = text.match(regex);
    if (m) signals[key] = parseFloat(m[1]);
  }
  return signals;
}

function computeRatios(signals) {
  const out = [];
  if (signals.ast != null && signals.alt != null && signals.alt > 0) {
    const ratio = (signals.ast / signals.alt).toFixed(2);
    out.push(`AST:ALT = ${ratio}`);
  }
  if (signals.neutrophils != null && signals.lymphocytes != null && signals.lymphocytes > 0) {
    const nlr = (signals.neutrophils / signals.lymphocytes).toFixed(2);
    out.push(`NLR = ${nlr}`);
  }
  return out;
}

/**
 * Normalize combined text for RAG: extract lab signals, compute ratios,
 * append structured block if any signals found.
 * @param {string} combinedText - Raw clinical text
 * @returns {string} Text with optional signal block appended
 */
function normalizeForRAG(combinedText) {
  const signals = extractLabSignals(combinedText);
  const keys = Object.keys(signals);
  if (keys.length === 0) return combinedText;

  const ratios = computeRatios(signals);
  const lines = ['Extracted lab values:'];
  keys.forEach(k => lines.push(`  ${k}: ${signals[k]}`));
  if (ratios.length) lines.push('Computed ratios: ' + ratios.join(', '));
  const block = lines.join('\n');
  return (combinedText + '\n\n' + block).trim();
}

module.exports = { extractLabSignals, computeRatios, normalizeForRAG };
