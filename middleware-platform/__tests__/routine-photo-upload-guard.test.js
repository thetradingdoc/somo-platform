'use strict';

const Database = require('better-sqlite3');
const { resolveRoutineDayMode } = require('../lib/routine-day-mode');
const { applyPhotoDayCompletion } = require('../lib/routine-photo-day');
const concernRoutineService = require('../services/concern-routine-service');

describe('routine photo upload guards', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
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
      CREATE TABLE patient_routine_daily_media (
        id TEXT PRIMARY KEY, daily_entry_id TEXT NOT NULL, media_url TEXT
      );
    `);
    db.prepare(`INSERT INTO patient_routine_template_items (id, template_id, is_active) VALUES ('i1', 'tpl', 1)`).run();
  });

  afterEach(() => {
    try {
      db.close();
    } catch (_) {}
  });

  test('historical entry date does not allow photo per day mode', () => {
    const m = resolveRoutineDayMode('2026-05-10', '2026-05-21');
    expect(m.allows_photo).toBe(false);
    expect(m.mode).toBe('historical');
  });

  test('failed completion path leaves score at zero when apply not called', () => {
    db.prepare(`
      INSERT INTO patient_routine_daily_entries (id, template_id, entry_date, completion_score)
      VALUES ('e-hist', 'tpl', '2026-05-10', 0)
    `).run();
    const row = db.prepare(`SELECT completion_score FROM patient_routine_daily_entries WHERE id = 'e-hist'`).get();
    expect(row.completion_score).toBe(0);
  });

  test('today photo sync creates item_logs', () => {
    db.prepare(`
      INSERT INTO patient_routine_daily_entries (id, template_id, entry_date, completion_score)
      VALUES ('e-today', 'tpl', '2026-05-21', 0)
    `).run();
    const program = concernRoutineService.getConcernProgram('acne');
    const phase = concernRoutineService.resolveCurrentPhase(program, '2026-01-01', '2026-05-21');
    const result = applyPhotoDayCompletion({
      db,
      dailyEntryId: 'e-today',
      templateId: 'tpl',
      entryDate: '2026-05-21',
      phaseSnap: phase,
      program,
      concernRoutineService,
      storageRef: 'gs://ok',
      todayIso: '2026-05-21',
    });
    expect(result.dayMode).toBe('today');
    expect(result.itemsCompleted).toBe(1);
    const logs = db.prepare(`SELECT * FROM patient_routine_daily_item_logs WHERE daily_entry_id = 'e-today'`).all();
    expect(logs.length).toBe(1);
  });
});
