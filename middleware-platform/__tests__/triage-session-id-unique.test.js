'use strict';

describe('triage session_id uniqueness', () => {
  test('unique index exists and ensureUniqueTriageSessionId returns canonical id', () => {
    const db = require('../database');
    const { ensureUniqueTriageSessionId } = require('../services/kelly-rails/session-ssot');
    const sid = `uniq-test-${Date.now()}`;

    const indexes = db.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='triage_sessions'`)
      .all()
      .map((r) => r.name);
    expect(indexes).toContain('idx_triage_sessions_session_id_unique');

    db.upsertTriageSession({ session_id: sid, patient_id: 'Patient/test', onset: '1' });
    const keepId = ensureUniqueTriageSessionId(sid);
    expect(keepId).toBeTruthy();
    const rows = db.db.prepare(`SELECT id FROM triage_sessions WHERE session_id = ?`).all(sid);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(keepId);

    db.db.prepare(`DELETE FROM triage_sessions WHERE session_id = ?`).run(sid);
  });
});
