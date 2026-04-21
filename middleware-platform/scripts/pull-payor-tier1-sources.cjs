#!/usr/bin/env node
'use strict';

/**
 * Pull Tier-1 payor source artifacts (CMS/NPPES/NUCC/WEDI) and ingest raw records.
 *
 * Usage:
 *   node scripts/pull-payor-tier1-sources.cjs
 *   DB_PATH=./tmp/payor-tier1.db node scripts/pull-payor-tier1-sources.cjs --force
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { parse } = require('csv-parse/sync');
const {
  uploadRawArtifactToGcs,
  emitIngestMetrics
} = require('./payor-ingest-utils.cjs');
const { getPayorDataSourcesRoot } = require('./payor-data-sources.cjs');

process.chdir(path.join(__dirname, '..'));
const db = require('../database');

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function checksumFromBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeWrite(filePath, bufferOrText) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bufferOrText);
}

async function fetchArtifact(url, responseType = 'arraybuffer') {
  const res = await axios.get(url, {
    responseType,
    timeout: 120000,
    validateStatus: (s) => s >= 200 && s < 400
  });
  return res.data;
}

function pickCsvLinks(html, baseUrl) {
  const links = [];
  const re = /href\s*=\s*["']([^"']+\.(?:csv|xlsx|xls|zip))["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = String(m[1] || '').trim();
    if (!href) continue;
    try {
      links.push(new URL(href, baseUrl).toString());
    } catch (_) {}
  }
  return Array.from(new Set(links));
}

function parseDelimitedRows(text) {
  const delimiters = [',', '|', '\t'];
  for (const delimiter of delimiters) {
    try {
      const rows = parse(text, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        relax_column_count: true,
        delimiter
      });
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (_) {}
  }
  return [];
}

function buildRunRoot() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), 'tmp', 'payor-tier1-pulls', ts);
}

/** Copy CMS MA artifacts into canonical data tree for reproducible re-runs (alongside NPPES under payor-sources). */
function mirrorCmsMaArtifactsToPayorDataSources(pageFilePath, zipFilePath) {
  try {
    const destDir = path.join(getPayorDataSourcesRoot(), 'cms');
    fs.mkdirSync(destDir, { recursive: true });
    if (pageFilePath && fs.existsSync(pageFilePath)) {
      const destPage = path.join(destDir, path.basename(pageFilePath));
      fs.copyFileSync(pageFilePath, destPage);
    }
    if (zipFilePath && fs.existsSync(zipFilePath)) {
      const destZip = path.join(destDir, path.basename(zipFilePath));
      fs.copyFileSync(zipFilePath, destZip);
    }
    return destDir;
  } catch (e) {
    console.warn('⚠️  mirrorCmsMaArtifactsToPayorDataSources failed:', e.message);
    return null;
  }
}

function mapNppesApiResult(result, idx) {
  const basic = result?.basic || {};
  const orgName = basic?.organization_name || basic?.name || '';
  const first = basic?.first_name || '';
  const last = basic?.last_name || '';
  const fallbackName = `${first} ${last}`.trim();
  const address = Array.isArray(result?.addresses) ? result.addresses[0] : null;
  const entityTypeRaw = String(result?.enumeration_type || '').toUpperCase();
  const entityTypeCode =
    entityTypeRaw.includes('NPI-2') || entityTypeRaw === '2' ? '2'
      : (entityTypeRaw.includes('NPI-1') || entityTypeRaw === '1' ? '1' : '');
  return {
    source_record_id: result?.number ? `npi_${result.number}` : `nppes_api_${idx + 1}`,
    raw_name: orgName || fallbackName || null,
    raw_payer_id: null,
    raw_npi: result?.number || null,
    raw_ein: basic?.ein || null,
    raw_state_hint: address?.state || null,
    entity_type_code: entityTypeCode,
    payload_json: result
  };
}

async function ingestArtifactBatch({
  source,
  sourceUrl,
  filePath,
  records,
  force = false
}) {
  const startedMs = Date.now();
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const checksum = checksumFromBuffer(fileBuffer);
  const existing = db.getPayorIngestBatchBySourceChecksum(source, checksum);
  if (existing && !force) {
    console.log(`Skipping ${source}: checksum already loaded (batch=${existing.id}, status=${existing.status})`);
    return { skipped: true, batchId: existing.id, inserted: 0 };
  }

  const batchId = `payor_batch_${uuidv4()}`;
  const fileSizeBytes = fileBuffer.length;
  let gcsUri = null;
  try {
    gcsUri = await uploadRawArtifactToGcs({
      filePath,
      source,
      batchId,
      checksum
    });
  } catch (e) {
    console.warn(`⚠️  ${source}: GCS upload failed: ${e.message}`);
  }

  db.createPayorIngestBatch({
    id: batchId,
    source,
    source_url: sourceUrl || null,
    file_name: fileName,
    file_checksum: checksum,
    gcs_uri: gcsUri,
    file_size_bytes: fileSizeBytes,
    status: 'running'
  });

  let inserted = 0;
  let failed = 0;
  let skippedNullIdentity = 0;
  const tx = db.db.transaction((rows) => {
    rows.forEach((row, idx) => {
      try {
        if (!row.raw_name && !row.raw_payer_id) {
          skippedNullIdentity++;
          return;
        }
        db.insertPayorSourceRecord({
          id: `payor_src_${uuidv4()}`,
          batch_id: batchId,
          source,
          source_record_id: row.source_record_id || `${source}_${idx + 1}`,
          raw_name: row.raw_name || null,
          raw_payer_id: row.raw_payer_id || null,
          raw_npi: row.raw_npi || null,
          raw_ein: row.raw_ein || null,
          raw_state_hint: row.raw_state_hint || null,
          payload_json: row.payload_json || row
        });
        inserted++;
      } catch (_) {
        failed++;
      }
    });
  });

  try {
    tx(records);
    const status = failed > 0 ? 'completed_with_errors' : 'completed';
    db.completePayorIngestBatch(batchId, {
      record_count: inserted,
      status,
      error_summary: failed > 0 ? `failed_rows=${failed}` : null,
      gcs_uri: gcsUri,
      file_size_bytes: fileSizeBytes
    });
    emitIngestMetrics({
      source,
      batchId,
      recordCount: inserted,
      failedCount: failed,
      status,
      elapsedMs: Date.now() - startedMs,
      gcsUri,
      skippedNullIdentity
    });
    return { skipped: false, batchId, inserted, failed, skippedNullIdentity, gcsUri };
  } catch (e) {
    db.completePayorIngestBatch(batchId, {
      record_count: inserted,
      status: 'failed',
      error_summary: e.message,
      gcs_uri: gcsUri,
      file_size_bytes: fileSizeBytes
    });
    emitIngestMetrics({
      source,
      batchId,
      recordCount: inserted,
      failedCount: failed,
      status: 'failed',
      elapsedMs: Date.now() - startedMs,
      gcsUri
    });
    throw e;
  }
}

async function run() {
  const force = hasFlag('force');
  const runRoot = buildRunRoot();
  fs.mkdirSync(runRoot, { recursive: true });

  const summary = [];
  const failures = [];
  async function runSourceStep(sourceKey, fn) {
    try {
      await fn();
    } catch (err) {
      const message = err?.message || String(err);
      failures.push({ source: sourceKey, error: message });
      summary.push({ source: sourceKey, failed: true, error: message });
      console.warn(`⚠️  ${sourceKey} pull failed: ${message}`);
    }
  }

  // CMS landing artifact
  await runSourceStep('cms', async () => {
    const pageUrl = 'https://www.cms.gov/data-research/statistics-trends-and-reports/medicare-advantagepart-d-contract-and-enrollment-data/ma-plan-directory';
    const pageHtml = await fetchArtifact(pageUrl, 'text');
    const pageFilePath = path.join(runRoot, 'cms', 'ma-plan-directory.html');
    safeWrite(pageFilePath, pageHtml);
    const pageLinks = pickCsvLinks(pageHtml, pageUrl);
    const zipUrl = pageLinks.find((l) => /ma-plan-directory\.zip$/i.test(l)) || null;

    const pageRecords = [{
      source_record_id: 'cms_ma_plan_directory_page',
      raw_name: 'CMS MA Plan Directory',
      payload_json: {
        artifact_type: 'html',
        fetched_url: pageUrl,
        discovered_data_links: pageLinks
      }
    }];
    summary.push({
      source: 'cms_ma_plan_directory_page',
      ...(await ingestArtifactBatch({
        source: 'cms_ma_plan_directory_page',
        sourceUrl: pageUrl,
        filePath: pageFilePath,
        records: pageRecords,
        force
      }))
    });

    if (zipUrl) {
      const zipBuf = await fetchArtifact(zipUrl, 'arraybuffer');
      const zipFilePath = path.join(runRoot, 'cms', path.basename(new URL(zipUrl).pathname));
      safeWrite(zipFilePath, Buffer.from(zipBuf));

      const zipEntriesRaw = execSync(`unzip -Z1 "${zipFilePath}"`).toString('utf8');
      const zipEntries = zipEntriesRaw.split('\n').map((s) => s.trim()).filter(Boolean);
      const targetEntry = zipEntries.find((n) => /\.(csv|txt)$/i.test(n)) || null;

      let cmsRows = [];
      if (targetEntry) {
        const entryText = execSync(`unzip -p "${zipFilePath}" "${targetEntry}"`, { maxBuffer: 1024 * 1024 * 50 }).toString('utf8');
        cmsRows = parseDelimitedRows(entryText);
      }

      const mapped = cmsRows.slice(0, 50000).map((row, idx) => ({
        source_record_id:
          row?.ContractID ||
          row?.CONTRACT_ID ||
          row?.Contract ||
          row?.contract_id ||
          `cms_ma_plan_${idx + 1}`,
        raw_name:
          row?.OrganizationName ||
          row?.Organization ||
          row?.PLAN_NAME ||
          row?.PlanName ||
          row?.plan_name ||
          null,
        raw_payer_id:
          row?.ContractID ||
          row?.CONTRACT_ID ||
          row?.contract_id ||
          row?.PlanID ||
          row?.PLAN_ID ||
          null,
        raw_npi: null,
        raw_ein: null,
        raw_state_hint:
          row?.State ||
          row?.STATE ||
          row?.StateCode ||
          row?.STATE_CD ||
          null,
        payload_json: row
      }));

      summary.push({
        source: 'cms_ma_plan_directory',
        ...(await ingestArtifactBatch({
          source: 'cms_ma_plan_directory',
          sourceUrl: zipUrl,
          filePath: zipFilePath,
          records: mapped,
          force
        }))
      });
      mirrorCmsMaArtifactsToPayorDataSources(pageFilePath, zipFilePath);
    } else {
      mirrorCmsMaArtifactsToPayorDataSources(pageFilePath, null);
    }
  });

  // NPPES portal artifact
  await runSourceStep('nppes', async () => {
    const portalUrl = 'https://download.cms.gov/nppes/NPI_Files.html';
    const portalHtml = await fetchArtifact(portalUrl, 'text');
    const portalFile = path.join(runRoot, 'nppes', 'NPI_Files.html');
    safeWrite(portalFile, portalHtml);
    const links = pickCsvLinks(portalHtml, portalUrl).slice(0, 6);
    const records = [{
      source_record_id: 'nppes_portal',
      raw_name: 'NPPES Portal',
      payload_json: {
        artifact_type: 'html',
        fetched_url: portalUrl,
        discovered_data_links: links
      }
    }];
    summary.push({ source: 'nppes_portal', ...(await ingestArtifactBatch({
      source: 'nppes_portal',
      sourceUrl: portalUrl,
      filePath: portalFile,
      records,
      force
    })) });

    // Download one real NPPES bulk artifact (prefer weekly if present).
    const bulkCandidate = links.find((l) => /weekly/i.test(l)) || links.find((l) => /\.zip$/i.test(l)) || null;
    if (bulkCandidate) {
      const buf = await fetchArtifact(bulkCandidate, 'arraybuffer');
      const bulkFile = path.join(runRoot, 'nppes', path.basename(new URL(bulkCandidate).pathname));
      safeWrite(bulkFile, Buffer.from(buf));
      const bulkRecords = [{
        source_record_id: `nppes_bulk_artifact_${path.basename(bulkFile)}`,
        raw_name: 'NPPES Bulk Artifact',
        payload_json: {
          artifact_type: 'zip',
          fetched_url: bulkCandidate,
          file_name: path.basename(bulkFile),
          bytes: Buffer.byteLength(buf)
        }
      }];
      summary.push({ source: 'nppes_bulk_artifact', ...(await ingestArtifactBatch({
        source: 'nppes_bulk_artifact',
        sourceUrl: bulkCandidate,
        filePath: bulkFile,
        records: bulkRecords,
        force
      })) });
    }
  });

  // NPPES API artifact (controlled seed strategy)
  await runSourceStep('nppes_api', async () => {
    const seedLastNames = ['smith', 'johnson', 'williams', 'brown', 'jones'];
    const seedOrgNames = ['health', 'insurance', 'medical', 'plan', 'blue'];
    const queryPayloads = [];
    const seenNpi = new Set();
    const records = [];

    for (const seed of seedLastNames) {
      const apiUrl = `https://npiregistry.cms.hhs.gov/api/?version=2.1&enumeration_type=1&last_name=${encodeURIComponent(seed)}&limit=200`;
      const apiPayload = await fetchArtifact(apiUrl, 'json');
      queryPayloads.push({ seed, entity_type_code: '1', apiUrl, payload: apiPayload });
      const apiResults = Array.isArray(apiPayload?.results) ? apiPayload.results : [];
      for (let i = 0; i < apiResults.length; i++) {
        const mapped = mapNppesApiResult(apiResults[i], i);
        if (!mapped.raw_npi || seenNpi.has(mapped.raw_npi)) continue;
        seenNpi.add(mapped.raw_npi);
        records.push(mapped);
      }
    }
    for (const seed of seedOrgNames) {
      const apiUrl = `https://npiregistry.cms.hhs.gov/api/?version=2.1&enumeration_type=2&organization_name=${encodeURIComponent(seed)}&limit=200`;
      const apiPayload = await fetchArtifact(apiUrl, 'json');
      queryPayloads.push({ seed, entity_type_code: '2', apiUrl, payload: apiPayload });
      const apiResults = Array.isArray(apiPayload?.results) ? apiPayload.results : [];
      for (let i = 0; i < apiResults.length; i++) {
        const mapped = mapNppesApiResult(apiResults[i], i);
        if (!mapped.raw_npi || seenNpi.has(mapped.raw_npi)) continue;
        seenNpi.add(mapped.raw_npi);
        records.push(mapped);
      }
    }

    const apiFile = path.join(runRoot, 'nppes', 'npi-registry-api-seeded.json');
    safeWrite(apiFile, JSON.stringify({ strategy: { seedLastNames }, queryPayloads }, null, 2));

    const providerRecords = records.filter((r) => String(r.entity_type_code || '') === '1');
    const payorRecords = records.filter((r) => String(r.entity_type_code || '') === '2');

    const nppesPayorOut = await ingestArtifactBatch({
      source: 'nppes_api',
      sourceUrl: 'https://npiregistry.cms.hhs.gov/api/',
      filePath: apiFile,
      records: payorRecords,
      force
    });
    const nppesProviderOut = await ingestArtifactBatch({
      source: 'nppes_provider_api',
      sourceUrl: 'https://npiregistry.cms.hhs.gov/api/',
      filePath: apiFile,
      records: providerRecords,
      force
    });
    summary.push({
      source: 'nppes_api',
      routed_payor_rows: payorRecords.length,
      routed_provider_rows: providerRecords.length,
      ...nppesPayorOut
    });
    summary.push({
      source: 'nppes_provider_api',
      routed_provider_rows: providerRecords.length,
      routed_payor_rows: payorRecords.length,
      ...nppesProviderOut
    });
  });

  // NUCC taxonomy page artifact + discovered links
  await runSourceStep('nucc', async () => {
    const nuccUrl = 'https://www.nucc.org/index.php/code-sets-mainmenu-41/provider-taxonomy-mainmenu-40/csv-mainmenu-57';
    const nuccHtml = await fetchArtifact(nuccUrl, 'text');
    const nuccFile = path.join(runRoot, 'nucc', 'taxonomy-csv-page.html');
    safeWrite(nuccFile, nuccHtml);
    const links = pickCsvLinks(nuccHtml, nuccUrl);
    const records = [{
      source_record_id: 'nucc_taxonomy_page',
      raw_name: 'NUCC Provider Taxonomy CSV Page',
      payload_json: {
        artifact_type: 'html',
        fetched_url: nuccUrl,
        discovered_data_links: links
      }
    }];
    summary.push({ source: 'nucc', ...(await ingestArtifactBatch({
      source: 'nucc',
      sourceUrl: nuccUrl,
      filePath: nuccFile,
      records,
      force
    })) });

    const nuccCsvLinks = links.filter((l) => /\.csv$/i.test(l)).slice(0, 3);
    for (const nuccCsvUrl of nuccCsvLinks) {
      const csvText = await fetchArtifact(nuccCsvUrl, 'text');
      const nuccCsvFile = path.join(runRoot, 'nucc', path.basename(new URL(nuccCsvUrl).pathname));
      safeWrite(nuccCsvFile, csvText);
      let parsed = [];
      try {
        parsed = parse(csvText, {
          columns: true,
          skip_empty_lines: true,
          bom: true,
          relax_column_count: true
        });
      } catch (_) {
        parsed = [];
      }
      const csvRecords = parsed.slice(0, 5000).map((row, idx) => ({
        source_record_id: `${path.basename(nuccCsvFile)}_${row?.Code || row?.code || idx + 1}`,
        raw_name:
          row?.Classification ||
          row?.classification ||
          row?.Specialization ||
          row?.specialization ||
          null,
        raw_payer_id: null,
        raw_npi: null,
        raw_ein: null,
        raw_state_hint: null,
        payload_json: row
      }));
      summary.push({ source: 'nucc_csv', ...(await ingestArtifactBatch({
        source: 'nucc_csv',
        sourceUrl: nuccCsvUrl,
        filePath: nuccCsvFile,
        records: csvRecords,
        force
      })) });
    }
  });

  // WEDI artifact (reference-only if no machine-readable links found)
  await runSourceStep('wedi', async () => {
    const wediUrl = 'https://www.wedi.org';
    const wediHtml = await fetchArtifact(wediUrl, 'text');
    const wediFile = path.join(runRoot, 'wedi', 'wedi-home.html');
    safeWrite(wediFile, wediHtml);
    const discoveredLinks = pickCsvLinks(wediHtml, wediUrl);
    const referenceOnly = discoveredLinks.length === 0;
    const records = [{
      source_record_id: 'wedi_home_page',
      raw_name: 'WEDI Home',
      payload_json: {
        artifact_type: 'html',
        fetched_url: wediUrl,
        discovered_data_links: discoveredLinks,
        reference_only: referenceOnly
      }
    }];
    summary.push({ source: 'wedi', ...(await ingestArtifactBatch({
      source: 'wedi',
      sourceUrl: wediUrl,
      filePath: wediFile,
      records,
      force
    })) });
  });

  console.log('\nTier-1 pull summary');
  console.log(JSON.stringify({
    summary,
    failures,
    failed_source_count: failures.length
  }, null, 2));
}

run().catch((err) => {
  console.error('Tier-1 pull failed:', err.message);
  process.exit(1);
});

