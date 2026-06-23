#!/usr/bin/env node
/**
 * Backfill provider profile + calendar readiness linkage.
 *
 * What it does:
 * 1) maps user email -> provider_profiles.user_id when missing
 * 2) reports providers missing calendar connection
 * 3) reports providers missing availability blocks
 */
const db = require('../../database');

function run() {
  const rows = db.db.prepare(`
    SELECT pp.id, lower(pp.email) AS email, pp.user_id
    FROM provider_profiles pp
    WHERE pp.is_active = 1
    ORDER BY pp.created_at ASC
  `).all();

  let linked = 0;
  let missingCalendar = 0;
  let missingBlocks = 0;

  for (const row of rows) {
    if (!row.user_id) {
      const u = db.db.prepare(`
        SELECT id
        FROM users
        WHERE lower(email) = ?
        LIMIT 1
      `).get(row.email);
      if (u?.id) {
        db.db.prepare(`
          UPDATE provider_profiles
          SET user_id = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(u.id, row.id);
        linked += 1;
      }
    }

    const calendar = db.db.prepare(`
      SELECT google_calendar_connected, google_refresh_token
      FROM users
      WHERE lower(email) = ?
      LIMIT 1
    `).get(row.email);
    const hasCalendar = !!(calendar && Number(calendar.google_calendar_connected) === 1 && calendar.google_refresh_token);
    if (!hasCalendar) missingCalendar += 1;

    const blocks = db.db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM provider_availability_blocks
      WHERE lower(provider_email) = ?
        AND block_type = 'available'
    `).get(row.email);
    if (!blocks?.cnt) missingBlocks += 1;
  }

  console.log(JSON.stringify({
    success: true,
    providers_scanned: rows.length,
    linked_user_ids: linked,
    missing_calendar_connection: missingCalendar,
    missing_availability_blocks: missingBlocks
  }, null, 2));
}

run();
