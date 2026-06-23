#!/usr/bin/env node
'use strict';

/**
 * Sandbox: photo-first loop + all concern phases.
 * Run from repo root:
 *   node middleware-platform/scripts/sandbox-routine-photo-loop.cjs
 * Or:
 *   npm run sandbox:routine-photo --prefix middleware-platform
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  listConcerns,
  getConcernProgram,
  resolveCurrentPhase,
  buildTemplatePayload,
} = require('../services/platform/concern-routine-service');
const { syncItemLogsForPhotoDay, buildPhotoAssistantSummary } = require('../lib/routine-photo-day');
const { buildCompareDay } = require('../lib/routine-compare-helper');

const DEBUG_LOG =
  process.env.SANDBOX_ROUTINE_LOG ||
  path.join(__dirname, '../../.cursor/sandbox-routine-photo-loop.log');
const SESSION_ID = 'sandbox-routine-photo';

function agentLog(hypothesisId, location, message, data, runId = 'sandbox') {
  const line = JSON.stringify({
    sessionId: SESSION_ID,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
    runId,
  });
  if (process.env.SANDBOX_ROUTINE_NO_LOG !== '1') {
    try {
      fs.appendFileSync(DEBUG_LOG, `${line}\n`);
    } catch (_) {}
  }
  console.log(`[${hypothesisId}] ${message}`, data ? JSON.stringify(data) : '');
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE patient_routine_templates (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      name TEXT,
      concern_id TEXT,
      start_date TEXT,
      duration_days INTEGER,
      is_active INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE patient_routine_template_items (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      product_name TEXT,
      usage_time TEXT,
      goal TEXT,
      step_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE patient_routine_daily_entries (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      entry_date TEXT NOT NULL,
      skin_report TEXT,
      completion_score INTEGER DEFAULT 0,
      UNIQUE(template_id, entry_date)
    );
    CREATE TABLE patient_routine_daily_media (
      id TEXT PRIMARY KEY,
      daily_entry_id TEXT NOT NULL,
      media_url TEXT,
      patient_document_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE patient_routine_daily_item_logs (
      id TEXT PRIMARY KEY,
      daily_entry_id TEXT NOT NULL,
      template_item_id TEXT,
      completed INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function insertTemplate(db, concernId, startDate) {
  const payload = buildTemplatePayload(concernId, startDate);
  const tplId = `tpl_${concernId}`;
  db.prepare(`
    INSERT INTO patient_routine_templates (id, session_id, name, concern_id, start_date, duration_days, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(tplId, SESSION_ID, payload.name, concernId, startDate, payload.duration_days);

  const insItem = db.prepare(`
    INSERT INTO patient_routine_template_items (id, template_id, product_name, usage_time, goal, step_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  payload.items.forEach((it, idx) => {
    insItem.run(`item_${tplId}_${idx}`, tplId, it.product_name, it.usage_time, it.goal, it.step_order || idx + 1);
  });
  return { tplId, itemCount: payload.items.length };
}

function simulatePhotoDay(db, tplId, entryDate) {
  const entryId = `rde_${tplId}_${entryDate}`;
  const skinReport = JSON.stringify({ program_week: 2, phase_label: 'Sandbox phase', assistant_summary: 'Sandbox day logged.' });
  db.prepare(`
    INSERT INTO patient_routine_daily_entries (id, template_id, session_id, entry_date, skin_report, completion_score)
    VALUES (?, ?, ?, ?, ?, 100)
  `).run(entryId, tplId, SESSION_ID, entryDate, skinReport);
  db.prepare(`
    INSERT INTO patient_routine_daily_media (id, daily_entry_id, media_url, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(`media_${entryId}`, entryId, `https://sandbox.example/${entryDate}.jpg`);
  const sync = syncItemLogsForPhotoDay(db, { dailyEntryId: entryId, templateId: tplId });
  return { entryId, ...sync };
}

function enumerateDates(fromIso, toIso) {
  const out = [];
  let d = new Date(`${fromIso}T12:00:00.000Z`);
  const endD = new Date(`${toIso}T12:00:00.000Z`);
  while (d <= endD) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime());
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Mirrors GET /api/patient/home/progress-summary card + summary math. */
function computeProgressSummary(db, tplId, windowStartIso, windowEndIso) {
  const items = db
    .prepare(`SELECT id FROM patient_routine_template_items WHERE template_id = ? AND is_active = 1`)
    .all(tplId);
  const weekEntries = db
    .prepare(
      `SELECT id, entry_date, completion_score FROM patient_routine_daily_entries
       WHERE template_id = ? AND entry_date BETWEEN ? AND ?`
    )
    .all(tplId, windowStartIso, windowEndIso);
  const entryByDate = new Map(weekEntries.map((r) => [r.entry_date, r]));
  const weekDates = enumerateDates(windowStartIso, windowEndIso);
  const nDays = weekDates.length || 7;
  const scoreFor = (iso) => {
    const row = entryByDate.get(iso);
    return row ? Math.max(0, Math.min(100, Number(row.completion_score) || 0)) : 0;
  };
  const todayIso = weekDates[0] || windowStartIso;
  const todayEntry = entryByDate.get(todayIso);
  const todayLogged = todayEntry ? scoreFor(todayIso) >= 100 : false;
  let inProgress = 0;
  if (!items.length) {
    inProgress = 0;
  } else if (!todayEntry) {
    inProgress = items.length;
  } else if (todayLogged) {
    inProgress = 0;
  } else {
    const logsToday = db
      .prepare(`SELECT template_item_id, completed FROM patient_routine_daily_item_logs WHERE daily_entry_id = ?`)
      .all(todayEntry.id);
    const done = new Set(
      logsToday.filter((l) => Number(l.completed) === 1).map((l) => l.template_item_id)
    );
    inProgress = items.filter((it) => !done.has(it.id)).length;
  }
  const photoCompleteDaysRow = db
    .prepare(
      `SELECT COUNT(DISTINCT entry_date) AS n FROM patient_routine_daily_entries
       WHERE template_id = ? AND entry_date BETWEEN ? AND ? AND completion_score >= 100`
    )
    .get(tplId, windowStartIso, windowEndIso);
  const photoCompleteDays = Number(photoCompleteDaysRow?.n) || 0;
  const pcts = items.map((it) => {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT e.entry_date) AS days_done
         FROM patient_routine_daily_item_logs l
         INNER JOIN patient_routine_daily_entries e ON e.id = l.daily_entry_id
         WHERE e.template_id = ? AND e.entry_date BETWEEN ? AND ? AND l.template_item_id = ? AND l.completed = 1`
      )
      .get(tplId, windowStartIso, windowEndIso, it.id);
    const logDays = Number(row?.days_done) || 0;
    const daysDone = Math.max(logDays, photoCompleteDays);
    return Math.round(Math.min(100, (daysDone / nDays) * 100));
  });
  return { pcts, photoCompleteDays, itemCount: items.length, todayLogged, inProgress, nDays };
}

function main() {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
  } catch (_) {}
  agentLog('INIT', 'sandbox-routine-photo-loop.cjs', 'sandbox_start', { concerns: listConcerns().length });

  const concerns = listConcerns();
  const startDate = '2026-01-01';
  let failures = 0;

  for (const c of concerns) {
    const program = getConcernProgram(c.id);
    const phases = resolveCurrentPhase(program, startDate, startDate).phases || [];
    agentLog('C', 'phase-scan', 'concern_phases', {
      concern: c.id,
      phaseCount: phases.length,
      totalWeeks: c.total_weeks,
    });

    for (const p of phases) {
      const midWeek = Math.floor((p.week_start + p.week_end) / 2);
      const targetDate = new Date(`${startDate}T12:00:00`);
      targetDate.setDate(targetDate.getDate() + (midWeek - 1) * 7);
      const iso = targetDate.toISOString().slice(0, 10);
      const phase = resolveCurrentPhase(program, startDate, iso);
      const summary = buildPhotoAssistantSummary({ entryDate: iso, phase });
      const ok = Boolean(phase.label) && (Boolean(phase.expect) || Boolean(phase.focus));
      if (!ok) {
        failures += 1;
        agentLog('C', 'phase-scan', 'phase_missing_copy', {
          concern: c.id,
          week: midWeek,
          phase_key: phase.phase_key,
          hasExpect: Boolean(phase.expect),
          hasFocus: Boolean(phase.focus),
        });
      } else {
        agentLog('C', 'phase-scan', 'phase_ok', {
          concern: c.id,
          week: phase.program_week,
          label: phase.label,
          summaryLen: summary.length,
        });
      }
    }

    const db = createDb();
    const { tplId, itemCount } = insertTemplate(db, c.id, startDate);
    const today = '2026-05-18';
    const phase = resolveCurrentPhase(program, startDate, today);
    const photo = simulatePhotoDay(db, tplId, today);
    const summary = buildPhotoAssistantSummary({ entryDate: today, phase });
    const windowEnd = today;
    const windowStart = today;
    const progress = computeProgressSummary(db, tplId, windowStart, windowEnd);

    const allNonZero = itemCount > 0 ? progress.pcts.every((p) => p > 0) : true;
    const logsOk = photo.itemsCompleted === itemCount;
    const todayLoggedOk = progress.todayLogged === true;
    const inProgressOk = progress.inProgress === 0;
    const summaryHasPhaseCopy =
      (phase.expect && summary.includes(String(phase.expect).trim().slice(0, 32))) ||
      (phase.focus && summary.includes(String(phase.focus).trim().slice(0, 32))) ||
      (!phase.expect && !phase.focus);

    agentLog('A', 'photo-sync', 'photo_day_result', {
      concern: c.id,
      itemCount,
      itemsCompleted: photo.itemsCompleted,
      logsOk,
      today_logged: progress.todayLogged,
      in_progress: progress.inProgress,
      photoCompleteDays: progress.photoCompleteDays,
      minCardPct: progress.pcts.length ? Math.min(...progress.pcts) : 0,
      allNonZero,
      summaryHasPhaseCopy,
      assistantSummaryLen: summary.length,
    });

    if (!logsOk || !allNonZero || !todayLoggedOk || !inProgressOk || !summaryHasPhaseCopy) failures += 1;

    const yesterday = '2026-05-17';
    simulatePhotoDay(db, tplId, yesterday);
    const compareA = buildCompareDay(db, tplId, yesterday, null);
    const compareB = buildCompareDay(db, tplId, today, null);
    const compareOk =
      compareA.has_entry &&
      compareB.has_entry &&
      compareA.media_url &&
      compareB.media_url;
    agentLog('A', 'compare-two-day', 'compare_bundle', {
      concern: c.id,
      compareOk,
      dateA: yesterday,
      dateB: today,
    });
    if (!compareOk) failures += 1;

    db.close();
  }

  agentLog('INIT', 'sandbox-routine-photo-loop.cjs', 'sandbox_done', { failures });
  if (failures > 0) {
    console.error(`\nSANDBOX FAILED: ${failures} issue(s). See ${DEBUG_LOG}`);
    process.exit(1);
  }
  console.log(`\nSANDBOX OK — all concerns and phases verified. Log: ${DEBUG_LOG}`);
}

main();
