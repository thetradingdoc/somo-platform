'use strict';

/**
 * Single source of truth for coding / triage confidence gates (Phase 1).
 */

const CODING_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.CODING_CONFIDENCE_THRESHOLD
    || process.env.TRIAGE_CONFIDENCE_GATE
    || process.env.RAG_CONFIDENCE_THRESHOLD
    || '0.65',
  10
);

const BORDERLINE_WINDOW = parseFloat(process.env.CODING_BORDERLINE_WINDOW || '0.2', 10);

/** Confidence written to triage spine after HITL approval (must exceed gate). */
const CODING_HITL_APPROVED_CONFIDENCE = parseFloat(
  process.env.CODING_HITL_APPROVED_CONFIDENCE || '0.85',
  10
);

/** Confidence assigned to E/M codes inferred from ICD when Pinecone returns no CPT. */
const CPT_INFERENCE_CONFIDENCE = parseFloat(
  process.env.CPT_INFERENCE_CONFIDENCE || String(CODING_CONFIDENCE_THRESHOLD),
  10
);

function isConfidenceNearThreshold(confidence, threshold = CODING_CONFIDENCE_THRESHOLD) {
  return (confidence || 0) >= Math.max(0, threshold - BORDERLINE_WINDOW);
}

module.exports = {
  CODING_CONFIDENCE_THRESHOLD,
  BORDERLINE_WINDOW,
  CODING_HITL_APPROVED_CONFIDENCE,
  CPT_INFERENCE_CONFIDENCE,
  isConfidenceNearThreshold
};
