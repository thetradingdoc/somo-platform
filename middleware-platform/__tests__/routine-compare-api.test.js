'use strict';

const Database = require('better-sqlite3');
const { buildCompareDay } = require('../lib/routine-compare-helper');

describe('routine-compare-helper', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE patient_routine_daily_entries (
        id TEXT PRIMARY KEY, template_id TEXT, entry_date TEXT,
        skin_report TEXT, completion_score INTEGER
      );
      CREATE TABLE patient_routine_daily_media (
        id TEXT PRIMARY KEY, daily_entry_id TEXT, media_url TEXT, patient_document_id TEXT, created_at DATETIME
      );
    `);
    db.prepare(`INSERT INTO patient_routine_daily_entries (id, template_id, entry_date, skin_report, completion_score) VALUES ('e1','t1','2026-05-20', ?, 100)`).run(
      JSON.stringify({ program_week: 2, phase_label: 'BHA introduction', assistant_summary: 'Week 2 copy' })
    );
    db.prepare(`INSERT INTO patient_routine_daily_media (id, daily_entry_id, media_url, created_at) VALUES ('m1','e1','https://example.com/a.jpg', datetime('now'))`).run();
  });

  afterEach(() => {
    try { db.close(); } catch (_) {}
  });

  test('buildCompareDay returns media and skin_report fields', () => {
    const day = buildCompareDay(db, 't1', '2026-05-20', null);
    expect(day.has_entry).toBe(true);
    expect(day.program_week).toBe(2);
    expect(day.media_url).toContain('example.com');
  });
});
