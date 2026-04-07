function _arr(v) {
  return Array.isArray(v) ? v : [];
}

function _evidenceRefs(input = {}) {
  const refs = [];
  if (input.pathology?.source) refs.push({ type: 'pathology', ref: input.pathology.source });
  if (input.records?.success) refs.push({ type: 'records', ref: 'patient_records' });
  if (input.literature?.success) refs.push({ type: 'literature', ref: 'pubmed' });
  if (_arr(input.vision_tags).length) refs.push({ type: 'vision', ref: 'vision_tags' });
  return refs;
}

function buildBillingReadinessPack(input = {}) {
  const icd10 = _arr(input?.codes?.icd10 || input?.rag_context?.icd10 || []);
  const cpt = _arr(input?.codes?.cpt || input?.rag_context?.cpt || []);
  const hcpcs = _arr(input?.codes?.hcpcs || input?.rag_context?.hcpcs || []);
  const confidence = Number(
    input?.confidence ??
    input?.evidence_fusion?.confidence ??
    input?.rag_context?.rag_confidence ??
    0
  );
  return {
    generated_at: new Date().toISOString(),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    icd10_candidates: icd10.slice(0, 15),
    cpt_candidates: cpt.slice(0, 10),
    hcpcs_candidates: hcpcs.slice(0, 8),
    supporting_evidence_refs: _evidenceRefs(input),
    audit: {
      source: input.source || 'unknown',
      trace_id: input.trace_id || null,
      session_id: input.session_id || null,
      room_id: input.room_id || null,
      policy_version: 'phase9-v1'
    }
  };
}

module.exports = {
  buildBillingReadinessPack
};
