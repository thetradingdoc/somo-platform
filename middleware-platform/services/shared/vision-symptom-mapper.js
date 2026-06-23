const DEFAULT_MIN_CONFIDENCE = Number(process.env.VISION_SYMPTOM_MIN_CONFIDENCE || 0.45);
const ICD_GATE_MIN_CONFIDENCE = Number(process.env.VISION_ICD_GATE_MIN_CONFIDENCE || 0.55);

const LABEL_MAP = {
  acne: 'acneiform eruption',
  pimple: 'papular eruption',
  papule: 'papular eruption',
  pustule: 'pustular lesion',
  nodule: 'cutaneous nodule',
  cyst: 'cutaneous cyst',
  abscess: 'possible abscess',
  comedone: 'comedonal acne',
  blackhead: 'comedonal acne',
  whitehead: 'comedonal acne',
  rash: 'skin rash',
  erythema: 'erythematous rash',
  redness: 'localized erythema',
  inflammation: 'inflammatory skin change',
  dermatitis: 'dermatitis pattern',
  eczema: 'eczematous dermatitis',
  psoriasis: 'psoriasiform plaque',
  plaque: 'raised plaque lesion',
  scale: 'scaly lesion',
  scaling: 'scaly lesion',
  dry_skin: 'xerosis',
  xerosis: 'xerosis',
  fissure: 'skin fissure',
  crack: 'skin fissure',
  ulcer: 'skin ulcer',
  erosion: 'superficial erosion',
  wound: 'open skin lesion',
  laceration: 'skin laceration',
  bruise: 'ecchymosis',
  ecchymosis: 'ecchymosis',
  petechiae: 'petechial rash',
  purpura: 'purpuric rash',
  blister: 'vesicular lesion',
  vesicle: 'vesicular lesion',
  bulla: 'bullous lesion',
  crust: 'crusted lesion',
  scab: 'crusted lesion',
  scar: 'scar tissue',
  keloid: 'keloid scar',
  burn: 'burn injury',
  sunburn: 'sunburn',
  hyperpigmentation: 'hyperpigmented patch',
  hypopigmentation: 'hypopigmented patch',
  melasma: 'facial hyperpigmentation',
  nevus: 'pigmented nevus',
  mole: 'pigmented nevus',
  lesion: 'cutaneous lesion',
  swelling: 'localized swelling',
  edema: 'localized edema',
  cellulitis: 'possible cellulitis',
  infection: 'possible skin infection',
  folliculitis: 'folliculitis pattern',
  rosacea: 'rosacea pattern',
  wart: 'verrucous lesion',
  verruca: 'verrucous lesion',
  skin_tag: 'acrochordon',
  acrochordon: 'acrochordon',
  angioma: 'vascular papule',
  hemangioma: 'vascular lesion'
};

const REGION_TO_TEXT = {
  forehead: 'forehead',
  cheek_left: 'left cheek',
  cheek_right: 'right cheek',
  chin: 'chin',
  neck: 'neck',
  arm: 'arm',
  leg: 'leg',
  trunk: 'trunk',
  scalp: 'scalp',
  other: 'other body region'
};

function norm(value) {
  return String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
}

function mapLabelToSymptom(label) {
  const key = norm(label);
  return LABEL_MAP[key] || String(label || '').toLowerCase().replace(/_/g, ' ').trim();
}

function regionText(region) {
  return REGION_TO_TEXT[norm(region)] || String(region || 'unspecified region');
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function translateVisionSignals(input = {}) {
  const detections = Array.isArray(input.detections) ? input.detections : [];
  const checklistRows = Array.isArray(input.checklistRows) ? input.checklistRows : [];
  const mapped = [];

  detections.forEach((d) => {
    const confidence = toNumber(d.confidence ?? d.conf ?? 0, 0);
    if (confidence < DEFAULT_MIN_CONFIDENCE) return;
    const label = d.class || d.raw_class || d.name || d.finding || 'skin finding';
    mapped.push({
      source: 'yolo',
      label: String(label),
      symptom_text: mapLabelToSymptom(label),
      confidence
    });
  });

  checklistRows.forEach((row) => {
    const score = toNumber(row.quality_score, 0);
    const status = String(row.status || '').toLowerCase();
    if (!['passed', 'retry_needed', 'failed_max_retries'].includes(status)) return;
    mapped.push({
      source: 'region',
      label: String(row.requested_region || 'other'),
      symptom_text: `${regionText(row.requested_region)} skin concern`,
      confidence: Math.max(0.5, Math.min(1, score || 0.6))
    });
  });

  const dedup = new Map();
  mapped.forEach((m) => {
    const k = `${m.source}:${m.symptom_text}`;
    const prev = dedup.get(k);
    if (!prev || m.confidence > prev.confidence) dedup.set(k, m);
  });
  const findings = Array.from(dedup.values()).sort((a, b) => b.confidence - a.confidence).slice(0, 12);
  const symptom_terms = findings.map((f) => f.symptom_text);
  const retrieval_text = symptom_terms.length ? `Visual findings: ${symptom_terms.join(', ')}` : '';
  const avgConfidence = findings.length
    ? findings.reduce((acc, f) => acc + f.confidence, 0) / findings.length
    : 0;

  return {
    mapped_findings: findings,
    symptom_terms,
    retrieval_text,
    avg_confidence: Math.round(avgConfidence * 1000) / 1000
  };
}

function gateIcdSuggestionsByVisionConfidence(icd10 = [], visionMap = null) {
  const list = Array.isArray(icd10) ? icd10 : [];
  if (!visionMap || !visionMap.mapped_findings?.length) return list;
  if ((visionMap.avg_confidence || 0) >= ICD_GATE_MIN_CONFIDENCE) return list;
  return list.slice(0, 5).map((row) => ({ ...row, review_recommended: true }));
}

module.exports = {
  translateVisionSignals,
  gateIcdSuggestionsByVisionConfidence
};

