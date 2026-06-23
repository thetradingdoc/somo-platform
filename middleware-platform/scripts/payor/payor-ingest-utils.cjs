#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { Storage } = require('@google-cloud/storage');

function normalizeHeaderKey(k) {
  return String(k || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function inferInputPathArg() {
  const allowed = /\.(csv|json|xlsx|xls|zip)$/i;
  return process.argv.slice(2).find((a) => !a.startsWith('--') && allowed.test(a)) || null;
}

function norm(v) {
  if (v == null) return '';
  return String(v).trim();
}

function pick(row, keys) {
  const map = new Map(Object.keys(row || {}).map((k) => [normalizeHeaderKey(k), k]));
  for (const key of keys) {
    const hit = map.get(normalizeHeaderKey(key));
    if (!hit) continue;
    const value = norm(row[hit]);
    if (value) return value;
  }
  return '';
}

function parseInputRowsFromWorksheet(sheet) {
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const scanLimit = Math.min(50, aoa.length);
  let bestIdx = 0;
  let bestScore = -1;
  const scoreRow = (row) => {
    const vals = (Array.isArray(row) ? row : []).map((v) => String(v || '').trim()).filter(Boolean);
    if (vals.length < 2) return -1;
    const normed = vals.map(normalizeHeaderKey).filter(Boolean);
    const unique = new Set(normed);
    const keywords = ['payer', 'payor', 'name', 'id', 'npi', 'transaction', 'enrollment', 'state'];
    const keywordHits = normed.filter((k) => keywords.some((kw) => k.includes(kw))).length;
    return (unique.size * 2) + (keywordHits * 5) - (normed.filter((k) => k.startsWith('empty')).length * 2);
  };
  for (let i = 0; i < scanLimit; i++) {
    const sc = scoreRow(aoa[i]);
    if (sc > bestScore) {
      bestScore = sc;
      bestIdx = i;
    }
  }

  const header = (aoa[bestIdx] || []).map((h, i) => {
    const text = String(h || '').trim();
    return text || `column_${i + 1}`;
  });
  const rows = [];
  for (let r = bestIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const obj = {};
    let hasValue = false;
    for (let c = 0; c < header.length; c++) {
      const v = row[c] == null ? '' : row[c];
      const vs = String(v).trim();
      if (vs) hasValue = true;
      obj[header[c]] = v;
    }
    if (hasValue) rows.push(obj);
  }
  return {
    rows,
    headers: header,
    header_row_index: bestIdx,
    preview_text: (aoa.slice(0, 8).flat().map((v) => String(v || '').trim()).filter(Boolean).join(' ').toLowerCase())
  };
}

function parseInputRows(filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let rows = [];
    if (Array.isArray(raw)) rows = raw;
    else if (Array.isArray(raw?.rows)) rows = raw.rows;
    else if (Array.isArray(raw?.data)) rows = raw.data;
    const headers = Object.keys(rows[0] || {});
    return options.returnMeta ? { rows, headers, header_row_index: 0, preview_text: '' } : rows;
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const parsed = parseInputRowsFromWorksheet(sheet);
    return options.returnMeta ? parsed : parsed.rows;
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true
  });
  const headers = Object.keys(rows[0] || {});
  return options.returnMeta ? { rows, headers, header_row_index: 0, preview_text: text.slice(0, 2000).toLowerCase() } : rows;
}

function validateSourceFile({ source, headers = [], previewText = '' }) {
  const h = new Set(headers.map(normalizeHeaderKey).filter(Boolean));
  const hasAny = (...keys) => keys.some((k) => h.has(normalizeHeaderKey(k)));
  const preview = String(previewText || '').toLowerCase();
  if (source === 'office_ally') {
    // Reject obvious Inovalon exports routed to Office Ally.
    if (preview.includes('inovalon payer id lookup') || (hasAny('transaction', 'enrollment') && hasAny('available', 'non par', 'secondary'))) {
      return { ok: false, reason: 'File appears to be an Inovalon export, not Office Ally.' };
    }
    if (!hasAny('payer name', 'payor name', 'insurance name', 'name', 'payer')) {
      return { ok: false, reason: 'Office Ally file missing expected payer name headers.' };
    }
    return { ok: true };
  }
  if (source === 'inovalon') {
    if (!hasAny('payer name', 'payor name', 'name') || !hasAny('payer id', 'payor id', 'payerid')) {
      return { ok: false, reason: 'Inovalon file missing expected payer name/id headers.' };
    }
    return { ok: true };
  }
  return { ok: true };
}

function fileChecksum(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function downloadToTempFile(sourceUrl, sourceName) {
  const ext = path.extname(new URL(sourceUrl).pathname) || '.dat';
  const outPath = path.join(os.tmpdir(), `payor_${sourceName}_${Date.now()}${ext}`);
  const res = await axios.get(sourceUrl, { responseType: 'arraybuffer', timeout: 120000 });
  fs.writeFileSync(outPath, Buffer.from(res.data));
  return outPath;
}

function parseGsPrefix(gsPrefix) {
  const m = /^gs:\/\/([^/]+)\/?(.*)$/.exec(String(gsPrefix || '').trim());
  if (!m) return null;
  return { bucket: m[1], prefix: m[2] || '' };
}

async function uploadRawArtifactToGcs({ filePath, source, batchId, checksum }) {
  const bucket = process.env.PAYOR_RAW_GCS_BUCKET || '';
  const prefixEnv = process.env.PAYOR_RAW_GCS_PREFIX || '';
  if (!bucket && !prefixEnv) return null;

  let bucketName = bucket;
  let basePrefix = 'payor/raw';
  if (!bucketName && prefixEnv) {
    const parsed = parseGsPrefix(prefixEnv);
    if (!parsed) {
      throw new Error('PAYOR_RAW_GCS_PREFIX must be a valid gs:// URI');
    }
    bucketName = parsed.bucket;
    basePrefix = parsed.prefix || basePrefix;
  } else if (prefixEnv) {
    basePrefix = String(prefixEnv).replace(/^\/+|\/+$/g, '');
  }

  const dt = new Date();
  const yyyy = String(dt.getUTCFullYear());
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const fileName = path.basename(filePath);
  const key = `${basePrefix}/${source}/${yyyy}/${mm}/${dd}/${batchId}/${checksum}_${fileName}`;

  const storage = new Storage();
  await storage.bucket(bucketName).upload(filePath, { destination: key });
  return `gs://${bucketName}/${key}`;
}

/**
 * Persists ingest routing counters for observability (`report:payor:ops` reads `payor_ingest_routing_summary`).
 * @param {import('better-sqlite3').Database} sqlite - db.db from database module
 * @param {Record<string, unknown>} payload - must include source, batch_id; typically routed_* and skipped_*
 */
function recordPayorIngestRoutingSummary(sqlite, payload) {
  try {
    const id = `payor_audit_${uuidv4()}`;
    sqlite.prepare(`
      INSERT INTO payor_audit_log (id, event_type, decision_id, queue_id, policy_version, payload_json, created_at)
      VALUES (?, 'payor_ingest_routing_summary', NULL, NULL, NULL, ?, datetime('now'))
    `).run(id, JSON.stringify({ ts: new Date().toISOString(), ...payload }));
  } catch (e) {
    console.warn('⚠️  recordPayorIngestRoutingSummary failed:', e.message);
  }
}

function emitIngestMetrics({
  source,
  batchId,
  recordCount,
  failedCount,
  status,
  elapsedMs,
  gcsUri,
  routed_provider_rows = null,
  routed_payor_rows = null,
  skipped_null_identity = null
}) {
  const lineObj = {
    event: 'payor_ingest_batch_completed',
    source,
    batch_id: batchId,
    record_count: recordCount,
    failed_count: failedCount,
    status,
    elapsed_ms: elapsedMs,
    gcs_uri: gcsUri || null,
    ts: new Date().toISOString()
  };
  if (routed_provider_rows != null) lineObj.routed_provider_rows = routed_provider_rows;
  if (routed_payor_rows != null) lineObj.routed_payor_rows = routed_payor_rows;
  if (skipped_null_identity != null) lineObj.skipped_null_identity = skipped_null_identity;
  const line = JSON.stringify(lineObj);
  console.log(line);
  const logPath = String(process.env.PAYOR_INGEST_METRICS_LOG_PATH || '').trim();
  if (logPath) {
    try {
      fs.appendFileSync(logPath, `${line}\n`, { encoding: 'utf8' });
    } catch (e) {
      console.warn('payor_ingest_metrics_log_append_failed', e.message);
    }
  }
  const hook = String(process.env.PAYOR_INGEST_METRICS_WEBHOOK_URL || '').trim();
  if (hook) {
    try {
      const payload = JSON.parse(line);
      axios
        .post(hook, payload, { timeout: 8000, validateStatus: () => true })
        .catch((e) => console.warn('payor_ingest_metrics_webhook_failed', e.message));
    } catch (e) {
      console.warn('payor_ingest_metrics_webhook_parse_failed', e.message);
    }
  }
}

module.exports = {
  hasFlag,
  getArg,
  inferInputPathArg,
  norm,
  pick,
  normalizeHeaderKey,
  parseInputRows,
  validateSourceFile,
  fileChecksum,
  downloadToTempFile,
  uploadRawArtifactToGcs,
  emitIngestMetrics,
  recordPayorIngestRoutingSummary
};

