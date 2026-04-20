#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const db = require('../database').db;

function toIds(csv) {
  return String(csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const limit = Math.max(1, Math.min(5000, Number(process.env.SLOT_DEDUPE_AUDIT_LIMIT || 200)));
  const groups = db
    .prepare(`
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
      LIMIT ?
    `)
    .all(limit);

  const totalGroups =
    db
      .prepare(`
        SELECT COUNT(*) AS cnt
        FROM (
          SELECT clinic_id, start_time
          FROM appointments
          WHERE deleted_at IS NULL
            AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))
          GROUP BY clinic_id, start_time
          HAVING COUNT(*) > 1
        ) t
      `)
      .get()?.cnt || 0;

  const totalSuppressedCandidates =
    db
      .prepare(`
        SELECT COALESCE(SUM(active_count - 1), 0) AS cnt
        FROM (
          SELECT COUNT(*) AS active_count
          FROM appointments
          WHERE deleted_at IS NULL
            AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))
          GROUP BY clinic_id, start_time
          HAVING COUNT(*) > 1
        ) t
      `)
      .get()?.cnt || 0;

  const payload = {
    success: true,
    duplicate_groups: Number(totalGroups || 0),
    suppress_candidate_rows: Number(totalSuppressedCandidates || 0),
    sample_limit: limit,
    samples: groups.map((g) => ({
      clinic_id: g.clinic_id,
      start_time: g.start_time,
      active_count: Number(g.active_count || 0),
      canonical_id: g.canonical_id,
      active_ids: toIds(g.active_ids_csv)
    }))
  };

  console.log(JSON.stringify(payload, null, 2));
  if (payload.duplicate_groups > 0) process.exitCode = 2;
}

main();
