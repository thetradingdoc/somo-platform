'use strict';

/**
 * Parse CMS Physician Fee Schedule RVU files (PPRRVU / RVU26A) for CPT/HCPCS code + description.
 * Used by import-cpt-codes.js (--source mpfs). Fee amounts are handled by import-mpfs-medicare.js.
 */

const fs = require('fs');

function parseDelimitedLine(line, delimiter) {
  if (delimiter === '\t') {
    return line.split('\t').map((c) => c.trim());
  }
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normalizeHeader(h) {
  return String(h || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function findColumn(headers, patterns) {
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(headers[i]);
    if (patterns.some((p) => h.includes(p))) return i;
  }
  return -1;
}

function normalizePfsCode(raw) {
  const cleaned = String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!/^[0-9A-Z]{4,5}$/.test(cleaned)) return null;
  return cleaned;
}

function detectDelimiter(headerLine) {
  const tabs = (headerLine.match(/\t/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

function findHeaderRow(lines, parseLine) {
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const candidate = parseLine(lines[i]);
    const first = normalizeHeader(candidate[0]);
    const descCol = findColumn(candidate, ['DESCRIPTION', 'DESC', 'LONGDESC']);
    if (first === 'HCPCS' && descCol >= 0) {
      return { headerIdx: i, headers: candidate, delimiter: detectDelimiter(lines[i]) };
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const candidate = parseLine(lines[i]);
    const descCol = findColumn(candidate, ['DESCRIPTION', 'DESC', 'LONGDESC']);
    const codeCol = findColumn(candidate, ['HCPCS', 'CPT', 'CODE']);
    if (codeCol >= 0 && descCol >= 0) {
      return { headerIdx: i, headers: candidate, delimiter: detectDelimiter(lines[i]) };
    }
  }
  return null;
}

/**
 * @param {string} filePath
 * @returns {{ codes: Array<{code, description, category, subcategory, is_new}>, stats: object }}
 */
function parsePfsRvuFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`PFS RVU file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error('PFS RVU file too short');
  }

  let delimiter = ',';
  const probe = findHeaderRow(lines, (line) => {
    delimiter = detectDelimiter(line);
    return parseDelimitedLine(line, delimiter);
  });
  if (!probe) {
    throw new Error('Could not find HCPCS/DESCRIPTION header row in PFS RVU file');
  }

  delimiter = probe.delimiter;
  const parseLine = (line) => parseDelimitedLine(line, delimiter);
  const { headerIdx, headers } = probe;

  const codeCol = findColumn(headers, ['HCPCS', 'CPT', 'CODE']);
  const modCol = findColumn(headers, ['MOD', 'MODIFIER']);
  const descCol = findColumn(headers, ['DESCRIPTION', 'DESC', 'LONGDESC']);
  const statusCol = findColumn(headers, ['STATUS', 'STATUSCODE', 'CODE']);

  if (codeCol < 0 || descCol < 0) {
    throw new Error(`Missing HCPCS or DESCRIPTION columns: ${headers.slice(0, 12).join(', ')}`);
  }

  const codes = [];
  const seen = new Set();
  let skippedModifier = 0;
  let skippedInvalid = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (modCol >= 0 && String(cols[modCol] || '').trim()) {
      skippedModifier++;
      continue;
    }

    const code = normalizePfsCode(cols[codeCol]);
    let description = String(cols[descCol] || '').trim().replace(/"/g, '');
    if (!code || !description || description.length < 2) {
      skippedInvalid++;
      continue;
    }
    if (description.length > 500) description = description.slice(0, 500);
    if (seen.has(code)) continue;

    const status = statusCol >= 0 ? String(cols[statusCol] || '').trim() : '';
    codes.push({
      code,
      description,
      category: status ? `Medicare PFS (${status})` : 'Medicare PFS',
      subcategory: null,
      is_new: false
    });
    seen.add(code);
  }

  return {
    codes,
    stats: {
      file: filePath,
      delimiter: delimiter === '\t' ? 'tab' : 'comma',
      parsed: codes.length,
      skipped_modifier_rows: skippedModifier,
      skipped_invalid_rows: skippedInvalid
    }
  };
}

const FEE_SCHEDULE_DIR = require('path').resolve(__dirname, '../../Knowledge/fee-schedules');
const DEFAULT_PFS_PATHS = [
  require('path').join(FEE_SCHEDULE_DIR, 'RVU26A.csv'),
  require('path').join(FEE_SCHEDULE_DIR, 'RVU26A.txt'),
  require('path').join(FEE_SCHEDULE_DIR, 'PPRRVU.csv')
];

function resolveDefaultPfsFile() {
  for (const p of DEFAULT_PFS_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = {
  parsePfsRvuFile,
  parseDelimitedLine,
  normalizePfsCode,
  resolveDefaultPfsFile,
  DEFAULT_PFS_PATHS,
  FEE_SCHEDULE_DIR
};
