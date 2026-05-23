'use strict';

const path = require('path');
const fs = require('fs');

const CONCERN_LABELS = {
  anti_aging: 'Anti-aging care plan',
  acne: 'Acne care plan',
  hyperpigmentation: 'Hyperpigmentation care plan',
  barrier_repair: 'Barrier repair care plan',
  rosacea: 'Rosacea care plan',
};

const VALID_CONCERNS = new Set(Object.keys(CONCERN_LABELS));

let _catalog = null;

function loadCatalog() {
  if (_catalog) return _catalog;
  const filePath = path.join(__dirname, '../data/routines/concern-routines.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  _catalog = JSON.parse(raw);
  return _catalog;
}

function resetCatalogCache() {
  _catalog = null;
}

function listConcerns() {
  const catalog = loadCatalog();
  return Object.keys(catalog)
    .filter((id) => VALID_CONCERNS.has(id))
    .map((id) => {
      const row = catalog[id];
      return {
        id,
        label: CONCERN_LABELS[id] || id,
        total_weeks: Number(row.total_weeks) || 12,
        skin_type: row.skin_type || null,
      };
    });
}

function getConcernProgram(concernId) {
  const id = String(concernId || '').trim();
  if (!VALID_CONCERNS.has(id)) return null;
  return loadCatalog()[id] || null;
}

function parsePhaseKey(key) {
  const m = String(key || '').match(/^weeks_(\d+)_(\d+)$/);
  if (!m) return null;
  return {
    key: String(key),
    week_start: parseInt(m[1], 10),
    week_end: parseInt(m[2], 10),
  };
}

function listPhases(weeklySchedule) {
  if (!weeklySchedule || typeof weeklySchedule !== 'object') return [];
  return Object.keys(weeklySchedule)
    .map((key) => {
      const parsed = parsePhaseKey(key);
      if (!parsed) return null;
      return { ...parsed, ...weeklySchedule[key] };
    })
    .filter(Boolean)
    .sort((a, b) => a.week_start - b.week_start);
}

function programWeekForDate(startDateIso, targetDateIso) {
  const start = new Date(`${startDateIso}T12:00:00`);
  const target = new Date(`${targetDateIso}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime())) return 1;
  const diffDays = Math.floor((target.getTime() - start.getTime()) / 86400000);
  if (diffDays < 0) return 1;
  return Math.floor(diffDays / 7) + 1;
}

function resolveCurrentPhase(program, startDateIso, targetDateIso) {
  const startDate = String(startDateIso || '').trim() || new Date().toISOString().slice(0, 10);
  const targetDate = String(targetDateIso || '').trim() || startDate;
  const programWeek = programWeekForDate(startDate, targetDate);
  const totalWeeks = Math.max(1, Number(program?.total_weeks) || 12);
  const phases = listPhases(program?.weekly_schedule);

  let active = phases[0] || null;
  for (const phase of phases) {
    if (programWeek >= phase.week_start && programWeek <= phase.week_end) {
      active = phase;
      break;
    }
    if (programWeek > phase.week_end) {
      active = phase;
    }
  }

  const amSteps = Array.isArray(active?.am_steps) ? active.am_steps : [];
  const pmSteps = Array.isArray(active?.pm_steps) ? active.pm_steps : [];

  return {
    program_week: Math.min(programWeek, totalWeeks),
    total_weeks: totalWeeks,
    phase_key: active?.key || null,
    label: active?.label || null,
    focus: active?.focus || null,
    notes: active?.notes || null,
    expect: active?.expect || null,
    photo_prompt: Boolean(active?.photo_prompt),
    am_steps: amSteps,
    pm_steps: pmSteps,
    phases: phases.map((p) => ({
      key: p.key,
      week_start: p.week_start,
      week_end: p.week_end,
      label: p.label,
      photo_prompt: Boolean(p.photo_prompt),
    })),
  };
}

function stepsToItems(amSteps, pmSteps, baselineAm, baselinePm) {
  const items = [];
  let order = 1;
  const pushSteps = (steps, usageTime, baseline) => {
    (steps || []).forEach((stepText, idx) => {
      const name = String(stepText || '').trim();
      if (!name) return;
      const baselineRow = Array.isArray(baseline) ? baseline[idx] : null;
      items.push({
        product_name: name,
        usage_time: usageTime,
        goal: baselineRow?.reason ? String(baselineRow.reason) : null,
        step_order: order++,
        source_type: 'care_program',
      });
    });
  };
  pushSteps(amSteps, 'am', baselineAm);
  pushSteps(pmSteps, 'pm', baselinePm);
  return items;
}

function buildTemplatePayload(concernId, startDate) {
  const program = getConcernProgram(concernId);
  if (!program) {
    throw new Error(`Unknown concern_id: ${concernId}`);
  }
  const start = String(startDate || '').trim() || new Date().toISOString().slice(0, 10);
  const totalWeeks = Math.max(1, Number(program.total_weeks) || 12);
  const durationDays = totalWeeks * 7;
  const phase = resolveCurrentPhase(program, start, start);
  const items = stepsToItems(phase.am_steps, phase.pm_steps, program.am_routine, program.pm_routine);
  if (!items.length) {
    throw new Error('Routine has no steps for the starting phase.');
  }
  const metadata = {
    concern: program.concern,
    skin_type: program.skin_type,
    total_weeks: totalWeeks,
    key_rules: program.key_rules || [],
    red_flags: program.red_flags || [],
    weekly_schedule: program.weekly_schedule || {},
    am_routine: program.am_routine || [],
    pm_routine: program.pm_routine || [],
  };
  return {
    name: CONCERN_LABELS[concernId] || 'Your care plan',
    start_date: start,
    duration_days: durationDays,
    concern_id: concernId,
    items,
    metadata_json: metadata,
    program_week: 1,
  };
}

function buildWeekOnePreview(program) {
  const phases = listPhases(program?.weekly_schedule);
  const first = phases[0] || null;
  if (!first) {
    return {
      label: null,
      focus: null,
      expect: null,
      notes: null,
      am_steps: [],
      pm_steps: [],
      week_start: 1,
      week_end: 1,
    };
  }
  return {
    key: first.key,
    label: first.label || null,
    focus: first.focus || null,
    expect: first.expect || null,
    notes: first.notes || null,
    am_steps: Array.isArray(first.am_steps) ? first.am_steps : [],
    pm_steps: Array.isArray(first.pm_steps) ? first.pm_steps : [],
    week_start: first.week_start,
    week_end: first.week_end,
  };
}

function buildPreview(concernId) {
  const program = getConcernProgram(concernId);
  if (!program) return null;
  const phases = listPhases(program.weekly_schedule);
  const keyRules = program.key_rules || [];
  const redFlags = program.red_flags || [];
  return {
    concern_id: concernId,
    label: CONCERN_LABELS[concernId] || concernId,
    total_weeks: Number(program.total_weeks) || 12,
    skin_type: program.skin_type || null,
    key_rules: keyRules,
    red_flags: redFlags,
    week_one: buildWeekOnePreview(program),
    week_one_key_rule: keyRules.length ? String(keyRules[0]) : null,
    week_one_red_flag: redFlags.length ? String(redFlags[0]) : null,
    phases: phases.map((p) => ({
      key: p.key,
      week_start: p.week_start,
      week_end: p.week_end,
      label: p.label,
      focus: p.focus,
      expect: p.expect || null,
      photo_prompt: Boolean(p.photo_prompt),
    })),
  };
}

function phaseStepsAsTemplateItems(phase, program) {
  return stepsToItems(
    phase?.am_steps,
    phase?.pm_steps,
    program?.am_routine,
    program?.pm_routine
  );
}

/** Soft-update active template item labels from current phase (does not touch frozen_steps history). */
function syncTemplateDisplayFromPhase(db, templateId, phaseItems) {
  if (!db || !templateId || !Array.isArray(phaseItems) || !phaseItems.length) {
    return { updated: 0 };
  }
  const existing = db
    .prepare(`
      SELECT id, usage_time, step_order
      FROM patient_routine_template_items
      WHERE template_id = ? AND is_active = 1
      ORDER BY step_order ASC, datetime(created_at) ASC
    `)
    .all(templateId);
  let updated = 0;
  for (let i = 0; i < Math.min(existing.length, phaseItems.length); i += 1) {
    const src = phaseItems[i];
    const row = existing[i];
    if (!row?.id || !src?.product_name) continue;
    db.prepare(`
      UPDATE patient_routine_template_items
      SET product_name = ?, goal = ?, updated_at = datetime('now')
      WHERE id = ? AND (source_ref_id IS NULL OR source_ref_id = '')
    `).run(String(src.product_name), src.goal ? String(src.goal) : null, row.id);
    updated += 1;
  }
  return { updated };
}

module.exports = {
  CONCERN_LABELS,
  VALID_CONCERNS,
  loadCatalog,
  resetCatalogCache,
  listConcerns,
  getConcernProgram,
  listPhases,
  parsePhaseKey,
  programWeekForDate,
  resolveCurrentPhase,
  buildTemplatePayload,
  buildPreview,
  buildWeekOnePreview,
  phaseStepsAsTemplateItems,
  syncTemplateDisplayFromPhase,
};
