'use strict';

const OVERALL_VALUES = new Set(['safe', 'caution', 'avoid']);
const VERDICT_VALUES = new Set(['avoid', 'caution', 'info']);

function _pairKeyForReplyConflict(c) {
  return _pairKeyForConflict(c.ingredient_a, c.ingredient_b);
}

/** B5 — routine products that contain at least one of the conflicting ingredients */
function collectRoutineProductIds(session) {
  const ids = new Set();
  for (const slot of session?.current_routine || []) {
    for (const p of slot.products || []) {
      const pid = p.product_id != null ? String(p.product_id).trim() : '';
      if (pid) ids.add(pid);
    }
  }
  return [...ids];
}

function routineProductIdsTouchingIngredients(session, ingredientA, ingredientB) {
  const na = _bareInci(ingredientA);
  const nb = _bareInci(ingredientB);
  const ids = new Set();
  for (const slot of session?.current_routine || []) {
    for (const p of slot.products || []) {
      if (!p.product_id) continue;
      const ing = new Set((p.ingredient_ids || []).map(_bareInci));
      if (ing.has(na) || ing.has(nb)) ids.add(String(p.product_id));
    }
  }
  return ids;
}

/** B5 — SKU-scoped chunk relevant to graph conflict (pair or mono on either INCI) */
function skuChunkSupportsConflict(ch, graphConflict) {
  if (ch.chunk_source_tier !== 'knowledge_sku' || !ch.product_id) return false;
  const na = _bareInci(graphConflict.ingredient_a);
  const nb = _bareInci(graphConflict.ingredient_b);
  const pk = _pairKeyForConflict(graphConflict.ingredient_a, graphConflict.ingredient_b);
  const ck = _pairKeyForChunk(ch);
  if (ch.ingredient_a && ch.ingredient_b && ck === pk) return true;
  if (!ch.ingredient_b) {
    const mono = _bareInci(ch.ingredient_a);
    return mono === na || mono === nb;
  }
  return false;
}

function _validateSkuCitationRules(raw, citationCtx) {
  const errors = [];
  const chunks = citationCtx.chunkBundle?.chunks || [];
  if (!Array.isArray(raw.conflicts) || !citationCtx.verdict?.conflicts) return errors;

  raw.conflicts.forEach((replyC, i) => {
    const graphConflict = citationCtx.verdict.conflicts.find(
      (vc) => _pairKeyForConflict(vc.ingredient_a, vc.ingredient_b) === _pairKeyForReplyConflict(replyC)
    );
    if (!graphConflict) return;

    const touching = routineProductIdsTouchingIngredients(
      citationCtx.session,
      graphConflict.ingredient_a,
      graphConflict.ingredient_b
    );
    const applicable = chunks.filter(
      (ch) =>
        skuChunkSupportsConflict(ch, graphConflict) && touching.has(String(ch.product_id))
    );
    if (!applicable.length) return;

    const cited = new Set(replyC.citation_ids || []);
    const ok = applicable.some((ch) => cited.has(ch.id));
    if (!ok) {
      errors.push(
        `conflicts[${i}].citation_ids must cite a SKU-scoped chunk for this routine ` +
          `(expected one of: ${applicable.map((c) => c.id).join(', ')})`
      );
    }
  });
  return errors;
}

function validateReply(raw, citationCtx) {
  const errors = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, reply: null, errors: ['reply is not an object'] };
  }

  if (!OVERALL_VALUES.has(raw.overall))
    errors.push(`overall must be safe|caution|avoid, got "${raw.overall}"`);

  if (!Array.isArray(raw.conflicts))
    errors.push('conflicts must be an array');

  if (raw.conflicts && Array.isArray(raw.conflicts)) {
    raw.conflicts.forEach((c, i) => {
      if (!c.ingredient_a) errors.push(`conflicts[${i}].ingredient_a missing`);
      if (!c.ingredient_b) errors.push(`conflicts[${i}].ingredient_b missing`);
      if (!VERDICT_VALUES.has(c.verdict))
        errors.push(`conflicts[${i}].verdict must be avoid|caution|info`);
      if (!c.reason) errors.push(`conflicts[${i}].reason missing`);
      if (!Array.isArray(c.citation_ids) || c.citation_ids.length === 0)
        errors.push(`conflicts[${i}].citation_ids must be non-empty array`);
    });
  }

  if (!Array.isArray(raw.safe_to_combine))
    errors.push('safe_to_combine must be an array');

  if (typeof raw.narrative !== 'string' || raw.narrative.trim().length === 0)
    errors.push('narrative must be a non-empty string');

  if (!Array.isArray(raw.cited_chunk_ids))
    errors.push('cited_chunk_ids must be an array');

  if (raw.overall === 'avoid' && Array.isArray(raw.conflicts) && raw.conflicts.length > 0) {
    const hasAvoid = raw.conflicts.some((c) => c.verdict === 'avoid');
    if (!hasAvoid) {
      errors.push(
        `overall is "avoid" but no conflict has verdict "avoid" — ` +
        `LLM softened a critical conflict. Reject this reply.`
      );
    }
  }

  if (citationCtx && citationCtx.chunkBundle && citationCtx.verdict && citationCtx.session) {
    errors.push(..._validateSkuCitationRules(raw, citationCtx));
  }

  return { valid: errors.length === 0, reply: errors.length === 0 ? raw : null, errors };
}

/**
 * D4: log rejected composer / LLM payloads when LOG_ROUTINE_REPLY_REJECTED=1.
 * Never log full user PHI — keep to schema errors + redacted shape.
 */
function logRoutineReplyRejected(ctx = {}) {
  if (process.env.LOG_ROUTINE_REPLY_REJECTED !== '1') return;
  const payload = {
    ts: new Date().toISOString(),
    source: ctx.source || 'compose_local',
    errors: ctx.errors || [],
    overall: ctx.reply && ctx.reply.overall,
    conflict_count: ctx.reply && Array.isArray(ctx.reply.conflicts) ? ctx.reply.conflicts.length : undefined,
    cited_chunk_ids: ctx.reply && Array.isArray(ctx.reply.cited_chunk_ids) ? ctx.reply.cited_chunk_ids : undefined,
    context: ctx.context || null,
  };
  console.warn('[routine_reply_rejected]', JSON.stringify(payload));
}

/**
 * D4 — Strip optional ```json fences and parse LLM output.
 * @returns {object|null} parsed object or null on failure
 */
function parseRoutineReplyJsonFromLlmText(text) {
  let s = String(text || '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

/**
 * D4 — Validate composer JSON from an external LLM; log rejects when LOG_ROUTINE_REPLY_REJECTED=1.
 */
function validateExternalLlmRoutineReply(llmText, context = {}) {
  const parsed = parseRoutineReplyJsonFromLlmText(llmText);
  if (!parsed || typeof parsed !== 'object') {
    const errors = ['invalid_or_non_json_routine_reply'];
    logRoutineReplyRejected({
      source: 'external_llm',
      errors,
      reply: null,
      context: { ...context, stage: 'parse' },
    });
    return { valid: false, reply: null, errors };
  }
  const validation = validateReply(parsed, context.citationCtx);
  if (!validation.valid) {
    logRoutineReplyRejected({
      source: 'external_llm',
      errors: validation.errors,
      reply: parsed,
      context: { ...context, stage: 'schema' },
    });
  }
  return validation;
}

function _routineHasOutdoorExposure(session) {
  if (!session || !Array.isArray(session.current_routine)) return false;
  return session.current_routine.some((slot) =>
    (slot.products || []).some((p) => p.exposure === 'outdoor')
  );
}

function _bareInci(id) {
  return String(id || '').replace(/^cosing:/i, '').trim().toLowerCase();
}

function _pairKeyForConflict(ingA, ingB) {
  const a = _bareInci(ingA);
  const b = _bareInci(ingB);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function _pairKeyForChunk(ch) {
  if (!ch.ingredient_a || !ch.ingredient_b) return null;
  return _pairKeyForConflict(ch.ingredient_a, ch.ingredient_b);
}

function buildSystemPrompt(verdict, chunkBundle, session) {
  const conflictBlock = verdict.conflicts.length === 0
    ? 'No conflicts detected. All ingredients are compatible.'
    : verdict.conflicts.map((c) => {
        const tags = Array.isArray(c.context_tags) && c.context_tags.length
          ? `  context:  ${c.context_tags.join(', ')}`
          : null;
        const impact =
          c.role_pair_impact != null && Number.isFinite(c.role_pair_impact)
            ? `  role_pair_impact: ${c.role_pair_impact} (higher = more high-impact step types involved)`
            : null;
        return [
          `CONFLICT: ${c.ingredient_a} + ${c.ingredient_b}`,
          `  severity: ${c.severity}`,
          `  verdict:  ${c.verdict}`,
          `  spacing:  ${c.spacing_hours === null ? 'BLOCKED — do not use same session' : `stagger by ${c.spacing_hours}h`}`,
          `  notes:    ${c.notes}`,
          ...(tags ? [tags] : []),
          ...(impact ? [impact] : []),
        ].join('\n');
      }).join('\n\n');

  const chunksBlock = chunkBundle.chunks.length === 0
    ? 'No evidence chunks available.'
    : chunkBundle.chunks.map((ch) => {
        const tier = ch.chunk_source_tier || 'unknown';
        const pid = ch.product_id ? ` product_id="${String(ch.product_id).replace(/"/g, '')}"` : '';
        const sku = ch.sku ? ` sku="${String(ch.sku).replace(/"/g, '')}"` : '';
        return `[CHUNK id="${ch.id}" tier="${tier}" evidence="${ch.evidence_level}"${pid}${sku}]\n${ch.text}`;
      }).join('\n\n');

  const sessionLines = [
    `skin_goals: ${session.skin_goals.join(', ') || 'not specified'}`,
    `sensitivity: ${session.sensitivity}`,
    `contraindications: ${session.contraindications.join(', ') || 'none'}`,
  ];
  if (_routineHasOutdoorExposure(session)) {
    sessionLines.push(
      'routine_context: at least one step is marked outdoor exposure — remind the user about broad-spectrum SPF when discussing photosensitizing or daytime actives.'
    );
  }
  const sessionBlock = sessionLines.join('\n');

  return `You are a skincare ingredient safety assistant. Your reply MUST follow ALL of these rules:

## BINDING RULES (non-negotiable)
1. You MUST output a JSON object matching the RoutineReply schema exactly — no extra keys.
2. The "overall" field MUST match the verdict: "${verdict.overall}". Do not change it.
3. For every conflict listed in CONFLICTS below, you MUST include a corresponding entry in
   the "conflicts" array with the SAME verdict (avoid/caution/info). Do not soften "avoid" to "caution".
4. Every claim about chemistry or safety MUST cite at least one chunk ID from EVIDENCE CHUNKS below,
   using the format [chunk_id] inline in the narrative text.
4b. When a chunk includes product_id or sku attributes, treat it as product-specific evidence; prefer citing those IDs when the user asked about that exact product.
4c. When tier="knowledge_sku" chunks exist for a conflict and the user's routine lists that product_id, you MUST include at least one of those chunk ids in that conflict's citation_ids (schema validation enforces this).
5. If overall is "avoid", the word "avoid" must appear prominently in the narrative's first sentence.
6. Do NOT invent chemistry. If no chunk supports a claim, omit the claim.
7. sensitive_note must be non-null if session sensitivity is "moderate" or "severe".

## VERDICT
overall: ${verdict.overall}
${conflictBlock}

## EVIDENCE CHUNKS (cite these IDs — do not quote; paraphrase)
${chunksBlock}

## USER SESSION
${sessionBlock}

## OUTPUT SCHEMA (JSON only — no markdown fences, no prose before/after)
{
  "overall": "safe"|"caution"|"avoid",
  "conflicts": [
    {
      "ingredient_a": string,
      "ingredient_b": string,
      "verdict": "avoid"|"caution"|"info",
      "reason": string,
      "citation_ids": string[],
      "spacing_hours": number|null
    }
  ],
  "suggested_split": { "am": string[], "pm": string[] } | null,
  "safe_to_combine": string[],
  "narrative": string,
  "cited_chunk_ids": string[],
  "reason_codes": string[],
  "sensitive_note": string|null,
  "contraindication_warnings": string[]
}`;
}

function buildUserPrompt(userMessage, session, contextBundle = null) {
  const routineSummary = session.current_routine.length === 0
    ? 'No products in routine yet.'
    : session.current_routine.map((slot) => {
        const lines = (slot.products || []).map((p) => {
          const bits = [p.name || p.product_id || 'product'];
          if (p.role && p.role !== 'unknown') bits.push(`role=${p.role}`);
          if (p.exposure && p.exposure !== 'unknown') bits.push(`exposure=${p.exposure}`);
          if (p.wash_off) bits.push('wash_off');
          return bits.join(' ');
        });
        return `${slot.time.toUpperCase()}:\n  ${lines.join('\n  ')}`;
      }).join('\n');

  let profile = '';
  if (contextBundle && typeof contextBundle === 'object') {
    profile = `SESSION SUMMARY:\n- skin_goals: ${(contextBundle.skin_goals || []).join(', ') || 'none'}\n- sensitivity: ${contextBundle.sensitivity || 'none'}\n- contraindications: ${(contextBundle.contraindications || []).join(', ') || 'none'}\n- outdoor_exposure_step: ${contextBundle.has_outdoor_exposure_step ? 'yes' : 'no'}\n\n`;
  }

  return `USER MESSAGE: ${userMessage}

${profile}CURRENT ROUTINE:
${routineSummary}

Reply with the RoutineReply JSON object as instructed.`;
}

function composeLocal(verdict, chunkBundle, session) {
  const conflicts = verdict.conflicts.map((c) => {
    const na = _bareInci(c.ingredient_a);
    const nb = _bareInci(c.ingredient_b);
    const pk = _pairKeyForConflict(c.ingredient_a, c.ingredient_b);
    let supporting = chunkBundle.chunks.filter((ch) => _pairKeyForChunk(ch) === pk);
    if (!supporting.length) {
      supporting = chunkBundle.chunks.filter((ch) => {
        if (!ch.supports || ch.supports.length < 2) return false;
        const s = new Set(ch.supports.map(_bareInci));
        return s.has(na) && s.has(nb);
      });
    }
    const monoSku = chunkBundle.chunks.filter(
      (ch) =>
        skuChunkSupportsConflict(ch, c) &&
        !ch.ingredient_b &&
        routineProductIdsTouchingIngredients(session, c.ingredient_a, c.ingredient_b).has(
          String(ch.product_id)
        )
    );
    supporting = [...supporting, ...monoSku.filter((m) => !supporting.some((s) => s.id === m.id))];

    const touching = routineProductIdsTouchingIngredients(session, c.ingredient_a, c.ingredient_b);
    const preferSku = (ch) =>
      ch.chunk_source_tier === 'knowledge_sku' &&
      ch.product_id &&
      touching.has(String(ch.product_id)) &&
      skuChunkSupportsConflict(ch, c);
    supporting = [...supporting].sort((a, b) => {
      const pa = preferSku(a) ? 1 : 0;
      const pb = preferSku(b) ? 1 : 0;
      if (pb !== pa) return pb - pa;
      return 0;
    });

    let citation_ids = supporting.slice(0, 2).map((ch) => ch.id);
    if (!citation_ids.length && chunkBundle.chunks.length) {
      citation_ids = [chunkBundle.chunks[0].id];
    }
    return {
      ingredient_a: na,
      ingredient_b: nb,
      verdict: c.verdict,
      reason: _autoReason(c, citation_ids),
      citation_ids,
      spacing_hours: c.spacing_hours,
    };
  });

  const allCitedIds = [...new Set(conflicts.flatMap((c) => c.citation_ids))];

  const safeNames = verdict.safe_ids.map((id) => id.replace(/^cosing:/, ''));

  const narrativeParts = [`Overall assessment: ${verdict.overall.toUpperCase()}.`];
  if (verdict.overall === 'avoid') {
    narrativeParts.push('One or more combinations in this routine must be avoided — they cannot be safely used in the same session.');
  } else if (verdict.overall === 'caution') {
    narrativeParts.push('Some combinations require careful timing or separation.');
  }
  for (const c of conflicts) {
    const cite = c.citation_ids.length ? ` [${c.citation_ids[0]}]` : '';
    narrativeParts.push(`${c.ingredient_a} and ${c.ingredient_b}: ${c.reason}${cite}`);
  }
  if (safeNames.length) {
    narrativeParts.push(`Safe to use together without restriction: ${safeNames.join(', ')}.`);
  }

  const sensitiveNote = (session.sensitivity === 'moderate' || session.sensitivity === 'severe')
    ? `This routine assessment applies extra caution because your skin sensitivity is listed as "${session.sensitivity}". Consider starting with lower concentrations and patch-testing any new active.`
    : null;

  const contraindicationWarnings = _checkContraindications(verdict, session);

  return {
    overall: verdict.overall,
    conflicts,
    suggested_split: verdict.suggested_split,
    safe_to_combine: safeNames,
    narrative: narrativeParts.join(' '),
    cited_chunk_ids: allCitedIds,
    reason_codes: verdict.reason_codes,
    sensitive_note: sensitiveNote,
    contraindication_warnings: contraindicationWarnings,
  };
}

function _autoReason(conflict, citationIds) {
  const na = _bareInci(conflict.ingredient_a);
  const nb = _bareInci(conflict.ingredient_b);
  const head = (conflict.notes || '').split('.')[0];
  const outdoor =
    Array.isArray(conflict.context_tags) &&
    conflict.context_tags.includes('context:outdoor_uv_actives')
      ? ' With outdoor leave-on use, prioritize broad-spectrum SPF and shade.'
      : '';
  if (conflict.verdict === 'avoid') {
    return `${na} and ${nb} must not be used in the same session — ${head ? head.toLowerCase() : 'see evidence cited.'}${outdoor}`;
  }
  if (conflict.verdict === 'caution') {
    const stagger = conflict.spacing_hours
      ? `Apply with at least ${conflict.spacing_hours} hours between them.`
      : 'Use in separate AM/PM sessions.';
    return `${na} and ${nb} can interact — use with caution. ${stagger}${outdoor}`;
  }
  return `${na} and ${nb} may interact under certain conditions; evidence is ${conflict.evidence_level}.${outdoor}`;
}

function _checkContraindications(verdict, session) {
  const warnings = [];
  const ci = session.contraindications || [];
  const fromPairs = verdict.conflicts.flatMap((c) => [c.ingredient_a, c.ingredient_b]);
  const fromSafe = (verdict.safe_ids || []).map((id) =>
    String(id || '').replace(/^cosing:/i, '').trim().toLowerCase()
  );
  const allIds = [...fromPairs, ...fromSafe];

  if (ci.includes('pregnant') || ci.includes('breastfeeding')) {
    const retinoids = allIds.filter((id) => {
      const s = String(id || '').toLowerCase();
      return s.includes('retinol') || s.includes('tretinoin');
    });
    if (retinoids.length) {
      warnings.push('IMPORTANT: Retinoids (retinol, tretinoin) are not recommended during pregnancy or breastfeeding. Please consult your healthcare provider.');
    }
  }
  if (ci.includes('on_rx_retinoid') || ci.includes('on_isotretinoin')) {
    const hasOtc = allIds.some((id) => String(id || '').toLowerCase().includes('retinol'));
    if (hasOtc) {
      warnings.push('You are already on a prescription retinoid. Adding OTC retinol creates cumulative retinoid exposure — discuss with your prescriber before adding it to your routine.');
    }
  }
  return warnings;
}

module.exports = {
  buildSystemPrompt,
  buildUserPrompt,
  validateReply,
  composeLocal,
  logRoutineReplyRejected,
  parseRoutineReplyJsonFromLlmText,
  validateExternalLlmRoutineReply,
  collectRoutineProductIds,
  routineProductIdsTouchingIngredients,
  skuChunkSupportsConflict,
};
