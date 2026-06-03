'use strict';

const db = require('../database');
const {
  persistRailsSessionState,
  getRailsSessionProjection,
  linkSessionToAppointment
} = require('../services/kelly-rails/session-ssot');
const { KELLY_LANE } = require('../services/kelly-rails/state-schema');

describe('kelly-rails session SSOT projection', () => {
  const sessionId = `ssot-test-${Date.now()}`;

  test('persists and reads lane/step/flags', () => {
    persistRailsSessionState(sessionId, {
      active_lane: KELLY_LANE.CLINICAL,
      step: 'symptoms',
      flags: { has_rag: true, triage_complete: true, appointment_id: 'appt-1' }
    });
    const row = getRailsSessionProjection(sessionId);
    expect(row).toBeTruthy();
    expect(row.active_lane).toBe('clinical');
    expect(row.step).toBe('symptoms');
    expect(row.appointment_id).toBe('appt-1');
    const flags = JSON.parse(row.flags_json);
    expect(flags.has_rag).toBe(true);
  });

  test('linkSessionToAppointment sets triage_session_id on checkout row', () => {
    if (!db.db) return;
    const apptId = `appt-ssot-${Date.now()}`;
    const vcId = `vc-${apptId}`;
    try {
      db.db
        .prepare(
          `INSERT INTO voice_checkouts (id, appointment_id, status, created_at)
           VALUES (?, ?, 'pending', datetime('now'))`
        )
        .run(vcId, apptId);
    } catch (_) {
      return;
    }
    linkSessionToAppointment(sessionId, apptId);
    const vc = db.db
      .prepare(`SELECT triage_session_id FROM voice_checkouts WHERE appointment_id = ?`)
      .get(apptId);
    expect(vc?.triage_session_id).toBe(sessionId);
  });
});
