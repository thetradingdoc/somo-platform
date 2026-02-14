# Layer 1: Multimodal Perception Layer
## Implementation Guide

**Source**: [MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md](./MULTIMODAL_MEDICAL_AI_ARCHITECTURE.md)  
**Status**: Implemented — `middleware-platform/services/perception-layer/`

---

## Overview

Layer 1 transforms raw multimodal clinical data into a structured **perceptual state** with:
- Visual findings (bounding boxes, confidence, evidence_strength)
- Textual findings (NER entities, severity, temporal)
- Cross-modal links (alignment scores, conflict detection)
- Audit trail for downstream coding

---

## Architecture Summary

| Component | Model/Service | Purpose |
|-----------|---------------|---------|
| **Vision Encoder** | GPT-4o (OpenAI or Azure) | Extract findings from X-ray, MRI, dermatology images |
| **Text Encoder** | medical-text-extraction + medical-abbreviations.json | NER, abbreviation expansion, vitals, temporal, laterality |
| **Audio Encoder** | Not implemented | TODO: Deepgram nova-2-medical (optional) |
| **Cross-Attention** | GPT-4o | Fuse visual + text, compute alignment scores |
| **Perceptual State Builder** | Orchestrator | Combine all outputs, confidence scores, human-review flags |

---

## File Structure (implemented)

```
middleware-platform/
├── services/
│   └── perception-layer/
│       ├── vision-encoder.js          # GPT-4o image analysis (xray, mri, dermatology)
│       ├── text-encoder.js            # NER + medical-abbreviations, temporal, laterality
│       ├── cross-attention.js         # Cross-modal fusion via GPT-4o
│       ├── image-preprocessor.js      # sharp: validate, resize, normalize
│       ├── perceptual-state-builder.js# Main orchestrator, specialty inference, review flags
│       └── index.js                   # Export buildPerceptualState()
└── Knowledge/
    └── ontology/
        ├── medical-abbreviations.json # SOB → shortness of breath, FOOSH, etc.
        ├── extraction-patterns.json   # (existing)
        ├── medical-entities.json      # (existing)
        └── severity-indicators.json   # (existing)
```

**Note**: Audio encoder is a placeholder (not implemented). Image preprocessor lives inside perception-layer.

---

## Environment Variables

```bash
# OpenAI (GPT-4o vision + cross-modal)
OPENAI_API_KEY=sk-...

# Azure OpenAI (alternative, for HIPAA)
# AZURE_OPENAI_API_KEY=
# AZURE_OPENAI_ENDPOINT=
# AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o
# AZURE_OPENAI_API_VERSION=2024-02-15-preview

# Deepgram (optional, for audio)
# DEEPGRAM_API_KEY=

# Hugging Face (optional, for ClinicalBERT)
# HUGGINGFACE_TOKEN=
```

---

## Perceptual State JSON Schema

```json
{
  "call_id": "string",
  "timestamp": "ISO8601",
  "modality": "xray|mri|dermatology",
  "visual_findings": [
    {
      "finding": "cortical_discontinuity",
      "body_region": "distal_radius",
      "laterality": "right",
      "bounding_box": [120, 340, 280, 450],
      "confidence": 0.92,
      "evidence_strength": "definitive|probable|possible|absent",
      "details": {}
    }
  ],
  "textual_findings": [
    {
      "type": "symptom|anatomy|vitals",
      "concept": "wrist_pain",
      "mention": "wrist pain",
      "confidence": 0.95,
      "severity": "moderate",
      "laterality": "right"
    }
  ],
  "cross_modal_links": [
    {
      "text_concept": "wrist_pain",
      "visual_finding": "cortical_discontinuity",
      "alignment_score": 0.95,
      "alignment_type": "strong_match|moderate_match|text_only|conflict",
      "supporting_evidence": "string"
    }
  ],
  "audio_metadata": null,
  "confidence_scores": {
    "vision_confidence": 0.9,
    "text_confidence": 0.85,
    "cross_modal_confidence": 0.9,
    "overall_confidence": 0.88
  },
  "specialty_tag": "orthopedics|cardiology|dermatology|neurology|pulmonology|gastroenterology|emergency|general",
  "expanded_text": "Clinical text with abbreviations expanded (SOB→shortness of breath)",
  "requires_human_review": {
    "flag": false,
    "reasons": [],
    "severity": "CRITICAL|WARNING|null"
  },
  "processing_metadata": { "vision_ms": 1200, "text_ms": 80, "fusion_ms": 800, "total_ms": 2080 }
}
```

---

## Implementation Phases

### Phase 1: Text-Only ✅ Done
- Route PDF and voice through `medical-text-extraction-service` before coding.
- Map output to `textual_findings` schema (symptoms, vitals, severity, temporal).
- Abbreviation expansion via `medical-abbreviations.json` (SOB, FOOSH, CP, etc.).
- `visual_findings` = [], `cross_modal_links` = [] when no image.

### Phase 2: Vision Encoder ✅ Done
- `vision-encoder.js` uses GPT-4o with `HumanMessage` + `image_url`.
- Modality-specific prompts (xray, mri, dermatology).
- Preprocess with `sharp` in `image-preprocessor.js`: validate (≥10KB, ≥256×256), normalize, resize 1024×1024.
- Graceful degradation: if vision fails (API/parse error), continues with text-only.

### Phase 3: Cross-Attention Fusion ✅ Done
- When both visual and textual findings exist, GPT-4o fuses modalities.
- Produces `cross_modal_links` with alignment_score, alignment_type, supporting_evidence.
- Conflict detection (laterality mismatch, low alignment) → `requires_human_review` with severity (CRITICAL/WARNING).

### Phase 4: Audio (not implemented)
- TODO: Deepgram `nova-2-medical` for audio STT.
- Speaker diarization → identify patient vs physician.

---

## Integration

Layer 1 is used by `coding-orchestrator` and `pdf-coding-service`. For LangGraph, it would be the `perceive` node:

```javascript
const { buildPerceptualState } = require('./services/perception-layer');

graph.addNode('perceive', async (state) => {
  const perceptualState = await buildPerceptualState({
    callId: state.call_id,
    imagePath: state.images?.[0],
    clinicalText: state.clinical_text,
    audioPath: state.audio_path,
    modality: state.modality || 'xray'
  });
  return { perceptual_state: perceptualState, current_stage: 'PERCEPTION_COMPLETE' };
});
```

---

## Suggested Enhancements (from architecture review)

1. **Temporal Attention**: For video/gait analysis, add temporal dimension to cross-attention.
2. **Negative Constraint**: Add "negative_constraint" field (e.g., "No vascular compromise").
3. **Multi-slice MRI**: Aggregate findings across slices into single visual_findings object.

---

## Perceptual Gap Fix (Implemented)

Perception now feeds the coder:
- `runCodingPipeline` passes `perceptualState` to `generateCodingSuggestion`
- Evidence-augmented prompt: visual findings prioritized as grounding truth
- `cross_modal_links` mapped into `rationale` + `evidenceTrace` for audit
- `specialty_tag` derived from findings for future RAG routing

---

## Current vs Target

| Input | Current (Layer 1 implemented) |
|-------|-------------------------------|
| Voice / PDF | Clinical text → text encoder (with abbreviation expansion) → perceptual state |
| Image | Vision encoder (GPT-4o) → perceptual state; graceful fallback if API/parse fails |
| Image + Text | Vision + Text → Cross-attention → perceptual state with alignment scores |

---

## Dependencies

- `sharp` — image preprocessing (already installed)
- `@langchain/openai`, `@langchain/core` — GPT-4o vision and cross-attention (already present)

---

## Testing

Run `buildPerceptualState` with `clinicalText` and optionally `imagePath`. No test harness in repo (tests removed). Manual verification:

- Text-only: `buildPerceptualState({ callId, clinicalText, modality: 'text' })`
- Multimodal: `buildPerceptualState({ callId, clinicalText, imagePath, modality: 'xray' })`
- Validation: cross_modal_links alignment_score > 0.7 for strong matches; `requires_human_review` flags laterality conflicts
