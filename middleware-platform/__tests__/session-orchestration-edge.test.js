'use strict';

const crypto = require('crypto');
const dbMod = require('../database');
const SnapshotService = require('../services/session-result-snapshot-service');
const { SnapshotConflictError } = SnapshotService;

describe('session orchestration edge cases', () => {
  const sid = `orch-edge-${crypto.randomUUID()}`;

  afterAll(() => {
    try {
      dbMod.wipeChatSessionClinicalState(sid);
    } catch (_) {}
  });

  test('wipeChatSessionClinicalState clears result snapshots, edits, and kelly_session_meta_kv', () => {
    const db = dbMod.db;
    const snapId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO session_result_snapshots (id, session_id, schema_version, snapshot_json, source, is_latest, generated_at)
       VALUES (?, ?, '1.0', '{"schema_version":"1.0"}', 'test', 1, datetime('now'))`
    ).run(snapId, sid);
    db.prepare(
      `INSERT INTO session_result_edits (id, session_id, snapshot_id, field_path, original_ai_value_json, user_corrected_value_json, reason_for_change, confidence_before, confidence_after)
       VALUES (?, ?, ?, 'primary_concern', 'null', '"x"', 't', 0.5, 0.5)`
    ).run(crypto.randomUUID(), sid, snapId);
    db.prepare(
      `INSERT INTO kelly_session_meta_kv (session_id, meta_key, value, updated_at) VALUES (?, 'web_voice_latest_turn_seq', '9', datetime('now'))`
    ).run(sid);

    dbMod.wipeChatSessionClinicalState(sid);

    const snaps = db.prepare(`SELECT COUNT(*) AS c FROM session_result_snapshots WHERE session_id = ?`).get(sid);
    const edits = db.prepare(`SELECT COUNT(*) AS c FROM session_result_edits WHERE session_id = ?`).get(sid);
    const meta = db.prepare(`SELECT COUNT(*) AS c FROM kelly_session_meta_kv WHERE session_id = ?`).get(sid);
    expect(snaps.c).toBe(0);
    expect(edits.c).toBe(0);
    expect(meta.c).toBe(0);
  });

  test('applySessionResultEdit rejects stale expected_snapshot_id', () => {
    const sid2 = `orch-edge-edit-${crypto.randomUUID()}`;
    try {
      const built = SnapshotService.buildSessionResultSnapshot({ sessionId: sid2, source: 'test_edit' });
      expect(built.snapshot_id).toBeTruthy();

      expect(() =>
        SnapshotService.applySessionResultEdit({
          sessionId: sid2,
          fieldPath: 'primary_concern',
          userCorrectedValue: 'acne',
          reasonForChange: 'test',
          expectedSnapshotId: '00000000-0000-0000-0000-000000000000'
        })
      ).toThrow(SnapshotConflictError);
    } finally {
      dbMod.wipeChatSessionClinicalState(sid2);
    }
  });

  test('applySessionResultEdit succeeds when expected_snapshot_id matches latest', () => {
    const sid3 = `orch-edge-edit2-${crypto.randomUUID()}`;
    try {
      const built = SnapshotService.buildSessionResultSnapshot({ sessionId: sid3, source: 'test_edit2' });
      const out = SnapshotService.applySessionResultEdit({
        sessionId: sid3,
        fieldPath: 'primary_concern',
        userCorrectedValue: 'edited_concern',
        reasonForChange: 'unit test',
        expectedSnapshotId: built.snapshot_id
      });
      expect(out.snapshot.primary_concern).toBe('edited_concern');
    } finally {
      dbMod.wipeChatSessionClinicalState(sid3);
    }
  });
});
