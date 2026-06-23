#!/usr/bin/env node
/**
 * P2: State reconciliation job - LangGraph checkpointer vs voice_call_states DB
 * Detects silent divergence between Postgres checkpoints and SQLite/DB state.
 * Run: POSTGRES_URL=... node scripts/reconcile-langgraph-state.js [--repair]
 *
 * Requires POSTGRES_URL when using PostgresSaver (production).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../database');

const REPAIR = process.argv.includes('--repair');
const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL;

async function getDbCallIds() {
  try {
    const rows = db.db.prepare('SELECT call_id, current_stage, updated_at FROM voice_call_states').all();
    return new Map(rows.map(r => [r.call_id, { stage: r.current_stage, updated: r.updated_at }]));
  } catch (e) {
    console.warn('⚠️  voice_call_states table not found:', e.message);
    return new Map();
  }
}

async function getCheckpointerThreadIds() {
  if (!connStr) return null;
  try {
    const { createPool } = require('../utils/postgres');
    const sql = createPool(connStr);
    const schema = (process.env.LANGGRAPH_CHECKPOINT_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g, '') || 'public';
    const tbl = `${schema}.checkpoints`;
    const rows = await sql.unsafe(`SELECT DISTINCT thread_id FROM ${tbl} WHERE thread_id IS NOT NULL`);
    return new Set((rows || []).map(r => r.thread_id));
  } catch (e) {
    console.warn('⚠️  Postgres checkpointer query failed (tables may not exist yet):', e.message);
    return null;
  }
}

async function main() {
  const dbCalls = await getDbCallIds();
  const checkpointThreads = await getCheckpointerThreadIds();

  const inDbNotCheckpoint = [];
  const inCheckpointNotDb = [];

  for (const [callId] of dbCalls) {
    if (checkpointThreads && !checkpointThreads.has(callId)) {
      inDbNotCheckpoint.push(callId);
    }
  }

  if (checkpointThreads) {
    for (const threadId of checkpointThreads) {
      if (!dbCalls.has(threadId)) {
        inCheckpointNotDb.push(threadId);
      }
    }
  }

  console.log(`\n📊 LangGraph state reconciliation`);
  console.log(`   DB (voice_call_states): ${dbCalls.size} calls`);
  console.log(`   Checkpointer (Postgres): ${checkpointThreads ? checkpointThreads.size : 'N/A (MemorySaver)'} threads`);
  if (inDbNotCheckpoint.length) {
    console.log(`\n   ⚠️  In DB but not in checkpointer: ${inDbNotCheckpoint.length}`);
    inDbNotCheckpoint.slice(0, 10).forEach(id => console.log(`      - ${id}`));
    if (inDbNotCheckpoint.length > 10) console.log(`      ... and ${inDbNotCheckpoint.length - 10} more`);
  }
  if (inCheckpointNotDb.length) {
    console.log(`\n   ⚠️  In checkpointer but not in DB: ${inCheckpointNotDb.length}`);
    inCheckpointNotDb.slice(0, 10).forEach(id => console.log(`      - ${id}`));
    if (inCheckpointNotDb.length > 10) console.log(`      ... and ${inCheckpointNotDb.length - 10} more`);
  }

  if (REPAIR && inDbNotCheckpoint.length && checkpointThreads) {
    console.log(`\n   🔧 Repair: seeding checkpointer from DB (run migrate-to-langgraph.js for full seed)`);
    const CodingGraph = require('../services/clinical/coding-graph');
    let seeded = 0;
    for (const callId of inDbNotCheckpoint.slice(0, 50)) {
      const state = db.getCallState(callId);
      if (state) {
        try {
          await CodingGraph.processTurn(db, callId, 'transcript', { transcript: '[reconciliation]' }, {
            clinic_id: state.clinic_id
          });
          seeded++;
        } catch (e) {
          console.warn(`      Failed to seed ${callId}:`, e.message);
        }
      }
    }
    console.log(`   Seeded ${seeded} checkpoints`);
  }

  if (!inDbNotCheckpoint.length && !inCheckpointNotDb.length && checkpointThreads) {
    console.log(`\n   ✅ No divergence detected`);
  }
  console.log('');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
