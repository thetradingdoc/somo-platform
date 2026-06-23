'use strict';

const { v4: uuidv4 } = require('uuid');
const { VALID_CONCERNS } = require('../platform/concern-routine-service');
const { runClinicalTriage } = require('./funnel-clinical-triage');
const { scoreCatalog } = require('./funnel-sales-match-pipeline');
const { runMatch } = require('./funnel-sales-match-pipeline');

const CHIP_LABELS = {
  acne: 'Breakouts',
  anti_aging: 'Lines & texture',
  hyperpigmentation: 'Dark spots',
  rosacea: 'Redness',
  barrier_repair: 'Barrier repair',
};

const SCORE_GAP_CONFIRM = 0.1;
const LOW_CONFIDENCE = 0.35;

function normalizeConcernChips(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const id of raw) {
    const c = String(id || '').trim();
    if (c && VALID_CONCERNS.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

function fuseMultiChipScores(inquiry, concernChips) {
  const merged = new Map();

  if (concernChips.length) {
    for (const chip of concernChips) {
      const { scores } = scoreCatalog(inquiry, chip);
      for (const s of scores) {
        const prev = merged.get(s.concern_id) || 0;
        merged.set(s.concern_id, Math.max(prev, s.score));
      }
    }
  } else {
    const { scores } = scoreCatalog(inquiry, null);
    for (const s of scores) {
      merged.set(s.concern_id, s.score);
    }
  }

  const ranked = [...merged.entries()]
    .map(([concern_id, score]) => ({ concern_id, score }))
    .sort((a, b) => b.score - a.score);

  return {
    ranked,
    primary: ranked[0] || null,
    secondary: ranked.slice(1, 4),
  };
}

function pickPrimaryFromChips(ranked, concernChips, userConfirmId) {
  if (userConfirmId && VALID_CONCERNS.has(userConfirmId)) {
    return userConfirmId;
  }
  const top = ranked[0]?.concern_id || null;
  if (!top) return null;
  if (concernChips.length && !concernChips.includes(top)) {
    const inChips = ranked.find((r) => concernChips.includes(r.concern_id));
    return inChips?.concern_id || concernChips[0];
  }
  return top;
}

function needsUserConfirm(ranked, concernChips) {
  if (concernChips.length > 1) {
    const a = ranked[0]?.score || 0;
    const b = ranked[1]?.score || 0;
    if (a - b < SCORE_GAP_CONFIRM) return true;
    return true;
  }
  const top = ranked[0]?.score || 0;
  return top > 0 && top < LOW_CONFIDENCE;
}

const FIND_SPECIALIST_US_COPY =
  'Specialist search uses US ZIP codes (NPPES). Enter your ZIP on the next step.';

function buildKellyFindSpecialistMessage({ concernChips, inquiry, notSure, ranked }) {
  const labels = concernChips.map((id) => CHIP_LABELS[id] || id).join(', ') || '(none selected)';
  const rankedStr = ranked
    .slice(0, 3)
    .map((r) => `${CHIP_LABELS[r.concern_id] || r.concern_id} (${r.score.toFixed(2)})`)
    .join('; ');
  return (
    `[Skin & Care funnel — find specialist safety check]\n` +
    `User is finding a US dermatology specialist (NPPES directory on the next step).\n` +
    `Selected concerns: ${labels}\n` +
    `User description: ${inquiry || '(not sure — see description)'}\n` +
    `Not sure mode: ${notSure ? 'yes' : 'no'}\n` +
    `Policy ranking: ${rankedStr || 'unmapped'}\n\n` +
    `Task: In 2–3 short sentences, safety check only. Acknowledge their concerns briefly. ` +
    `If symptoms sound urgent or unsafe for self-guided care, tell them to see a clinician promptly. ` +
    `Do NOT ask skin type (oily/dry/etc). Do NOT recommend a week-1 program or products. ` +
    `Do NOT offer booking.`
  );
}

function buildKellyMessage({ concernChips, inquiry, notSure, userGoal, ranked }) {
  const labels = concernChips.map((id) => CHIP_LABELS[id] || id).join(', ') || '(none selected)';
  const rankedStr = ranked
    .slice(0, 3)
    .map((r) => `${CHIP_LABELS[r.concern_id] || r.concern_id} (${r.score.toFixed(2)})`)
    .join('; ');
  return (
    `[Skin & Care funnel intake — match validation]\n` +
    `User goal: ${userGoal}\n` +
    `Selected concerns: ${labels}\n` +
    `User description: ${inquiry || '(not sure — see description)'}\n` +
    `Not sure mode: ${notSure ? 'yes' : 'no'}\n` +
    `Policy ranking: ${rankedStr || 'unmapped'}\n\n` +
    `Task: In 2–4 short sentences, recommend ONE starting care program (Breakouts, Lines & texture, ` +
    `Dark spots, Redness, or Barrier repair) for week-1 tracking. Mention other selected concerns as ` +
    `secondary. Do not diagnose. If symptoms sound unsafe for self-guided care, say to see a clinician. ` +
    `Do not offer booking or products.`
  );
}

function hasLlmEnv() {
  return !!(
    process.env.GROQ_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY
  );
}

async function runKellyIntakeTurn({ message, sessionId, clinicId, findSpecialist = false }) {
  const KellyAgentService = require('../kelly/kelly-agent-service');
  const KellyToolExecutor = require('../kelly/kelly-tool-executor');
  const sid = sessionId || uuidv4();
  try {
    if (!findSpecialist) {
      KellyToolExecutor._setSessionMeta(sid, 'routine_intake_active', '1');
    }
    KellyToolExecutor._setSessionMeta(sid, 'kelly_flow', 'skincare');
    KellyToolExecutor._setSessionMeta(sid, 'funnel_intake_active', '1');
    if (findSpecialist) {
      KellyToolExecutor._setSessionMeta(sid, 'funnel_find_specialist_active', '1');
    }
  } catch (_) {}

  const result = await require('../kelly/kelly-turn-resolver').runKellyTurn({
    message,
    sessionId: sid,
    channel: 'chat',
    clinicId: clinicId || process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID || null,
    patientId: null,
    preferredLanguage: 'en',
  });

  return {
    session_id: sid,
    reply: String(result.reply || '').trim(),
    toolsUsed: result.toolsUsed || [],
  };
}

function buildProposalCopy(primaryId, secondaryIds, notSure) {
  const primary = CHIP_LABELS[primaryId] || primaryId;
  const sec = secondaryIds
    .filter((id) => id !== primaryId)
    .map((id) => CHIP_LABELS[id] || id);
  let copy = notSure
    ? `Based on what you described, we recommend starting with ${primary}.`
    : `We recommend starting with ${primary} for your week-1 plan.`;
  if (sec.length) {
    copy += ` You also noted ${sec.join(' and ')} — we can address those after you begin.`;
  }
  return copy;
}

function specialistProposal({ copy, kellyReply, kellySessionId, userGoal }) {
  return {
    route: 'specialist',
    primary_concern_id: null,
    secondary_concern_ids: [],
    confidence: 0.55,
    needs_user_confirm: false,
    kelly_reply: kellyReply || null,
    kelly_session_id: kellySessionId || null,
    copy: copy || 'A clinician should evaluate this before starting a self-guided program.',
    user_goal: userGoal,
  };
}

/**
 * Run funnel intake: policy + Kelly validation → proposal.
 */
async function runFunnelIntake(input = {}) {
  const inquiry = String(input.inquiry || '').trim();
  const concernChips = normalizeConcernChips(input.concern_chips || input.concernChips);
  const notSure = !!input.not_sure || !!input.notSure;
  const userGoal = String(input.user_goal || input.userGoal || 'track_program').trim();
  const userConfirmId = String(input.user_confirm_concern_id || input.userConfirmConcernId || '').trim() || null;
  let kellySessionId = String(input.kelly_session_id || input.kellySessionId || '').trim() || null;

  const clinical = runClinicalTriage({
    inquiry,
    concern_chip: concernChips[0] || null,
    clarify_answers: null,
    user_goal: userGoal,
  });

  if (clinical.action === 'specialist') {
    const usCopy = userGoal === 'find_specialist' ? FIND_SPECIALIST_US_COPY : clinical.copy;
    return {
      success: true,
      proposal: specialistProposal({
        copy: usCopy,
        kellyReply: userGoal === 'find_specialist' ? clinical.copy : null,
        kellySessionId,
        userGoal,
      }),
    };
  }

  if (userGoal === 'find_specialist') {
    let kellyReply = null;
    const shouldRunKellySafety =
      !userConfirmId &&
      (concernChips.length > 0 || notSure || inquiry.length > 0) &&
      (hasLlmEnv() || process.env.FUNNEL_INTAKE_FORCE_KELLY === '1');
    const fusionForSafety = fuseMultiChipScores(inquiry, concernChips);
    if (shouldRunKellySafety) {
      try {
        const kellyOut = await runKellyIntakeTurn({
          message: buildKellyFindSpecialistMessage({
            concernChips,
            inquiry,
            notSure,
            ranked: fusionForSafety.ranked,
          }),
          sessionId: kellySessionId,
          findSpecialist: true,
        });
        kellySessionId = kellyOut.session_id;
        kellyReply = kellyOut.reply;
        if (/\b(emergency|911|urgent care|see (a |)doctor|clinician|specialist)\b/i.test(kellyReply)) {
          return {
            success: true,
            proposal: specialistProposal({
              copy: FIND_SPECIALIST_US_COPY,
              kellyReply: kellyReply.slice(0, 500),
              kellySessionId,
              userGoal,
            }),
          };
        }
      } catch (_) {
        kellyReply = null;
      }
    }
    return {
      success: true,
      proposal: specialistProposal({
        copy: FIND_SPECIALIST_US_COPY,
        kellyReply: kellyReply || clinical.copy || null,
        kellySessionId,
        userGoal,
      }),
    };
  }

  const fusion = fuseMultiChipScores(inquiry, concernChips);
  let primaryId = pickPrimaryFromChips(fusion.ranked, concernChips, userConfirmId);
  const secondaryIds = concernChips.filter((id) => id !== primaryId);
  if (!secondaryIds.length && fusion.secondary.length) {
    for (const s of fusion.secondary) {
      if (s.concern_id !== primaryId) secondaryIds.push(s.concern_id);
    }
  }

  let kellyReply = null;
  const shouldRunKelly =
    userGoal !== 'find_specialist' &&
    !userConfirmId &&
    (hasLlmEnv() || process.env.FUNNEL_INTAKE_FORCE_KELLY === '1');

  if (shouldRunKelly) {
    try {
      const kellyOut = await runKellyIntakeTurn({
        message: buildKellyMessage({
          concernChips,
          inquiry,
          notSure,
          userGoal,
          ranked: fusion.ranked,
        }),
        sessionId: kellySessionId,
      });
      kellySessionId = kellyOut.session_id;
      kellyReply = kellyOut.reply;
      if (/\b(emergency|911|urgent care|see (a |)doctor|clinician|specialist)\b/i.test(kellyReply)) {
        return {
          success: true,
          proposal: specialistProposal({
            copy: kellyReply.slice(0, 500),
            kellyReply,
            kellySessionId,
            userGoal,
          }),
        };
      }
    } catch (e) {
      kellyReply = null;
    }
  }

  if (!primaryId && concernChips.length) primaryId = concernChips[0];
  if (!primaryId) {
    const match = runMatch({
      inquiry,
      concern_chip: null,
      user_goal: userGoal,
      face_read: input.face_read,
      confirmed_age: input.confirmed_age,
      zip: input.zip,
    });
    return {
      success: true,
      proposal: {
        route: match.route,
        primary_concern_id: match.concern_id,
        secondary_concern_ids: [],
        confidence: match.confidence,
        needs_user_confirm: match.route === 'clarify',
        kelly_reply: kellyReply,
        kelly_session_id: kellySessionId,
        copy: match.copy || buildProposalCopy(primaryId, secondaryIds, notSure),
        user_goal: userGoal,
        match,
      },
    };
  }

  const confirm = needsUserConfirm(fusion.ranked, concernChips) && !userConfirmId;
  const confidence = Math.min(0.95, fusion.ranked[0]?.score || 0.5);

  if (userConfirmId) {
    const match = runMatch({
      inquiry,
      concern_chip: primaryId,
      concern_chips: concernChips,
      user_goal: userGoal,
      face_read: input.face_read,
      confirmed_age: input.confirmed_age,
      zip: input.zip,
    });
    return {
      success: true,
      proposal: {
        route: 'program',
        primary_concern_id: primaryId,
        secondary_concern_ids: secondaryIds,
        confidence,
        needs_user_confirm: false,
        kelly_reply: kellyReply,
        kelly_session_id: kellySessionId,
        copy: buildProposalCopy(primaryId, secondaryIds, notSure),
        user_goal: userGoal,
        match,
      },
    };
  }

  const proposal = {
    route: confirm ? 'program' : 'program',
    primary_concern_id: primaryId,
    secondary_concern_ids: secondaryIds,
    confidence,
    needs_user_confirm: confirm,
    kelly_reply: kellyReply,
    kelly_session_id: kellySessionId,
    copy: buildProposalCopy(primaryId, secondaryIds, notSure),
    user_goal: userGoal,
  };

  if (clinical.action === 'clarify' && !concernChips.length && !userConfirmId) {
    proposal.needs_user_confirm = true;
    proposal.copy = clinical.copy || proposal.copy;
  }

  return { success: true, proposal };
}

module.exports = {
  runFunnelIntake,
  normalizeConcernChips,
  fuseMultiChipScores,
  CHIP_LABELS,
  FIND_SPECIALIST_US_COPY,
  buildKellyFindSpecialistMessage,
};
