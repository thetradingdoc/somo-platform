'use strict';

/**
 * Postgres mirrors for hot-path tables when POSTGRES_PRIMARY=1.
 * voice_call_log continues to sync via database.syncVoiceCallToPostgres when POSTGRES_URL is set.
 */

function postgresPrimaryEnabled() {
  return !!(process.env.POSTGRES_URL && String(process.env.POSTGRES_PRIMARY || '') === '1');
}

async function ensureKellyCallEventsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS kelly_call_events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      call_id TEXT,
      event_type TEXT NOT NULL,
      payload_json JSONB,
      clinic_id TEXT,
      customer_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

async function mirrorKellyCallEventToPostgres(event = {}) {
  if (!postgresPrimaryEnabled() || !event.event_type) return null;
  try {
    const { createPool } = require('../utils/postgres');
    const sql = createPool();
    await ensureKellyCallEventsTable(sql);
    const payload = event.payload_json || {};
    const id = event.id || `kce_${require('crypto').randomBytes(12).toString('hex')}`;
    await sql`
      INSERT INTO kelly_call_events (
        id, session_id, call_id, event_type, payload_json, clinic_id, customer_id, created_at
      ) VALUES (
        ${id},
        ${event.session_id || null},
        ${event.call_id || null},
        ${event.event_type},
        ${sql.json(payload)},
        ${event.clinic_id || payload.clinic_id || null},
        ${event.customer_id || payload.customer_id || null},
        ${event.created_at ? new Date(event.created_at) : sql`NOW()`}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    return id;
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[postgres-hot-path] kelly_call_events mirror failed:', e.message);
    }
    return null;
  }
}

async function mirrorUsageEventToPostgres(event = {}) {
  if (!postgresPrimaryEnabled() || !event.customer_id) return null;
  try {
    const { createPool } = require('../utils/postgres');
    const sql = createPool();
    await sql`
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        call_id TEXT,
        call_sid TEXT,
        minutes_requested INTEGER,
        minutes_applied INTEGER,
        source TEXT,
        direction TEXT,
        channel TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    const id = event.id || `ue_${require('crypto').randomBytes(12).toString('hex')}`;
    await sql`
      INSERT INTO usage_events (
        id, customer_id, call_id, call_sid, minutes_requested, minutes_applied, source, direction, channel, created_at
      ) VALUES (
        ${id},
        ${event.customer_id},
        ${event.call_id || null},
        ${event.call_sid || null},
        ${event.minutes_requested ?? 0},
        ${event.minutes_applied ?? 0},
        ${event.source || null},
        ${event.direction || null},
        ${event.channel || 'voice'},
        ${event.created_at ? new Date(event.created_at) : sql`NOW()`}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    return id;
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[postgres-hot-path] usage_events mirror failed:', e.message);
    }
    return null;
  }
}

module.exports = {
  postgresPrimaryEnabled,
  mirrorKellyCallEventToPostgres,
  mirrorUsageEventToPostgres,
  ensureKellyCallEventsTable
};
