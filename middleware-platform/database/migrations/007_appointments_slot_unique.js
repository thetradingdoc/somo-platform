/**
 * B-1: Add unique constraint to prevent TOCTOU double-booking.
 * One active appointment per (clinic_id, start_time). Cancelled/no_show excluded.
 */
function up(db) {
  const duplicateSamples = db.prepare(`
    SELECT
      a.clinic_id,
      a.start_time,
      COUNT(*) AS active_count,
      GROUP_CONCAT(a.id) AS active_ids_csv,
      (
        SELECT a2.id
        FROM appointments a2
        WHERE a2.clinic_id = a.clinic_id
          AND a2.start_time = a.start_time
          AND a2.deleted_at IS NULL
          AND (a2.status IS NULL OR a2.status NOT IN ('cancelled', 'no_show'))
        ORDER BY datetime(COALESCE(a2.updated_at, a2.created_at)) DESC, a2.id DESC
        LIMIT 1
      ) AS canonical_id
    FROM appointments a
    WHERE a.deleted_at IS NULL
      AND (a.status IS NULL OR a.status NOT IN ('cancelled', 'no_show'))
    GROUP BY a.clinic_id, a.start_time
    HAVING COUNT(*) > 1
    ORDER BY active_count DESC, a.start_time ASC
    LIMIT 50
  `).all();

  const duplicateGroups = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM (
      SELECT clinic_id, start_time
      FROM appointments
      WHERE deleted_at IS NULL
        AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))
      GROUP BY clinic_id, start_time
      HAVING COUNT(*) > 1
    ) t
  `).get()?.cnt || 0;

  if (duplicateGroups > 0) {
    // Keep the newest active row per slot; soft-cancel older duplicates.
    const dedupe = db.prepare(`
      WITH ranked AS (
        SELECT
          id,
          FIRST_VALUE(id) OVER (
            PARTITION BY clinic_id, start_time
            ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
          ) AS canonical_id,
          ROW_NUMBER() OVER (
            PARTITION BY clinic_id, start_time
            ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
          ) AS rn
        FROM appointments
        WHERE deleted_at IS NULL
          AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))
      )
      UPDATE appointments
      SET
        status = 'cancelled',
        cancellation_reason = COALESCE(
          cancellation_reason,
          'auto_dedup_slot_unique_migration_007|canonical_id:' || (
            SELECT ranked.canonical_id
            FROM ranked
            WHERE ranked.id = appointments.id
          )
        ),
        deleted_at = COALESCE(deleted_at, datetime('now')),
        updated_at = datetime('now')
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    `).run();
    const audit = duplicateSamples.map((r) => ({
      clinic_id: r.clinic_id,
      start_time: r.start_time,
      active_count: Number(r.active_count || 0),
      canonical_id: r.canonical_id,
      active_ids: String(r.active_ids_csv || '').split(',').filter(Boolean)
    }));
    console.warn(`⚠️  007_appointments_slot_unique: deduped ${dedupe.changes} legacy active duplicate appointments before enforcing unique slot index.`);
    console.warn(`⚠️  007_appointments_slot_unique_dedupe_audit: ${JSON.stringify({ duplicate_groups: duplicateGroups, samples: audit })}`);
  }

  // SQLite partial unique index on active appointments.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_slot_unique
    ON appointments(clinic_id, start_time)
    WHERE deleted_at IS NULL
      AND (status IS NULL OR status NOT IN ('cancelled','no_show'))
  `);
}

function down(db) {
  db.exec('DROP INDEX IF EXISTS idx_appointments_slot_unique');
  db.exec('DROP INDEX IF EXISTS idx_appointments_clinic_start_unique');
}

module.exports = { up, down };
