#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('../database');

function parseArgs(argv) {
  const out = { file: null, checkpoint: '.ingest-cosing.checkpoint.json' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--checkpoint') out.checkpoint = argv[++i];
  }
  return out;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => String(s || '').trim());
}

function loadCheckpoint(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) { return { line: 0 }; }
}
function saveCheckpoint(fp, cp) {
  try { fs.writeFileSync(fp, JSON.stringify(cp)); } catch (_) {}
}

async function run() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: node scripts/ingest-cosing.js --file <cosing.csv>');
    process.exit(1);
  }
  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  const cpPath = path.resolve(process.cwd(), args.checkpoint);
  const cp = loadCheckpoint(cpPath);

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  let lineNo = 0;
  let headers = [];
  let inserted = 0;

  for await (const line of rl) {
    lineNo += 1;
    if (lineNo <= (cp.line || 0)) continue;
    if (!line || !line.trim()) continue;
    const cols = parseCsvLine(line);
    if (lineNo === 1 || !headers.length) {
      headers = cols.map((h) => h.toLowerCase());
      continue;
    }
    const get = (name) => {
      const i = headers.indexOf(name);
      return i >= 0 ? cols[i] : '';
    };

    const inci = String(get('inci name') || get('inci_name') || get('name') || '').trim().toLowerCase();
    if (!inci) continue;
    const fnRaw = String(get('function') || get('functions') || '').trim();
    const functions = fnRaw ? fnRaw.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : [];
    const restrictions = [];
    const restrictionText = String(get('restrictions') || get('restriction') || '').trim();
    if (restrictionText) restrictions.push(restrictionText);

    db.upsertCosingIngredient({
      inci_name: inci,
      cas_number: get('cas no') || get('cas_number') || null,
      ec_number: get('ec no') || get('ec_number') || null,
      functions,
      restrictions,
      metadata: {
        chemical_name: get('chemical name') || get('chemical_name') || null
      }
    });
    inserted += 1;

    if (lineNo % 500 === 0) {
      saveCheckpoint(cpPath, { line: lineNo, inserted });
      console.log(`[ingest-cosing] line=${lineNo} inserted=${inserted}`);
    }
  }

  saveCheckpoint(cpPath, { line: lineNo, inserted, done: true });
  console.log(`[ingest-cosing] completed line=${lineNo} inserted=${inserted}`);
}

run().catch((e) => {
  console.error('[ingest-cosing] fatal:', e);
  process.exit(1);
});
