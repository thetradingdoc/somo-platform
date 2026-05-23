'use strict';

const Database = require('better-sqlite3');
const {
  syncItemLogsForPhotoDay,
  buildPhotoAssistantSummary,
  buildPhotoSkinReport,
  applyPhotoDayCompletion,
} = require('../lib/routine-photo-day');
const { getConcernProgram } = require('../services/concern-routine-service');
const concernRoutineService = require('../services/concern-routine-service');

describe('routine-photo-day', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE patient_routine_template_items (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        step_order INTEGER DEFAULT 0,
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
  });

  afterEach(() => {
    try {
      db.close();
    } catch (_) {}
  });

  test('syncItemLogsForPhotoDay inserts completed log per active item', () => {
    db.prepare(`INSERT INTO patient_routine_template_items (id, template_id, is_active) VALUES (?, ?, 1)`).run(
      'item-a',
      'tpl-1'
    );
    db.prepare(`INSERT INTO patient_routine_template_items (id, template_id, is_active) VALUES (?, ?, 1)`).run(
      'item-b',
      'tpl-1'
    );

    const result = syncItemLogsForPhotoDay(db, { dailyEntryId: 'entry-1', templateId: 'tpl-1' });
    expect(result.itemsCompleted).toBe(2);

    const logs = db
      .prepare(`SELECT template_item_id, completed FROM patient_routine_daily_item_logs WHERE daily_entry_id = ?`)
      .all('entry-1');
    expect(logs.length).toBe(2);
    expect(logs.every((l) => Number(l.completed) === 1)).toBe(true);
  });

  test('syncItemLogsForPhotoDay replaces existing logs', () => {
    db.prepare(`INSERT INTO patient_routine_template_items (id, template_id, is_active) VALUES (?, ?, 1)`).run(
      'item-a',
      'tpl-1'
    );
    db.prepare(`
      INSERT INTO patient_routine_daily_item_logs (id, daily_entry_id, template_item_id, completed)
      VALUES ('old', 'entry-1', 'item-a', 0)
    `).run();

    syncItemLogsForPhotoDay(db, { dailyEntryId: 'entry-1', templateId: 'tpl-1' });
    const logs = db
      .prepare(`SELECT id, completed FROM patient_routine_daily_item_logs WHERE daily_entry_id = ?`)
      .all('entry-1');
    expect(logs.length).toBe(1);
    expect(logs[0].id).not.toBe('old');
    expect(Number(logs[0].completed)).toBe(1);
  });

  test('syncItemLogsForPhotoDay with no items does not throw', () => {
    const result = syncItemLogsForPhotoDay(db, { dailyEntryId: 'entry-1', templateId: 'tpl-empty' });
    expect(result.itemsCompleted).toBe(0);
  });

  test('buildPhotoAssistantSummary prefers expect copy', () => {
    const summary = buildPhotoAssistantSummary({
      entryDate: '2026-05-18',
      phase: {
        program_week: 3,
        total_weeks: 12,
        label: 'Retinoid introduction',
        expect: 'Mild dryness this week is your skin adjusting, not a reaction.',
      },
    });
    expect(summary).toContain('Week 3 of 12');
    expect(summary).toContain('Retinoid introduction');
    expect(summary).toContain('Mild dryness');
  });

  test('buildPhotoAssistantSummary falls back to focus', () => {
    const summary = buildPhotoAssistantSummary({
      entryDate: '2026-05-18',
      phase: {
        program_week: 1,
        total_weeks: 12,
        label: 'Barrier',
        focus: 'Establish barrier tolerance before actives.',
      },
    });
    expect(summary).toContain('Establish barrier tolerance');
  });

  test('buildPhotoSkinReport includes frozen_steps', () => {
    const program = getConcernProgram('acne');
    const phase = concernRoutineService.resolveCurrentPhase(program, '2026-01-01', '2026-01-15');
    const steps = concernRoutineService.phaseStepsAsTemplateItems(phase, program);
    const report = buildPhotoSkinReport({
      entryDate: '2026-01-15',
      phase,
      storageRef: 'gs://test/photo.jpg',
      frozenSteps: steps,
      dayMode: 'backfill',
    });
    expect(report.frozen_steps.length).toBeGreaterThan(0);
    expect(report.day_mode).toBe('backfill');
    expect(report.assistant_summary).toContain('Week');
  });

  test('applyPhotoDayCompletion skips item_logs on backfill', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE patient_routine_template_items (
        id TEXT PRIMARY KEY, template_id TEXT NOT NULL, is_active INTEGER DEFAULT 1,
        step_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE patient_routine_daily_entries (
        id TEXT PRIMARY KEY, template_id TEXT NOT NULL, entry_date TEXT,
        skin_report TEXT, notes TEXT, completion_score INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE patient_routine_daily_item_logs (
        id TEXT PRIMARY KEY, daily_entry_id TEXT NOT NULL, template_item_id TEXT,
        completed INTEGER DEFAULT 0, notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.prepare(`INSERT INTO patient_routine_template_items (id, template_id, is_active) VALUES ('i1', 'tpl', 1)`).run();
    db.prepare(`
      INSERT INTO patient_routine_daily_entries (id, template_id, entry_date, completion_score)
      VALUES ('e1', 'tpl', '2026-05-19', 0)
    `).run();

    const program = getConcernProgram('acne');
    const phase = concernRoutineService.resolveCurrentPhase(program, '2026-01-01', '2026-05-19');
    const result = applyPhotoDayCompletion({
      db,
      dailyEntryId: 'e1',
      templateId: 'tpl',
      entryDate: '2026-05-19',
      phaseSnap: phase,
      program,
      concernRoutineService,
      storageRef: 'gs://x',
      todayIso: '2026-05-21',
    });

    expect(result.dayMode).toBe('backfill');
    expect(result.itemsCompleted).toBe(0);
    const logs = db.prepare(`SELECT * FROM patient_routine_daily_item_logs WHERE daily_entry_id = 'e1'`).all();
    expect(logs.length).toBe(0);
    const row = db.prepare(`SELECT completion_score, skin_report FROM patient_routine_daily_entries WHERE id = 'e1'`).get();
    expect(row.completion_score).toBe(100);
    const parsed = JSON.parse(row.skin_report);
    expect(parsed.frozen_steps.length).toBeGreaterThan(0);
    db.close();
  });
});
