/**
 * Phase 4.3 — Chunk / source labels for UI and debug responses.
 */

/**
 * @param {Array<object>} passages
 * @param {object} [opts]
 * @param {boolean} [opts.debug] - Include text preview and full metadata
 * @param {number} [opts.previewChars]
 * @returns {Array<{ id: string|null, source_id: string|null, source_title: string|null, label: string, text_preview?: string, metadata?: object }>}
 */
function buildCitationList(passages, opts = {}) {
  const debug = !!opts.debug;
  const previewChars = opts.previewChars ?? 180;
  const list = [];
  let i = 0;
  for (const p of passages || []) {
    if (!p || typeof p !== 'object') continue;
    const id = p.id != null ? String(p.id) : null;
    const source_id = p.source_id != null ? String(p.source_id) : p.chunk_id != null ? String(p.chunk_id) : null;
    const source_title = (p.source_title || p.title || '').toString().trim() || null;
    const label = source_title || source_id || id || `source_${i + 1}`;
    const row = {
      id,
      source_id,
      source_title,
      label
    };
    if (debug) {
      const text = (p.text || p.passage || '').toString();
      row.text_preview = text.slice(0, previewChars) + (text.length > previewChars ? '…' : '');
      if (p.metadata && typeof p.metadata === 'object') row.metadata = p.metadata;
      if (typeof p.score === 'number') row.score = p.score;
      if (typeof p.rerank_score === 'number') row.rerank_score = p.rerank_score;
    }
    list.push(row);
    i += 1;
  }
  return list;
}

function formatCitationsBlock(citations) {
  if (!Array.isArray(citations) || citations.length === 0) return '(No labeled sources attached.)';
  return citations
    .map((c, i) => {
      const ref = [c.source_title, c.source_id, c.id].filter(Boolean).join(' — ');
      return `[${i + 1}] ${ref || c.label}`;
    })
    .join('\n');
}

module.exports = {
  buildCitationList,
  formatCitationsBlock
};
