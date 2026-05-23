'use strict';

const { resolveRoutineDayMode } = require('./routine-day-mode');

/**
 * Photo-first daily log: one progress photo marks all template steps complete for the day.
 */

function syncItemLogsForPhotoDay(db, { dailyEntryId, templateId }) {
  const entryId = String(dailyEntryId || '').trim();
  const tplId = String(templateId || '').trim();
  if (!entryId || !tplId) return { itemsCompleted: 0 };

  const items = db.prepare(`
    SELECT id FROM patient_routine_template_items
    WHERE template_id = ? AND is_active = 1
    ORDER BY step_order ASC, datetime(created_at) ASC
  `).all(tplId);

  db.prepare(`DELETE FROM patient_routine_daily_item_logs WHERE daily_entry_id = ?`).run(entryId);

  const insertLog = db.prepare(`
    INSERT INTO patient_routine_daily_item_logs (
      id, daily_entry_id, template_item_id, completed, notes, created_at, updated_at
    ) VALUES (?, ?, ?, 1, NULL, datetime('now'), datetime('now'))
  `);

  let count = 0;
  for (const item of items) {
    if (!item?.id) continue;
    const logId = `rdl_${entryId}_${String(item.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    insertLog.run(logId, entryId, String(item.id));
    count += 1;
  }

  return { itemsCompleted: count };
}

function buildPhotoAssistantSummary({ entryDate, phase }) {
  const date = String(entryDate || '').trim();
  const programWeek = Number(phase?.program_week) || 1;
  const totalWeeks = Number(phase?.total_weeks) || 12;
  const label = phase?.label ? String(phase.label).trim() : '';
  const expect = phase?.expect ? String(phase.expect).trim() : '';
  const focus = phase?.focus ? String(phase.focus).trim() : '';

  const weekLine = label
    ? `Week ${programWeek} of ${totalWeeks} · ${label}`
    : `Week ${programWeek} of ${totalWeeks}`;

  if (expect) {
    return `${weekLine}. ${expect}`;
  }
  if (focus) {
    return `${weekLine}. ${focus}`;
  }
  if (date) {
    return `Photo saved for ${date}. ${weekLine}.`;
  }
  return weekLine;
}

function normalizeFrozenSteps(frozenSteps) {
  if (!Array.isArray(frozenSteps)) return [];
  return frozenSteps.map((row, idx) => ({
    product_name: row?.product_name ? String(row.product_name) : 'Step',
    usage_time: row?.usage_time ? String(row.usage_time) : 'any',
    goal: row?.goal ? String(row.goal) : null,
    step_order: Number(row?.step_order) || idx + 1,
  }));
}

function buildPhotoSkinReport({ entryDate, phase, storageRef, frozenSteps, dayMode, symptomTags }) {
  const assistantSummary = buildPhotoAssistantSummary({ entryDate, phase });
  const programWeek = Number(phase?.program_week) || 1;
  const totalWeeks = Number(phase?.total_weeks) || 12;
  const phaseLabel = phase?.label ? String(phase.label).trim() : null;

  return {
    source: 'patient_photo',
    entry_date: String(entryDate || '').trim(),
    program_week: programWeek,
    total_weeks: totalWeeks,
    phase_key: phase?.phase_key || null,
    phase_label: phaseLabel,
    photo_prompt: Boolean(phase?.photo_prompt),
    assistant_summary: assistantSummary,
    logged_via: 'photo',
    storage_ref: storageRef ? String(storageRef) : null,
    day_mode: dayMode || null,
    frozen_steps: normalizeFrozenSteps(frozenSteps),
    symptom_tags: Array.isArray(symptomTags)
      ? symptomTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
      : [],
  };
}

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {string} opts.dailyEntryId
 * @param {string} opts.templateId
 * @param {string} opts.entryDate
 * @param {object|null} opts.phaseSnap
 * @param {object} opts.program
 * @param {object} opts.concernRoutineService
 * @param {string} opts.storageRef
 * @param {string} [opts.todayIso]
 */
function applyPhotoDayCompletion(opts) {
  const {
    db,
    dailyEntryId,
    templateId,
    entryDate,
    phaseSnap,
    program,
    concernRoutineService,
    storageRef,
    todayIso,
    symptomTags,
  } = opts;

  const dayMode = resolveRoutineDayMode(entryDate, todayIso);
  const frozenSteps = concernRoutineService.phaseStepsAsTemplateItems(phaseSnap || {}, program || {});
  const skinReportObj = buildPhotoSkinReport({
    entryDate,
    phase: phaseSnap,
    storageRef,
    frozenSteps,
    dayMode: dayMode.mode,
    symptomTags: symptomTags || [],
  });
  const skinReport = JSON.stringify(skinReportObj);

  db.prepare(`
    UPDATE patient_routine_daily_entries
    SET skin_report = ?, completion_score = 100, notes = COALESCE(notes, 'Progress photo'), updated_at = datetime('now')
    WHERE id = ?
  `).run(skinReport, dailyEntryId);

  let itemsCompleted = 0;
  if (dayMode.mode === 'today') {
    const syncResult = syncItemLogsForPhotoDay(db, { dailyEntryId, templateId });
    itemsCompleted = syncResult.itemsCompleted;
  }

  return {
    skinReport: skinReportObj,
    assistantSummary: skinReportObj.assistant_summary,
    dayMode: dayMode.mode,
    itemsCompleted,
  };
}

module.exports = {
  syncItemLogsForPhotoDay,
  buildPhotoAssistantSummary,
  buildPhotoSkinReport,
  normalizeFrozenSteps,
  applyPhotoDayCompletion,
  resolveRoutineDayMode,
};
