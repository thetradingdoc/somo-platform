'use strict';

/**
 * Postgres mirror consistency policy (Phase 7.2).
 * SQLite on Cloud Run is authoritative for kelly_call_events and session state.
 * Postgres receives async dual-write for clinic, appointment, voice_call_log, etc.
 */

/** Max acceptable lag between SQLite write and Postgres mirror (seconds). */
const POSTGRES_MIRROR_STALENESS_SEC = Number(process.env.POSTGRES_MIRROR_STALENESS_SEC || 120);

/** Alert when postgres_sync_retry queue depth exceeds this count. */
const POSTGRES_SYNC_RETRY_ALERT_DEPTH = Number(process.env.POSTGRES_SYNC_RETRY_ALERT_DEPTH || 25);

/** Alert when postgres_sync_dlq has any rows. */
const POSTGRES_SYNC_DLQ_ALERT_MIN = Number(process.env.POSTGRES_SYNC_DLQ_ALERT_MIN || 1);

module.exports = {
  POSTGRES_MIRROR_STALENESS_SEC,
  POSTGRES_SYNC_RETRY_ALERT_DEPTH,
  POSTGRES_SYNC_DLQ_ALERT_MIN,
  /** Human-readable: mirror is eventual-consistency, not transactional with SQLite. */
  MIRROR_MODE: 'eventual_consistency'
};
