function _arr(v) {
  return Array.isArray(v) ? v : [];
}

function fuseEvidence(input = {}) {
  const pathology = input.pathology || null;
  const records = input.records || null;
  const literature = input.literature || null;
  const vision = _arr(input.vision_tags);
  const ingredient = input.ingredient || null;
  const safety = String(input.safety_status || pathology?.safety_level || 'green').toLowerCase();

  const conflictFlags = [];
  if (safety === 'red' && ingredient) conflictFlags.push('safety_vs_commercial_conflict');
  if ((pathology?.confidence ?? 1) < 0.4) conflictFlags.push('low_pathology_confidence');

  const confidence = (() => {
    const p = Number(pathology?.confidence ?? pathology?.rag_confidence ?? 0.5);
    const v = vision.length > 0 ? 0.05 : 0;
    const r = records?.success ? 0.05 : 0;
    const l = literature?.success ? 0.02 : 0;
    return Math.max(0, Math.min(1, p + v + r + l));
  })();

  return {
    safety_status: safety,
    confidence,
    conflict_flags: conflictFlags,
    merged: {
      specialty: pathology?.specialty || pathology?.target_specialty || null,
      urgency: pathology?.urgency || null,
      risk_flags: _arr(pathology?.red_flags).concat(_arr(input.risk_flags)),
      vision_tags: vision,
      records_summary: records?.answer || null,
      literature_count: Array.isArray(literature?.articles) ? literature.articles.length : 0,
      ingredient_summary: ingredient?.success ? 'ingredient_context_available' : null
    }
  };
}

module.exports = {
  fuseEvidence
};
