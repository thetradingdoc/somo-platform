#!/usr/bin/env node
'use strict';

/**
 * MT-01 / MT-05 — Upsert code_embeddings vectors to Pinecone with tenant metadata.
 *
 * Usage:
 *   node scripts/pinecone-code-metadata-ingest.cjs --chunk-kind global --limit 500
 *   node scripts/pinecone-code-metadata-ingest.cjs --chunk-kind tenant --clinic-id clinic-a --limit 200
 *   node scripts/pinecone-code-metadata-ingest.cjs --from-export tmp/pinecone-chunks.jsonl
 *   node scripts/populate-code-embeddings.js --export-pinecone-chunks --chunk-kind global --out tmp/chunks.jsonl
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { pineconeUpsert, isPineconeConfigured } = require('../services/pinecone-rest');

const METADATA_CODE_FIELD = {
  icd10: 'icd10_codes',
  cpt: 'cpt_codes',
  hcpcs: 'hcpcs_codes',
  cdt: 'cpt_codes',
  icd10_pcs: 'icd10_codes'
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  return {
    limit: parseInt(get('--limit') || '500', 10),
    typeFilter: get('--type'),
    chunkKind: get('--chunk-kind') || 'global',
    clinicId: get('--clinic-id'),
    fromExport: get('--from-export'),
    dryRun: args.includes('--dry-run'),
    batchSize: parseInt(get('--batch-size') || '100', 10)
  };
}

function buildMetadata(row, chunkKind, clinicId) {
  const codeType = String(row.code_type || row.codeType || '').trim();
  const code = String(row.code || '').trim().toUpperCase();
  const field = METADATA_CODE_FIELD[codeType];
  if (!field) {
    throw new Error(`unsupported code_type for Pinecone ingest: ${codeType}`);
  }
  const metadata = {
    chunk_kind: chunkKind,
    code_type: codeType,
    code,
    description_text: row.description_text || row.description || null,
    source: 'code_embeddings'
  };
  metadata[field] = code;
  if (chunkKind === 'tenant') {
    if (!clinicId) {
      throw new Error('tenant chunk missing clinic_id — upsert rejected');
    }
    metadata.clinic_id = String(clinicId).trim();
  }
  return metadata;
}

function vectorId(chunkKind, clinicId, codeType, code) {
  const tenant = chunkKind === 'tenant' ? String(clinicId).trim() : 'global';
  return `${chunkKind}:${tenant}:${codeType}:${String(code).trim().toUpperCase()}`;
}

function rowToVector(row, chunkKind, clinicId) {
  const embedding = row.embedding || row.embedding_json;
  let values;
  if (Array.isArray(embedding)) {
    values = embedding;
  } else if (typeof embedding === 'string') {
    values = JSON.parse(embedding);
  } else {
    throw new Error(`missing embedding for ${row.code_type || row.codeType}:${row.code}`);
  }
  const codeType = row.code_type || row.codeType;
  const metadata = buildMetadata(row, chunkKind, clinicId);
  return {
    id: vectorId(chunkKind, clinicId, codeType, row.code),
    values,
    metadata
  };
}

function loadExportFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`export file not found: ${abs}`);
  const raw = fs.readFileSync(abs, 'utf8').trim();
  if (!raw) return [];
  if (abs.endsWith('.jsonl')) {
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.chunks || [];
}

function loadRowsFromDb(limit, typeFilter) {
  process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';
  const dbModule = require('../database');
  const sqlite = dbModule.db || dbModule;
  let sql = `SELECT id, code, code_type, description_text, embedding_json
             FROM code_embeddings WHERE embedding_json IS NOT NULL`;
  const params = [];
  if (typeFilter) {
    sql += ' AND code_type = ?';
    params.push(typeFilter);
  }
  sql += ' LIMIT ?';
  params.push(limit);
  return sqlite.prepare(sql).all(...params);
}

async function upsertVectors(vectors, { dryRun, batchSize }) {
  if (!vectors.length) {
    console.log(JSON.stringify({ ok: true, upserted: 0, reason: 'no_vectors' }));
    return;
  }
  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      would_upsert: vectors.length,
      sample_id: vectors[0].id,
      sample_metadata: vectors[0].metadata
    }, null, 2));
    return;
  }
  if (!isPineconeConfigured()) {
    console.error('❌ Pinecone not configured — set PINECONE_API_KEY and PINECONE_INDEX_HOST');
    process.exit(1);
  }
  let upserted = 0;
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    const result = await pineconeUpsert(batch);
    upserted += result.upserted || batch.length;
    console.log(`  upserted ${upserted}/${vectors.length}`);
  }
  console.log(JSON.stringify({ ok: true, upserted, chunk_count: vectors.length }, null, 2));
}

async function main() {
  const opts = parseArgs(process.argv);
  const chunkKind = opts.chunkKind === 'tenant' ? 'tenant' : 'global';
  if (chunkKind === 'tenant' && !opts.clinicId && !opts.fromExport) {
    console.error('❌ --clinic-id required for tenant chunk ingest (or use --from-export with clinic_id on each row)');
    process.exit(1);
  }

  let rows;
  if (opts.fromExport) {
    rows = loadExportFile(opts.fromExport);
  } else {
    rows = loadRowsFromDb(opts.limit, opts.typeFilter);
  }

  const vectors = [];
  let rejected = 0;
  for (const row of rows) {
    const rowKind = row.chunk_kind || chunkKind;
    const rowClinic = row.clinic_id || row.clinicId || opts.clinicId;
    try {
      if (rowKind === 'tenant' && !rowClinic) {
        rejected++;
        continue;
      }
      vectors.push(rowToVector(row, rowKind, rowClinic));
    } catch (e) {
      if (/missing clinic_id|tenant chunk/i.test(e.message)) {
        rejected++;
        continue;
      }
      throw e;
    }
  }

  if (rejected > 0) {
    console.warn(`⚠️  rejected ${rejected} tenant chunk(s) missing clinic_id`);
    if (chunkKind === 'tenant' && vectors.length === 0) {
      console.error('❌ all tenant chunks rejected — clinic_id required');
      process.exit(1);
    }
  }

  await upsertVectors(vectors, opts);
}

main().catch((e) => {
  console.error('❌ pinecone-code-metadata-ingest failed:', e?.stack || e);
  process.exit(1);
});

module.exports = {
  buildMetadata,
  vectorId,
  rowToVector,
  METADATA_CODE_FIELD
};
