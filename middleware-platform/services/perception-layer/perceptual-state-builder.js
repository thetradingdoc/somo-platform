/**
 * Perceptual State Builder - Layer 1 Perception
 *
 * Orchestrates vision encoder, text encoder, and cross-attention fusion.
 * Outputs perceptual state JSON for downstream coding agents.
 * Supports imagePath (file) or imageBase64 (video consult frames from LiveKit).
 */

const visionEncoder = require('./vision-encoder');
const frameStorage = require('../platform/frame-storage-service');
const textEncoder = require('./text-encoder');
const crossAttention = require('./cross-attention');

/**
 * Infer region from clinic (for regional policy routing).
 * @param {string|null} clinicId - Clinic ID
 * @returns {string} Region code (US, UK, ZA)
 */
function inferRegion(clinicId) {
  if (!clinicId) return 'US';
  try {
    const db = require('../../database');
    const clinic = typeof db.getClinicById === 'function' ? db.getClinicById(clinicId) : null;
    if (!clinic) return 'US';
    const region = (clinic.region || clinic.country_code || '').toString().trim().toUpperCase();
    if (region === 'UK' || region === 'GB') return 'UK';
    if (region === 'ZA') return 'ZA';
    return region || 'US';
  } catch (_) {
    return 'US';
  }
}

function calculateConfidenceScores(state) {
  const scores = {
    vision_confidence: 0,
    text_confidence: 0,
    cross_modal_confidence: 0,
    overall_confidence: 0
  };

  if (state.visual_findings?.length > 0) {
    const sum = state.visual_findings.reduce((a, f) => a + (f.confidence ?? 0.5), 0);
    scores.vision_confidence = sum / state.visual_findings.length;
  }

  if (state.textual_findings?.length > 0) {
    const sum = state.textual_findings.reduce((a, f) => a + (f.confidence ?? 0.5), 0);
    scores.text_confidence = sum / state.textual_findings.length;
  }

  if (state.alignment_metrics) {
    scores.cross_modal_confidence = state.alignment_metrics.overall_confidence ?? 0.5;
  }

  // Text-only: use text confidence. Multimodal: weighted blend
  const hasVision = state.visual_findings?.length > 0;
  const hasCrossModal = state.cross_modal_links?.length > 0;
  if (!hasVision && !hasCrossModal) {
    scores.overall_confidence = scores.text_confidence || 0.5;
  } else {
    const weights = { vision: 0.3, text: 0.2, cross_modal: 0.5 };
    scores.overall_confidence =
      scores.vision_confidence * weights.vision +
      scores.text_confidence * weights.text +
      scores.cross_modal_confidence * weights.cross_modal;
  }

  return scores;
}

/**
 * Infer specialty from visual and textual findings for RAG routing (scoring-based)
 */
function inferSpecialtyFromFindings(state) {
  const v = state.visual_findings || [];
  const t = state.textual_findings || [];
  const allConcepts = [
    ...v.map((f) => (f.finding || '').toLowerCase()),
    ...v.map((f) => (f.body_region || '').toLowerCase()),
    ...t.map((f) => (f.concept || '').toLowerCase()),
    ...t.map((f) => (f.mention || '').toLowerCase())
  ].filter(Boolean);
  const text = allConcepts.join(' ');

  const specialtyMap = {
    orthopedics: ['fracture', 'dislocation', 'sprain', 'bone', 'joint', 'radius', 'ulna', 'femur', 'tibia', 'humerus', 'clavicle', 'wrist', 'ankle', 'knee', 'spine'],
    cardiology: ['heart', 'cardiac', 'chest_pain', 'mi', 'myocardial', 'angina', 'arrhythmia', 'cardiomegaly', 'palpitation'],
    dermatology: ['skin', 'lesion', 'rash', 'melanoma', 'dermatitis', 'ulcer', 'nodule', 'dermatology'],
    neurology: ['brain', 'stroke', 'seizure', 'headache', 'migraine', 'concussion', 'hemorrhage', 'neuro'],
    pulmonology: ['lung', 'pneumonia', 'sob', 'respiratory', 'asthma', 'copd', 'pleural', 'breathing'],
    gastroenterology: ['abdomen', 'liver', 'gallbladder', 'bowel', 'stomach', 'intestine', 'gerd', 'nausea', 'vomiting', 'diarrhea', 'constipation', 'ibs', 'ibd'],
    emergency: ['severe', 'acute', 'emergent', 'trauma', 'hemorrhage', 'shock']
  };

  const scores = {};
  for (const [specialty, keywords] of Object.entries(specialtyMap)) {
    scores[specialty] = keywords.filter((kw) => text.includes(kw)).length;
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted[0][1] > 0 ? sorted[0][0] : 'general';
}

function shouldFlagForReview(state) {
  const reasons = [];
  const criticalReasons = ['cross_modal_conflict', 'laterality_conflict'];

  if (state.confidence_scores?.overall_confidence < 0.7) {
    reasons.push('low_confidence');
  }
  if (state.alignment_metrics?.conflicts > 0) {
    reasons.push('cross_modal_conflict');
  }
  if (state.alignment_metrics?.average_alignment_score != null && state.alignment_metrics.average_alignment_score < 0.6) {
    reasons.push('weak_cross_modal_alignment');
  }

  const visualLat = state.visual_findings?.find((f) => f.laterality)?.laterality;
  const textLat = state.textual_findings?.find((f) => f.laterality)?.laterality;
  if (visualLat && !textLat) {
    reasons.push('laterality_mismatch');
  }
  if (visualLat && textLat && visualLat.toLowerCase() !== textLat.toLowerCase()) {
    reasons.push('laterality_conflict');
  }

  const hasInjuryMention = state.textual_findings?.some(
    (f) => f.concept?.includes('fracture') || f.concept?.includes('injury')
  );
  if (hasInjuryMention && (!state.visual_findings || state.visual_findings.length === 0)) {
    reasons.push('expected_visual_finding_absent');
  }

  const hasCritical = reasons.some((r) => criticalReasons.includes(r));
  return {
    flag: reasons.length > 0,
    reasons,
    severity: hasCritical ? 'CRITICAL' : reasons.length > 0 ? 'WARNING' : null
  };
}

/**
 * Build complete perceptual state from multimodal inputs
 * @param {object} inputs - { callId, imagePath, clinicalText, audioPath, modality }
 * @returns {Promise<object>} perceptual state
 */
async function buildPerceptualState(inputs) {
  const {
    callId = 'unknown',
    imagePath,
    imageBase64,
    clinicalText,
    audioPath,
    modality = 'xray',
    clinicId = null
  } = inputs;

  let effectiveImagePath = imagePath;
  let tempCleanup = null;
  if (!effectiveImagePath && imageBase64) {
    try {
      const { path: p, cleanup } = await frameStorage.writeFrame(
        imageBase64,
        imageBase64.startsWith('data:image/png') ? '.png' : '.jpg'
      );
      effectiveImagePath = p;
      tempCleanup = cleanup;
    } catch (e) {
      console.warn(`[${callId}] Frame storage failed (continuing text-only):`, e.message);
    }
  }

  const state = {
    call_id: callId,
    timestamp: new Date().toISOString(),
    modality,
    visual_findings: [],
    textual_findings: [],
    negative_findings: [],
    audio_metadata: null,
    cross_modal_links: [],
    alignment_metrics: null,
    confidence_scores: {},
    requires_human_review: { flag: false, reasons: [] },
    processing_metadata: {}
  };

  try {
    // 1. Vision (graceful degradation on API/parse errors)
    if (effectiveImagePath) {
      const t0 = Date.now();
      try {
        state.visual_findings = await visionEncoder.extractVisualFindings(
          effectiveImagePath,
          modality,
          clinicalText ? { chief_complaint: clinicalText.substring(0, 200) } : null
        );
      } catch (visionErr) {
        console.warn(`[${callId}] Vision encoding failed (continuing with text-only):`, visionErr.message);
        state.visual_findings = [];
      }
      state.processing_metadata.vision_ms = Date.now() - t0;
    }

    // 2. Audio: not implemented yet; treat audioPath as future STT input
    let fullText = clinicalText || '';
    if (audioPath) {
      // TODO: Deepgram STT
      state.audio_metadata = { status: 'not_implemented', path: audioPath };
    }

    // 3. Text
    if (fullText) {
      const t1 = Date.now();
      const textResult = textEncoder.extractTextualFindings(fullText);
      state.textual_findings = textResult.findings || [];
      state.expanded_text = textResult.expanded_text || fullText;
      const negResult = textEncoder.extractNegativeFindings(fullText);
      state.negative_findings = negResult.exclusion_keywords || [];
      state.processing_metadata.text_ms = Date.now() - t1;
    }

    // 3b. Region tag (for regional policy routing)
    state.region_tag = inferRegion(clinicId);

    // 4. Cross-modal fusion
    if (
      state.visual_findings.length > 0 &&
      state.textual_findings.length > 0
    ) {
      const t2 = Date.now();
      const fusion = await crossAttention.fuseModalities(
        state.visual_findings,
        state.textual_findings,
        effectiveImagePath
      );
      state.cross_modal_links = fusion.cross_modal_links || [];
      state.alignment_metrics = fusion.alignment_metrics || null;
      state.processing_metadata.fusion_ms = Date.now() - t2;
    }

    // 5. Specialty tag (for RAG routing)
    state.specialty_tag = inferSpecialtyFromFindings(state);

    // 6. Confidence & review
    state.confidence_scores = calculateConfidenceScores(state);
    state.requires_human_review = shouldFlagForReview(state);
    state.processing_metadata.total_ms =
      (state.processing_metadata.vision_ms || 0) +
      (state.processing_metadata.audio_ms || 0) +
      (state.processing_metadata.text_ms || 0) +
      (state.processing_metadata.fusion_ms || 0);

    return state;
  } catch (err) {
    console.error(`[${callId}] Perceptual state error:`, err);
    throw new Error(`Failed to build perceptual state: ${err.message}`);
  } finally {
    if (tempCleanup) await tempCleanup();
  }
}

module.exports = {
  buildPerceptualState,
  calculateConfidenceScores,
  shouldFlagForReview,
  inferRegion
};
