'use strict';

const { detectRedFlags } = require('../clinical/triage-service');
const { loadCatalog, VALID_CONCERNS } = require('../platform/concern-routine-service');

/** L1 — chip id or keyword → concern_id */
const CONCERN_KEYWORDS = {
  acne: [
    /\bacne\b/i,
    /\bbreakouts?\b/i,
    /\bbreakout/i,
    /\bpimple/i,
    /\bcystic\b/i,
    /\boily\b/i,
    /\bpurging\b/i,
    /\b(blackhead|whitehead|comedone)\b/i,
  ],
  hyperpigmentation: [
    /\bdark spots?\b/i,
    /\bdark spot/i,
    /\bhyperpigment/i,
    /\bmelasma\b/i,
    /\bpost.?inflammatory/i,
    /\bpih\b/i,
    /\buneven tone/i,
    /\bdiscolor/i,
  ],
  rosacea: [/\brosacea\b/i, /\bredness\b/i, /\bflushing\b/i, /\bbroken capillar/i, /\berythema\b/i],
  anti_aging: [
    /\bfine line/i,
    /\bwrinkle/i,
    /\banti.?ag/i,
    /\baging\b/i,
    /\btexture\b/i,
    /\bretinoid\b/i,
    /\bcollagen\b/i,
  ],
  barrier_repair: [
    /\bbarrier\b/i,
    /\bdry\b/i,
    /\bflaky\b/i,
    /\btight\b/i,
    /\b(raw|sensitive)\b/i,
    /\beczema\b/i,
    /\bdermatitis\b/i,
    /\bmoistur/i,
  ],
};

/** Out-of-scope → specialist (L4) */
const SPECIALIST_TRIGGER_PHRASES = [
  /\bneed (a |)doctor\b/i,
  /\bsee (a |)derm/i,
  /\bdermatologist\b/i,
  /\bspecialist\b/i,
  /\bhair loss\b/i,
  /\balopecia\b/i,
  /\bmole\b/i,
  /\blesion\b/i,
  /\bbiopsy\b/i,
  /\bprescription\b/i,
  /\bisotretinoin\b/i,
  /\baccutane\b/i,
];

const OUT_OF_SCOPE_PHRASES = [/\bhair loss\b/i, /\balopecia\b/i, /\beczema all over\b/i];

const CONFIDENCE_HIGH = 0.85;
const CONFIDENCE_MED = 0.65;
const CONFIDENCE_LOW = 0.45;
const CONFIDENCE_THRESHOLD_PROGRAM = 0.55;

function tokenizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function scoreConcernFromText(text) {
  const scores = {};
  const lower = String(text || '').toLowerCase();
  for (const [concernId, patterns] of Object.entries(CONCERN_KEYWORDS)) {
    let hits = 0;
    for (const re of patterns) {
      if (re.test(text)) hits += 1;
    }
    if (/\bdark spots?\b/i.test(lower) && concernId === 'hyperpigmentation') hits += 2;
    if (hits > 0) scores[concernId] = hits;
  }
  return scores;
}

function pickBestConcern(scores) {
  let best = null;
  let bestScore = 0;
  for (const [id, s] of Object.entries(scores)) {
    if (s > bestScore) {
      bestScore = s;
      best = id;
    }
  }
  return best ? { concern_id: best, hits: bestScore } : null;
}

function loadRedFlagPatterns() {
  const catalog = loadCatalog();
  const out = [];
  for (const id of VALID_CONCERNS) {
    const program = catalog[id];
    const flags = Array.isArray(program?.red_flags) ? program.red_flags : [];
    for (const flag of flags) {
      const tokens = tokenizeForMatch(flag);
      if (tokens.length >= 2) {
        out.push({ concern_id: id, text: flag, tokens });
      }
    }
  }
  return out;
}

/**
 * If inquiry overlaps red-flag language from a concern catalog, boost specialist routing.
 */
function matchCatalogRedFlags(inquiry) {
  const tokens = new Set(tokenizeForMatch(inquiry));
  if (!tokens.size) return { matched: false, concern_id: null, snippet: null };
  const patterns = loadRedFlagPatterns();
  for (const row of patterns) {
    const overlap = row.tokens.filter((t) => tokens.has(t)).length;
    if (overlap >= 2 || (row.tokens.length <= 3 && overlap >= 1)) {
      return { matched: true, concern_id: row.concern_id, snippet: row.text };
    }
  }
  const lower = String(inquiry || '').toLowerCase();
  if (/\b(weeping|oozing|crusting|spreading|changed color|changing mole)\b/i.test(lower)) {
    return { matched: true, concern_id: null, snippet: 'symptom pattern' };
  }
  return { matched: false, concern_id: null, snippet: null };
}

const FUNNEL_L0_PATTERNS = [
  /mole.*(changed|changing|color)/i,
  /(changed|changing).*mole/i,
  /melanoma/i,
  /spreading rash/i,
  /can't breathe|cannot breathe/i,
];

function evaluateL0Safety(inquiry) {
  const text = String(inquiry || '').trim();
  if (!text) return null;
  for (const re of FUNNEL_L0_PATTERNS) {
    if (re.test(text)) {
      return {
        layer: 'L0',
        route: 'specialist',
        urgency: 'high',
        emergency: false,
        copy: 'Changes in a mole or spreading symptoms should be evaluated by a clinician promptly.',
        red_flags: ['funnel_l0_pattern'],
      };
    }
  }
  const result = detectRedFlags(text);
  if (result?.isEmergency || result?.urgency === 'URGENT' || result?.urgency === 'EMERGENT') {
    return {
      layer: 'L0',
      route: 'specialist',
      urgency: result.isEmergency ? 'high' : 'high',
      emergency: !!result.isEmergency,
      copy: result.suggestedResponse || 'Please seek urgent medical care for these symptoms.',
      red_flags: result.redFlags || [],
    };
  }
  if (Array.isArray(result?.redFlags) && result.redFlags.length > 0) {
    return {
      layer: 'L0',
      route: 'specialist',
      urgency: 'high',
      emergency: false,
      copy: result.suggestedResponse || 'These symptoms should be evaluated by a clinician.',
      red_flags: result.redFlags,
    };
  }
  return null;
}

function evaluateL1({ inquiry, concern_chip }) {
  const chip = String(concern_chip || '').trim();
  if (chip && VALID_CONCERNS.has(chip)) {
    return {
      layer: 'L1',
      route: 'program',
      concern_id: chip,
      confidence: CONFIDENCE_HIGH,
      rationale: 'explicit_chip',
    };
  }

  const text = String(inquiry || '').trim();
  if (!text) return null;

  const scores = scoreConcernFromText(text);
  const best = pickBestConcern(scores);
  if (!best) return null;

  const confidence = best.hits >= 2 ? CONFIDENCE_HIGH : CONFIDENCE_MED;
  return {
    layer: 'L1',
    route: 'program',
    concern_id: best.concern_id,
    confidence,
    rationale: 'keyword_match',
  };
}

function evaluateL4({ inquiry, concern_chip, l1Result }) {
  const text = String(inquiry || '').trim();
  const chip = String(concern_chip || '').trim();

  if (/\bnot sure\b/i.test(text) && !chip) {
    return {
      layer: 'L4',
      route: 'clarify',
      concern_id: null,
      confidence: CONFIDENCE_LOW,
      rationale: 'not_sure',
    };
  }

  for (const re of SPECIALIST_TRIGGER_PHRASES) {
    if (/\bmole\b/i.test(re.source || '') && l1Result?.confidence >= CONFIDENCE_MED) continue;
    if (re.test(text)) {
      return {
        layer: 'L4',
        route: 'specialist',
        concern_id: null,
        confidence: CONFIDENCE_MED,
        rationale: 'specialist_intent',
      };
    }
  }

  for (const re of OUT_OF_SCOPE_PHRASES) {
    if (re.test(text)) {
      return {
        layer: 'L4',
        route: 'specialist',
        concern_id: null,
        confidence: CONFIDENCE_LOW,
        rationale: 'out_of_scope',
      };
    }
  }

  const skipCatalogRedFlag =
    l1Result && l1Result.confidence >= CONFIDENCE_MED && l1Result.route === 'program';
  if (!skipCatalogRedFlag) {
    const redFlagHit = matchCatalogRedFlags(text);
    if (redFlagHit.matched) {
      return {
        layer: 'L4',
        route: 'specialist',
        concern_id: redFlagHit.concern_id,
        confidence: CONFIDENCE_MED,
        rationale: 'catalog_red_flag',
        red_flag_snippet: redFlagHit.snippet,
      };
    }
  }

  if (l1Result && l1Result.confidence < CONFIDENCE_THRESHOLD_PROGRAM) {
    return {
      layer: 'L4',
      route: 'specialist',
      concern_id: l1Result.concern_id,
      confidence: l1Result.confidence,
      rationale: 'low_confidence',
    };
  }

  if (!l1Result && text.length > 0) {
    return {
      layer: 'L4',
      route: 'specialist',
      concern_id: null,
      confidence: CONFIDENCE_LOW,
      rationale: 'unmapped_inquiry',
    };
  }

  return null;
}

function evaluateL2FaceRead(faceRead, confirmedAge) {
  if (!faceRead || typeof faceRead !== 'object') {
    return { face_read_note: null, confidence_adjustment: 0 };
  }
  const apparent = Number(faceRead.apparent_age_estimate);
  const confirmed = Number(confirmedAge);
  const quality = String(faceRead.quality || '').toLowerCase();
  let note = null;
  let adjustment = 0;
  if (quality === 'low' || quality === 'no_face') {
    note = 'Photo quality was limited — your plan is based on what you told us.';
    adjustment = -0.05;
  }
  if (Number.isFinite(apparent) && Number.isFinite(confirmed) && Math.abs(apparent - confirmed) >= 8) {
    note = note
      ? `${note} Your photo suggested ${Math.round(apparent)}; you entered ${Math.round(confirmed)}.`
      : `Your photo suggested ${Math.round(apparent)}; you entered ${Math.round(confirmed)}. We'll use both.`;
    adjustment -= 0.03;
  }
  return { face_read_note: note, confidence_adjustment: adjustment };
}

module.exports = {
  CONCERN_KEYWORDS,
  CONFIDENCE_THRESHOLD_PROGRAM,
  CONFIDENCE_HIGH,
  CONFIDENCE_MED,
  CONFIDENCE_LOW,
  evaluateL0Safety,
  evaluateL1,
  evaluateL4,
  evaluateL2FaceRead,
  matchCatalogRedFlags,
  scoreConcernFromText,
};
