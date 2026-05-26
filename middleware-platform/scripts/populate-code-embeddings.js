#!/usr/bin/env node
/**
 * Populate code_embeddings table for semantic search (Phase 2.3 - optional).
 * Requires OPENAI_API_KEY. Run after ICD-10/CPT/HCPCS imports.
 *
 * Usage:
 *   node scripts/populate-code-embeddings.js [--limit N] [--type icd10|cpt|hcpcs] [--incremental]
 *   node scripts/populate-code-embeddings.js --until-done [--batch-size 5000]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const dbModule = require('../database');
const sqlite = dbModule.db || dbModule;
const { embedText } = require('../services/semantic-search-service');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const API_CHUNK = parseInt(process.env.EMBED_API_CHUNK || '100', 10);

async function embedTextsBatch(texts, retries = 3) {
  if (!OPENAI_API_KEY || !texts.length) return [];
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts })
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI embeddings ${res.status}: ${err.slice(0, 300)}`);
      }
      const data = await res.json();
      const sorted = (data.data || []).sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastErr;
}

let _upsertStmt = null;
let _hasSpecialtyCol = false;
function getUpsertStmt() {
  if (_upsertStmt) return _upsertStmt;
  _hasSpecialtyCol = sqlite
    .prepare('PRAGMA table_info(code_embeddings)')
    .all()
    .some((col) => col.name === 'specialty');
  _upsertStmt = _hasSpecialtyCol
    ? sqlite.prepare(`
        INSERT INTO code_embeddings (id, code, code_type, description_text, embedding_json, specialty)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          description_text = excluded.description_text,
          embedding_json = excluded.embedding_json,
          specialty = excluded.specialty
      `)
    : sqlite.prepare(`
        INSERT INTO code_embeddings (id, code, code_type, description_text, embedding_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          description_text = excluded.description_text,
          embedding_json = excluded.embedding_json
      `);
  return _upsertStmt;
}

function ensureEmbeddingIndexes() {
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_code_embeddings_type_code
    ON code_embeddings(code_type, code);
  `);
}

const TYPE_CONFIG = {
  icd10: {
    incrementalSql: `SELECT c.code, c.description FROM icd10_codes c
      WHERE NOT EXISTS (
        SELECT 1 FROM code_embeddings e
        WHERE e.code = c.code AND e.code_type = 'icd10'
      ) LIMIT ?`,
    fullSql: 'SELECT code, description FROM icd10_codes LIMIT ?',
    descField: 'description',
    defaultBatch: 5000
  },
  cpt: {
    incrementalSql: `SELECT c.code, c.description FROM cpt_codes c
      WHERE NOT EXISTS (
        SELECT 1 FROM code_embeddings e
        WHERE e.code = c.code AND e.code_type = 'cpt'
      ) LIMIT ?`,
    fullSql: 'SELECT code, description FROM cpt_codes LIMIT ?',
    descField: 'description',
    defaultBatch: 2000
  },
  hcpcs: {
    incrementalSql: `SELECT c.code, c.long_desc FROM hcpcs_codes c
      WHERE NOT EXISTS (
        SELECT 1 FROM code_embeddings e
        WHERE e.code = c.code AND e.code_type = 'hcpcs'
      ) LIMIT ?`,
    fullSql: 'SELECT code, long_desc FROM hcpcs_codes LIMIT ?',
    descField: 'long_desc',
    defaultBatch: 2000
  }
};

async function embedBatch(type, { limit, incremental }) {
  const cfg = TYPE_CONFIG[type];
  const sql = incremental ? cfg.incrementalSql : cfg.fullSql;
  const rows = sqlite.prepare(sql).all(limit);
  let inserted = 0;
  const chunkSize = Math.max(1, Math.min(API_CHUNK, 256));

  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const payloads = slice.map((r) => {
      const desc = r[cfg.descField] || '';
      return {
        code: r.code,
        desc,
        text: `${r.code} ${desc}`.slice(0, 512)
      };
    });
    let vectors;
    try {
      vectors = await embedTextsBatch(payloads.map((p) => p.text));
    } catch (e) {
      console.warn(`  [${type}] batch API failed, falling back to single embed: ${e.message}`);
      vectors = [];
      for (const p of payloads) {
        vectors.push(await embedText(p.text));
      }
    }
    const upsertMany = sqlite.transaction((items) => {
      const stmt = getUpsertStmt();
      for (const item of items) {
        const id = `${type}_${item.code}`;
        const embJson = JSON.stringify(item.emb);
        if (_hasSpecialtyCol) {
          stmt.run(id, item.code, type, item.desc || null, embJson, null);
        } else {
          stmt.run(id, item.code, type, item.desc || null, embJson);
        }
      }
    });
    const toWrite = [];
    for (let j = 0; j < payloads.length; j++) {
      const emb = vectors[j];
      if (!emb) continue;
      toWrite.push({ code: payloads[j].code, desc: payloads[j].desc, emb });
    }
    if (toWrite.length) {
      upsertMany(toWrite);
      inserted += toWrite.length;
    }
    if (inserted > 0 && inserted % 500 === 0) {
      console.log(`  [${type}] ${inserted} embedded this batch...`);
    }
  }
  return { scanned: rows.length, inserted };
}

async function runTypes(types, { limit, incremental }) {
  let total = 0;
  for (const type of types) {
    const batchLimit = limit || TYPE_CONFIG[type].defaultBatch;
    console.log(`Embedding up to ${batchLimit} ${type} codes (${incremental ? 'incremental' : 'full'})...`);
    const { scanned, inserted } = await embedBatch(type, { limit: batchLimit, incremental });
    console.log(`  ${type}: scanned=${scanned}, inserted=${inserted}`);
    total += inserted;
  }
  return total;
}

const CODE_TABLE_BY_TYPE = {
  icd10: 'icd10_codes',
  cpt: 'cpt_codes',
  hcpcs: 'hcpcs_codes'
};

/** Fast remaining estimate for --until-done loop (uses live codebook row counts). */
function countRemaining(type) {
  const embeddedRow = sqlite.prepare('SELECT COUNT(*) AS n FROM code_embeddings WHERE code_type = ?').get(type);
  const embedded = embeddedRow?.n || 0;
  const table = CODE_TABLE_BY_TYPE[type];
  let expected = 0;
  if (table) {
    try {
      expected = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n || 0;
    } catch (_) {
      expected = 0;
    }
  }
  return Math.max(0, expected - embedded);
}

async function untilDone(batchSize, types = ['icd10', 'cpt', 'hcpcs']) {
  let round = 0;
  let grandTotal = 0;
  console.log('Counting remaining codes per type...');
  while (true) {
    round++;
    const remaining = {};
    let anyRemaining = false;
    for (const t of types) {
      remaining[t] = countRemaining(t);
      if (remaining[t] > 0) anyRemaining = true;
    }
    if (!anyRemaining) {
      console.log(`✅ All code types fully embedded after ${round - 1} batch round(s). Total inserted: ${grandTotal}`);
      break;
    }
    console.log(`\n--- Round ${round} remaining: icd10=${remaining.icd10}, cpt=${remaining.cpt}, hcpcs=${remaining.hcpcs} ---`);
    for (const t of types) {
      if (remaining[t] <= 0) continue;
      const limit = Math.min(batchSize, remaining[t]);
      const { inserted } = await embedBatch(t, { limit, incremental: true });
      grandTotal += inserted;
      console.log(`  ${t}: +${inserted}`);
      if (inserted === 0 && remaining[t] > 0) {
        console.warn(`⚠️  ${t}: no progress this round (${remaining[t]} still missing). Check OPENAI_API_KEY / rate limits.`);
      }
    }
    if (round > 500) {
      console.error('❌ Aborting after 500 rounds — possible stuck state.');
      process.exit(1);
    }
  }
  return grandTotal;
}

async function main() {
  if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY required. Set in .env to enable semantic search.');
    process.exit(1);
  }

  ensureEmbeddingIndexes();

  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 100 : null;
  const typeIdx = args.indexOf('--type');
  const typeFilter = typeIdx >= 0 ? args[typeIdx + 1] : null;
  const incremental = args.includes('--incremental') || args.includes('--until-done');
  const untilDoneFlag = args.includes('--until-done');
  const batchIdx = args.indexOf('--batch-size');
  const batchSize = batchIdx >= 0 ? parseInt(args[batchIdx + 1], 10) || 5000 : 5000;
  const backfillSpecialty = args.includes('--backfill-specialty');

  if (backfillSpecialty) {
    const result = dbModule.backfillCodeEmbeddingSpecialty?.();
    if (result) {
      console.log(`✅ Backfilled specialty for ${result.updated} code_embeddings rows`);
      if (result.reason) console.log(`   (${result.reason})`);
    } else {
      console.log('⚠️  backfillCodeEmbeddingSpecialty not available');
    }
    if (args.filter((a) => !a.startsWith('--backfill')).length <= 1) return;
  }

  const types = typeFilter ? [typeFilter] : ['icd10', 'cpt', 'hcpcs'];

  if (untilDoneFlag) {
    console.log('Starting --until-done (batch API + fast SQLite upserts)...');
    const total = await untilDone(batchSize, types);
    console.log(`✅ Populated ${total} code embeddings (--until-done)`);
    return;
  }
  const total = await runTypes(types, { limit, incremental });
  console.log(`✅ Populated ${total} code embeddings`);
}

main().catch((e) => {
  console.error('❌ populate-code-embeddings failed:', e?.stack || e);
  process.exit(1);
});
