/**
 * Negative Constraint Extraction - Layer 2 RAG
 *
 * Extracts "no X" style findings to exclude codes that contradict the note.
 * Example: "no open wound" → exclude codes containing "open" in wound context.
 * Prevents coding "open fracture" when note says "closed".
 */

const NEGATION_PATTERNS = [
  /\bno\s+(open|closed|acute|chronic|evidence\s+of)\s+([a-z\s]+)/gi,
  /\bdenies\s+([a-z\s]+)/gi,
  /\bwithout\s+([a-z\s]+)/gi,
  /\bruled\s+out\s+([a-z\s]+)/gi,
  /\bnegative\s+for\s+([a-z\s]+)/gi,
  /\bno\s+([a-z]+)\s+(wound|fracture|dislocation|bleeding|infection)/gi
];

const EXCLUSION_TERM_MAP = {
  open: ['open'],
  closed: ['open'], // "no open" / "closed" → exclude "open" codes
  acute: ['acute'],
  chronic: ['chronic'],
  wound: ['open', 'laceration', 'puncture'],
  fracture: ['open'],
  infection: ['infection', 'infected', 'sepsis']
};

/**
 * Extract negative constraints from clinical text.
 * Returns terms that should cause codes to be excluded when present in code description.
 *
 * @param {string} text - Raw clinical note text
 * @returns {string[]} - Terms to exclude (e.g. ['open', 'infection'])
 */
function extractNegativeConstraints(text) {
  if (!text || typeof text !== 'string') return [];
  const terms = new Set();
  const t = text.slice(0, 8000);

  for (const pattern of NEGATION_PATTERNS) {
    let m;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((m = re.exec(t)) !== null) {
      const matched = (m[1] || m[2] || '').toLowerCase().trim();
      const words = matched.split(/\s+/).filter(w => w.length > 2);
      for (const w of words) {
        terms.add(w);
      }
      const expansion = EXCLUSION_TERM_MAP[matched.split(/\s+/)[0]];
      if (expansion) {
        expansion.forEach(e => terms.add(e));
      }
    }
  }

  // Common negation phrases
  if (/\bclosed\s+fracture\b/i.test(t)) terms.add('open');
  if (/\bno\s+open\b/i.test(t)) terms.add('open');
  if (/\bdenies\s+chest\s+pain\b/i.test(t)) terms.add('angina');
  if (/\bno\s+infection\b/i.test(t)) terms.add('infection');

  return Array.from(terms).filter(term => term.length > 2);
}

/**
 * Filter code candidates by negative constraints.
 * Removes codes whose description contains any exclusion term.
 *
 * @param {Array<{code, description, ...}>} codes - Code candidates
 * @param {string[]} negativeConstraints - Terms to exclude
 * @returns {Array<{code, description, ...}>} - Filtered codes
 */
function filterCodesByNegativeConstraints(codes, negativeConstraints) {
  if (!Array.isArray(codes) || codes.length === 0) return codes;
  if (!Array.isArray(negativeConstraints) || negativeConstraints.length === 0) return codes;

  return codes.filter(c => {
    const desc = ((c.description || '') + ' ' + (c.code || '')).toLowerCase();
    const exclude = negativeConstraints.some(term => {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return re.test(desc);
    });
    return !exclude;
  });
}

module.exports = {
  extractNegativeConstraints,
  filterCodesByNegativeConstraints
};
