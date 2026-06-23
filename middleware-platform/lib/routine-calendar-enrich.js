'use strict';

const { isPurgeWindowPhase, truncateSnippet } = require('./routine-day-mode');

function resolvePhaseBand(programWeek, phaseKey, concernId, isPurge) {
  if (isPurge) return 'purge';
  const week = Number(programWeek) || 0;
  if (week <= 2) return 'intro';
  if (week <= 8) return 'active';
  const key = String(phaseKey || '');
  if (key.startsWith('weeks_9') || key.startsWith('weeks_10')) return 'optimise';
  return 'maintain';
}

function resolveMilestoneLabel(programWeek, phaseKey, concernId, isPurge, hasMedia) {
  if (hasMedia && isPurge) return 'Purge window';
  if (!hasMedia && isPurge) return 'Purging likely';
  if (Number(programWeek) === 1 && !hasMedia) return 'Baseline';
  const key = String(phaseKey || '');
  if (key === 'weeks_3_4' && !hasMedia) return 'Actives start';
  if (key === 'weeks_5_8' && !hasMedia) return 'Retinoid phase';
  if (Number(programWeek) === 8 && !hasMedia) return 'Mid-program';
  if (key === 'weeks_9_12' && !hasMedia) return 'Results phase';
  return null;
}

function parseSymptomsFromSkinReport(skinReportRaw) {
  if (!skinReportRaw) return { tags: [], has_symptoms: false, top_symptom: null };
  let parsed = null;
  try {
    parsed = typeof skinReportRaw === 'string' ? JSON.parse(skinReportRaw) : skinReportRaw;
  } catch (_) {
    return { tags: [], has_symptoms: false, top_symptom: null };
  }
  const tags = Array.isArray(parsed?.symptom_tags)
    ? parsed.symptom_tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  return {
    tags,
    has_symptoms: tags.length > 0,
    top_symptom: tags[0] || null,
  };
}

function enrichRoutineCalendarDay(base, { careProgram, tplStartIso, concernId, entryRow }) {
  const iso = base.date;
  let photoPrompt = false;
  let programWeek = null;
  let phaseLabel = null;
  let phaseKey = null;
  let phaseExpectSnippet = null;
  let isPurgeWindow = false;
  let phaseBand = null;
  let milestoneLabel = null;

  if (careProgram && base.is_routine_day) {
    const concernRoutineService = require('../services/platform/concern-routine-service');
    const phaseSnap = concernRoutineService.resolveCurrentPhase(careProgram, tplStartIso, iso);
    photoPrompt = Boolean(phaseSnap?.photo_prompt);
    programWeek = phaseSnap?.program_week ?? null;
    phaseLabel = phaseSnap?.label ?? null;
    phaseKey = phaseSnap?.phase_key ?? null;
    phaseExpectSnippet = truncateSnippet(phaseSnap?.expect);
    isPurgeWindow = isPurgeWindowPhase(programWeek, phaseKey, concernId);
    phaseBand = resolvePhaseBand(programWeek, phaseKey, concernId, isPurgeWindow);
    milestoneLabel = resolveMilestoneLabel(
      programWeek,
      phaseKey,
      concernId,
      isPurgeWindow,
      Boolean(base.has_media)
    );
  }

  const symptomInfo = parseSymptomsFromSkinReport(entryRow?.skin_report);

  return {
    ...base,
    photo_prompt: photoPrompt,
    program_week: programWeek,
    phase_label: phaseLabel,
    phase_key: phaseKey,
    phase_expect_snippet: phaseExpectSnippet,
    is_purge_window: isPurgeWindow,
    phase_band: phaseBand,
    milestone_label: milestoneLabel,
    has_symptoms: symptomInfo.has_symptoms,
    symptom_tags: symptomInfo.tags,
    top_symptom: symptomInfo.top_symptom,
  };
}

module.exports = {
  resolvePhaseBand,
  resolveMilestoneLabel,
  parseSymptomsFromSkinReport,
  enrichRoutineCalendarDay,
};
