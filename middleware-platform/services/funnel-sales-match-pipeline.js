'use strict';

const Metrics = require('./metrics');
const { resolveSkinConditions } = require('./skin-condition-resolver');
const { loadCatalog, VALID_CONCERNS } = require('./concern-routine-service');
const { runClinicalTriage } = require('./funnel-clinical-triage');
const {
  evaluateL0Safety,
  evaluateL2FaceRead,
  matchCatalogRedFlags,
  scoreConcernFromText,
  CONFIDENCE_THRESHOLD_PROGRAM,
  CONFIDENCE_HIGH,
  CONFIDENCE_MED,
  CONFIDENCE_LOW,
} = require('./funnel-match-keywords');

const VALID_USER_GOALS = new Set(['track_program', 'find_specialist', 'both']);

const TAXONOMY_TO_CONCERN = {
  dehydrated: 'barrier_repair',
  barrier_compromised: 'barrier_repair',
  inflamed: 'rosacea',
  active_flare: 'acne',
};

const CATALOG_SEARCH_TERMS = {
  anti_aging: ['anti', 'aging', 'wrinkle', 'fine line', 'retinoid', 'texture', 'collagen'],
  acne: ['acne', 'breakout', 'pimple', 'cystic', 'purging', 'comedone', 'blackhead'],
  hyperpigmentation: ['dark spot', 'hyperpigment', 'melasma', 'pih', 'uneven', 'discolor'],
  barrier_repair: ['barrier', 'dry', 'flaky', 'tight', 'eczema', 'dermatitis', 'moistur', 'sensitive'],
  rosacea: ['rosacea', 'redness', 'flush', 'erythema', 'capillar'],
};

/** Escalation — growth/lump on trunk; spreading systemic rash cues */
const ESCALATION_PATTERNS = [
  /\b(growth|lump|mass|nodule|tumor|tumour)\b/i,
  /\b(mole|lesion)\b.*\b(changed|changing|new|growing)\b/i,
  /\b(changed|changing|new|growing)\b.*\b(mole|lesion)\b/i,
  /\b(stomach|belly|abdomen|chest|back|trunk|torso|scalp|groin)\b.*\b(growth|lump|mass|nodule)\b/i,
  /\b(growth|lump|mass|nodule)\b.*\b(stomach|belly|abdomen|chest|back|trunk|torso|scalp|groin)\b/i,
  /\bspreading\b.*\brash\b/i,
  /\brash\b.*\b(spreading|all over|whole body)\b/i,
  /\b(weeping|oozing|crusting)\b/i,
  /\b(shortness of breath|cannot breathe|can't breathe)\b/i,
];

const VAGUE_RASH_RE = /\brash\b/i;

const OUT_OF_SCOPE_PHRASES = [/\bhair loss\b/i, /\balopecia\b/i, /\beczema all over\b/i];

const SPECIALIST_INTENT_PHRASES = [
  /\bneed (a |)doctor\b/i,
  /\bsee (a |)derm/i,
  /\bdermatologist\b/i,
  /\bspecialist\b/i,
  /\bprescription\b/i,
  /\bisotretinoin\b/i,
  /\baccutane\b/i,
];

function clampConfidence(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

function normalizeGoal(raw) {
  const g = String(raw || 'track_program').trim();
  if (g === 'anti_aging') return 'track_program';
  return VALID_USER_GOALS.has(g) ? g : 'track_program';
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function matchesEscalation(text) {
  const t = String(text || '');
  if (!t.trim()) return { hit: false, reason: null };
  for (const re of ESCALATION_PATTERNS) {
    if (re.test(t)) return { hit: true, reason: 'escalation_lexicon' };
  }
  return { hit: false, reason: null };
}

function scoreCatalog(inquiry, concernChip) {
  const chip = String(concernChip || '').trim();
  if (chip && VALID_CONCERNS.has(chip)) {
    return {
      scores: [{ concern_id: chip, score: 1, source: 'chip' }],
      best: { concern_id: chip, score: 1 },
    };
  }

  const tokens = new Set(tokenize(inquiry));
  const keywordScores = scoreConcernFromText(inquiry);
  const scores = [];

  for (const concernId of VALID_CONCERNS) {
    let score = 0;
    const terms = CATALOG_SEARCH_TERMS[concernId] || [];
    for (const term of terms) {
      if (tokens.has(term) || String(inquiry).toLowerCase().includes(term)) score += 0.15;
    }
    if (keywordScores[concernId]) score += keywordScores[concernId] * 0.2;

    const catalog = loadCatalog();
    const program = catalog[concernId];
    const flags = Array.isArray(program?.red_flags) ? program.red_flags : [];
    for (const flag of flags) {
      const ft = tokenize(flag);
      const overlap = ft.filter((t) => tokens.has(t)).length;
      if (overlap >= 2) score += 0.1;
    }

    if (score > 0) scores.push({ concern_id: concernId, score, source: 'catalog' });
  }

  const skin = resolveSkinConditions({ text: inquiry });
  for (const cond of (skin.conditions || []).slice(0, 3)) {
    const mapped = TAXONOMY_TO_CONCERN[cond.id];
    if (!mapped || !VALID_CONCERNS.has(mapped)) continue;
    const boost = cond.score || 0.3;
    const existing = scores.find((s) => s.concern_id === mapped);
    if (existing) existing.score += boost * 0.25;
    else scores.push({ concern_id: mapped, score: boost * 0.25, source: 'taxonomy' });
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0] || null;
  return { scores, best };
}

function buildRationale(scores, layer) {
  const parts = [layer];
  if (scores?.length) {
    parts.push(
      scores
        .slice(0, 3)
        .map((s) => `${s.concern_id}:${s.score.toFixed(2)}`)
        .join(','),
    );
  }
  return parts.filter(Boolean).join('|');
}

function isVagueRash(inquiry) {
  const t = String(inquiry || '').trim().toLowerCase();
  if (!VAGUE_RASH_RE.test(t)) return false;
  const tokens = tokenize(t);
  if (tokens.length > 8) return false;
  if (/\b(face|cheek|chin|forehead)\b/i.test(t) && tokens.length <= 6) return false;
  return true;
}

function buildClarifyQuestions(userGoal, inquiry = '') {
  const questions = [];
  const trackLike = userGoal === 'track_program' || userGoal === 'both';

  if (trackLike) {
    questions.push({
      id: 'duration',
      prompt: 'How long have you noticed this?',
      options: [
        { id: 'new', label: 'Just started' },
        { id: 'weeks', label: 'A few weeks' },
        { id: 'months', label: 'Months or longer' },
      ],
    });
    questions.push({
      id: 'on_prescription',
      prompt: 'Are you on a prescription for this (e.g. tretinoin, Accutane)?',
      options: [
        { id: 'no', label: 'No' },
        { id: 'yes', label: 'Yes' },
      ],
    });
  }

  if (trackLike && (isVagueRash(inquiry) || /\brash\b/i.test(String(inquiry || '')))) {
    questions.push(
      {
        id: 'location',
        prompt: 'Where is it mainly?',
        options: [
          { id: 'face', label: 'Face' },
          { id: 'body', label: 'Body / trunk' },
          { id: 'both', label: 'Both' },
        ],
      },
      {
        id: 'changing',
        prompt: 'Is it changing?',
        options: [
          { id: 'stable', label: 'Mostly the same' },
          { id: 'spreading', label: 'Spreading or getting worse' },
          { id: 'unsure', label: 'Not sure' },
        ],
      },
    );
  }

  if (questions.length === 0 && trackLike) {
    questions.push({
      id: 'duration',
      prompt: 'How long have you noticed this?',
      options: [
        { id: 'new', label: 'Just started' },
        { id: 'weeks', label: 'A few weeks' },
        { id: 'months', label: 'Months or longer' },
      ],
    });
  }

  return questions;
}

function isTrackLikeGoal(userGoal) {
  return userGoal === 'track_program' || userGoal === 'both';
}

function applyClarifyEscalation(inquiry, clarifyAnswers) {
  const answers = clarifyAnswers && typeof clarifyAnswers === 'object' ? clarifyAnswers : {};
  const loc = String(answers.location || '');
  const changing = String(answers.changing || '');
  const rx = String(answers.on_prescription || '');
  if (rx === 'yes') return { escalate: true, reason: 'clarify_on_prescription' };
  if (loc === 'body' || loc === 'both') return { escalate: true, reason: 'clarify_body_location' };
  if (changing === 'spreading') return { escalate: true, reason: 'clarify_spreading' };
  return { escalate: false, reason: null };
}

function specialistResult({
  zip,
  copy,
  rationale,
  layer,
  concern_id,
  confidence,
  urgency,
  emergency,
  red_flags,
  derm_intent,
}) {
  Metrics.increment('funnel.match.route.specialist.count', 1);
  return {
    success: true,
    route: 'specialist',
    concern_id: concern_id || null,
    confidence: clampConfidence(confidence ?? CONFIDENCE_MED),
    layer: layer || 'L4',
    urgency: urgency || 'routine',
    emergency: !!emergency,
    copy: copy || 'A dermatologist can evaluate this more precisely than a general care program.',
    specialist_query: { zip, scope: 'physician_specialist' },
    face_read_note: null,
    rationale,
    red_flags: red_flags || null,
    scores: [],
    alternatives: [],
    next_questions: null,
    companion_concern_id: null,
    user_goal: null,
    derm_intent: derm_intent || null,
  };
}

function programResult({
  concern_id,
  confidence,
  layer,
  rationale,
  face_read_note,
  scores,
  alternatives,
  user_goal,
}) {
  Metrics.increment('funnel.match.route.program.count', 1);
  return {
    success: true,
    route: 'program',
    concern_id,
    confidence: clampConfidence(confidence),
    layer,
    urgency: 'routine',
    emergency: false,
    copy: null,
    specialist_query: null,
    face_read_note,
    rationale,
    scores: scores || [],
    alternatives: alternatives || [],
    next_questions: null,
    companion_concern_id: null,
    user_goal,
  };
}

function dualResult({
  concern_id,
  confidence,
  layer,
  rationale,
  face_read_note,
  scores,
  alternatives,
  zip,
  user_goal,
}) {
  Metrics.increment('funnel.match.route.dual.count', 1);
  Metrics.increment(`funnel.match.goal.${user_goal}.count`, 1);
  return {
    success: true,
    route: 'dual',
    concern_id,
    confidence: clampConfidence(confidence),
    layer,
    urgency: 'routine',
    emergency: false,
    copy: 'Start tracking your care plan while you find a specialist nearby.',
    specialist_query: { zip, scope: 'physician_specialist' },
    face_read_note,
    rationale,
    scores: scores || [],
    alternatives: alternatives || [],
    next_questions: null,
    companion_concern_id: concern_id,
    user_goal,
  };
}

function clarifyResult({ copy, rationale, next_questions, user_goal, derm_intent }) {
  Metrics.increment('funnel.match.route.clarify.count', 1);
  return {
    success: true,
    route: 'clarify',
    concern_id: null,
    confidence: CONFIDENCE_LOW,
    layer: 'L4',
    urgency: 'routine',
    emergency: false,
    copy: copy || 'A few quick answers help us route you safely.',
    specialist_query: null,
    face_read_note: null,
    rationale,
    scores: [],
    alternatives: [],
    next_questions,
    companion_concern_id: null,
    user_goal,
    derm_intent: derm_intent || null,
  };
}

/**
 * Goal-aware sales match pipeline.
 */
function normalizeConcernChipsInput(raw, fallbackChip) {
  const list = [];
  if (Array.isArray(raw)) {
    for (const id of raw) {
      const c = String(id || '').trim();
      if (c && VALID_CONCERNS.has(c) && !list.includes(c)) list.push(c);
    }
  }
  const fb = String(fallbackChip || '').trim();
  if (fb && VALID_CONCERNS.has(fb) && !list.includes(fb)) list.unshift(fb);
  return list;
}

function runMatch(input = {}) {
  const inquiry = String(input.inquiry || '').trim();
  const concern_chips = normalizeConcernChipsInput(input.concern_chips, input.concern_chip);
  const concern_chip =
    String(input.concern_chip || '').trim() || concern_chips[0] || null;
  const user_goal = normalizeGoal(input.user_goal);
  const zipRaw = String(input.zip || '').replace(/\D/g, '').slice(0, 5) || null;
  const zip = user_goal === 'find_specialist' || user_goal === 'both' ? zipRaw : null;
  const confirmed_age = input.confirmed_age != null ? Number(input.confirmed_age) : null;
  const clarify_answers =
    input.clarify_answers && typeof input.clarify_answers === 'object' ? input.clarify_answers : null;

  Metrics.increment(`funnel.match.goal.${user_goal}.count`, 1);

  const l0 = evaluateL0Safety(inquiry);
  if (l0) {
    Metrics.increment('funnel.match.layer.L0.count', 1);
    Metrics.increment('funnel.match.safety_block.count', 1);
    return {
      ...specialistResult({
        zip,
        copy: l0.copy,
        rationale: 'safety',
        layer: 'L0',
        urgency: l0.urgency || 'high',
        emergency: !!l0.emergency,
        red_flags: l0.red_flags,
      }),
      user_goal,
    };
  }

  if (clarify_answers) {
    const clarifyEsc = applyClarifyEscalation(inquiry, clarify_answers);
    if (clarifyEsc.escalate) {
      Metrics.increment('funnel.clarify.completed.count', 1);
      return {
        ...specialistResult({
          zip,
          copy: 'Based on your answers, we recommend seeing a dermatologist before starting a self-guided program.',
          rationale: clarifyEsc.reason,
          layer: 'L4',
        }),
        user_goal,
      };
    }
  }

  const escalation = matchesEscalation(inquiry);
  if (escalation.hit) {
    Metrics.increment('funnel.match.escalation.count', 1);
    return {
      ...specialistResult({
        zip,
        copy: 'Growths, spreading rashes on the body, or changing lesions should be evaluated by a dermatologist.',
        rationale: escalation.reason,
        layer: 'L0',
        urgency: 'high',
      }),
      user_goal,
    };
  }

  for (const re of OUT_OF_SCOPE_PHRASES) {
    if (re.test(inquiry)) {
      return {
        ...specialistResult({
          zip,
          copy: 'This concern is outside our self-guided programs — a dermatologist is the right next step.',
          rationale: 'out_of_scope',
          layer: 'L4',
        }),
        user_goal,
      };
    }
  }

  if (user_goal !== 'find_specialist' && user_goal !== 'both') {
    for (const re of SPECIALIST_INTENT_PHRASES) {
      if (re.test(inquiry)) {
        return {
          ...specialistResult({
            zip,
            rationale: 'specialist_intent',
            layer: 'L4',
          }),
          user_goal,
        };
      }
    }
  }

  let inquiryForMatch = inquiry;
  let dermIntent = null;

  if (isTrackLikeGoal(user_goal)) {
    const clinical = runClinicalTriage({
      inquiry,
      concern_chip,
      clarify_answers,
      user_goal,
    });
    dermIntent = clinical.derm_intent || null;

    if (clinical.action === 'specialist') {
      Metrics.increment('funnel.match.layer.clinical.count', 1);
      return {
        ...specialistResult({
          zip,
          copy: clinical.copy,
          rationale: clinical.rationale,
          layer: 'clinical',
          derm_intent: dermIntent,
        }),
        user_goal,
      };
    }

    if (clinical.action === 'clarify') {
      Metrics.increment('funnel.match.layer.clinical.count', 1);
      return {
        ...clarifyResult({
          copy: clinical.copy,
          rationale: clinical.rationale,
          next_questions: buildClarifyQuestions(user_goal, inquiry),
          user_goal,
          derm_intent: dermIntent,
        }),
      };
    }

    inquiryForMatch = clinical.enriched_inquiry || inquiry;
  }

  const { scores, best } = scoreCatalog(inquiryForMatch, concern_chip);
  const keywordScores = scoreConcernFromText(inquiryForMatch);
  const kwHits = best ? keywordScores[best.concern_id] || 0 : 0;
  const strongProgramMatch = !!concern_chip || (best && best.score >= 0.35) || kwHits >= 2;

  const redFlagHit = matchCatalogRedFlags(inquiryForMatch);
  if (redFlagHit.matched && !strongProgramMatch && user_goal !== 'find_specialist') {
    return {
      ...specialistResult({
        zip,
        copy: 'Based on what you described, we recommend seeing a dermatologist rather than starting a self-guided program alone.',
        rationale: 'catalog_red_flag',
        layer: 'L4',
        concern_id: redFlagHit.concern_id,
        red_flag_snippet: redFlagHit.snippet,
      }),
      user_goal,
    };
  }

  if (/\bnot sure\b/i.test(inquiry) && !concern_chip) {
    return {
      ...clarifyResult({
        copy: 'Pick the closest option below or describe your main concern in a few words.',
        rationale: 'not_sure',
        next_questions: buildClarifyQuestions(user_goal),
        user_goal,
      }),
    };
  }

  if (isVagueRash(inquiryForMatch) && !clarify_answers && ['track_program', 'both'].includes(user_goal)) {
    return {
      ...clarifyResult({
        copy: 'Help us understand your rash so we can guide you safely.',
        rationale: 'vague_rash',
        next_questions: buildClarifyQuestions(user_goal, inquiryForMatch),
        user_goal,
        derm_intent: dermIntent,
      }),
    };
  }

  const alternatives = scores.slice(1, 4).map((s) => ({
    concern_id: s.concern_id,
    score: Number(s.score.toFixed(3)),
  }));

  let concern_id = best?.concern_id || null;
  let confidence =
    best?.score >= 0.5 ? CONFIDENCE_HIGH : best?.score >= 0.25 ? CONFIDENCE_MED : CONFIDENCE_LOW;

  const l2 = evaluateL2FaceRead(input.face_read, confirmed_age);
  confidence = clampConfidence(confidence + (l2.confidence_adjustment || 0));

  const rationale = buildRationale(scores, 'fusion');
  const scorePayload = scores.slice(0, 5).map((s) => ({
    concern_id: s.concern_id,
    score: Number(s.score.toFixed(3)),
    source: s.source,
  }));

  if (user_goal === 'find_specialist') {
    return {
      ...specialistResult({
        zip,
        copy: 'Here are specialists near you. Skin & Care does not book appointments.',
        rationale: 'find_specialist_goal',
        layer: 'goal',
        concern_id: null,
        confidence: CONFIDENCE_MED,
      }),
      user_goal,
      scores: scorePayload,
      alternatives,
    };
  }

  if (!concern_id || !VALID_CONCERNS.has(concern_id)) {
    if (!inquiry && !concern_chip) {
      return {
        ...clarifyResult({
          copy: 'Tell us your main skin concern, or choose one of the options below.',
          rationale: 'empty_input',
          next_questions: buildClarifyQuestions(user_goal, inquiry),
          user_goal,
        }),
      };
    }
    if (isTrackLikeGoal(user_goal)) {
      return {
        ...clarifyResult({
          copy: 'Pick the closest match below or answer a quick question so we can suggest the right plan.',
          rationale: 'unmapped_inquiry',
          next_questions: buildClarifyQuestions(user_goal, inquiry),
          user_goal,
          scores: scorePayload,
          alternatives,
        }),
      };
    }
    return {
      ...specialistResult({
        zip,
        copy: 'We could not map this to a self-guided program — a specialist can help.',
        rationale: 'unmapped_inquiry',
        layer: 'L4',
        confidence: CONFIDENCE_LOW,
      }),
      user_goal,
      scores: scorePayload,
      alternatives,
    };
  }

  if (user_goal === 'both') {
    return dualResult({
      concern_id,
      confidence,
      layer: 'fusion',
      rationale: `${rationale}|goal_both`,
      face_read_note: l2.face_read_note,
      scores: scorePayload,
      alternatives,
      zip,
      user_goal,
    });
  }

  if (confidence < CONFIDENCE_THRESHOLD_PROGRAM && !concern_chip) {
    if (isTrackLikeGoal(user_goal)) {
      return {
        ...clarifyResult({
          copy: 'We need a bit more detail to match the right care plan — pick a chip or answer below.',
          rationale: 'low_confidence',
          next_questions: buildClarifyQuestions(user_goal, inquiry),
          user_goal,
          scores: scorePayload,
          alternatives,
        }),
      };
    }
    return {
      ...specialistResult({
        zip,
        copy: 'We are not fully confident a self-guided program fits — consider a specialist near you.',
        rationale: 'low_confidence',
        layer: 'L4',
        concern_id,
        confidence,
      }),
      user_goal,
      scores: scorePayload,
      alternatives,
    };
  }

  return programResult({
    concern_id,
    confidence,
    layer: concern_chip ? 'L1' : 'fusion',
    rationale: dermIntent ? `${rationale}|${dermIntent}` : rationale,
    face_read_note: l2.face_read_note,
    scores: scorePayload,
    alternatives,
    user_goal,
    derm_intent: dermIntent,
  });
}

module.exports = {
  runMatch,
  VALID_USER_GOALS,
  buildClarifyQuestions,
  scoreCatalog,
  matchesEscalation,
};
