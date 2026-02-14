#!/usr/bin/env node
/**
 * P2: Migration script - seed LangGraph checkpointer from existing voice_call_states
 * Ensures calls that have DB state get corresponding checkpoints for LangGraph.
 * Run: POSTGRES_URL=... LANGGRAPH_USE_POSTGRES=true node scripts/migrate-to-langgraph.js [--dry-run] [--limit N]
 *
 * Uses processTurn with a no-op trigger to persist current DB state into the checkpointer.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
// Force Postgres checkpointer when migrating
if (process.env.POSTGRES_URL || process.env.DATABASE_URL) {
  process.env.LANGGRAPH_USE_POSTGRES = 'true';
}

const db = require('../database');
const CodingGraph = require('../services/coding-graph');

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 1000;

async function main() {
  const rows = db.db.prepare(`
    SELECT call_id, clinic_id, current_stage, state_data, updated_at
    FROM voice_call_states
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(LIMIT);

  console.log(`\n📦 LangGraph migration: seeding checkpointer from ${rows.length} voice_call_states`);
  if (DRY_RUN) console.log('   (dry-run - no changes)\n');

  let ok = 0;
  let err = 0;

  for (const row of rows) {
    if (DRY_RUN) {
      console.log(`   Would seed: ${row.call_id} (${row.current_stage})`);
      ok++;
      continue;
    }

    try {
      const result = await CodingGraph.processTurn(
        db,
        row.call_id,
        'transcript',
        { transcript: '[migration-seed]' },
        { clinic_id: row.clinic_id }
      );
      if (result) {
        ok++;
        if (ok <= 5) console.log(`   ✓ ${row.call_id} -> ${result.toStage || row.current_stage}`);
      } else {
        err++;
      }
    } catch (e) {
      err++;
      if (err <= 3) console.warn(`   ✗ ${row.call_id}:`, e.message);
    }
  }

  console.log(`\n   Done: ${ok} ${DRY_RUN ? 'would be seeded' : 'seeded'}, ${err} failed\n`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
