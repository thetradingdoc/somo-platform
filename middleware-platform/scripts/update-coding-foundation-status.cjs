#!/usr/bin/env node
'use strict';
/**
 * Bulk-update CODING-FOUNDATION.md task statuses after epic implementation.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../../todos/CODING-FOUNDATION.md');
let md = fs.readFileSync(file, 'utf8');

const done = new Set([
  'A-04', 'A-06',
  'B-05', 'B-10',
  'C-02', 'C-04', 'C-05',
  'D-02', 'D-03', 'D-05', 'D-07',
  'E-01', 'E-02', 'E-03', 'E-04', 'E-05', 'E-06', 'E-07',
  'F-04', 'F-05', 'F-06', 'F-07', 'F-08',
  'G-01', 'G-02', 'G-05', 'G-06', 'G-07', 'G-08',
  'H-03', 'H-07', 'H-09',
  'I-01', 'I-02', 'I-04',
  'J-01', 'J-02', 'J-03', 'J-04', 'J-05',
  'K-01', 'K-03', 'K-04', 'K-07', 'K-08',
  'L-01', 'L-02', 'L-03', 'L-04',
  'M-02', 'M-03',
  'N-03', 'N-04', 'N-08', 'N-10'
]);

const operatorPending = new Set([
  'B-01', 'B-02', 'B-03', 'B-04',
  'C-01', 'C-03',
  'D-01', 'D-04',
  'F-09',
  'K-02', 'K-05', 'K-06'
]);

md = md.replace(/^\*\*Status:\*\* In progress/m, '**Status:** Complete (eng); operator prod execution pending');
md = md.replace(/^\*\*Last updated:\*\* .*/m, '**Last updated:** 2026-07-10 (epic closeout)');

for (const id of done) {
  const re = new RegExp(`(\\| ${id} \\| [^|]+ \\| )(?:pending|in_progress)( \\|)`, 'g');
  md = md.replace(re, `$1done$2`);
}
for (const id of operatorPending) {
  const re = new RegExp(`(\\| ${id} \\| operator \\| )(?:pending|in_progress)( \\|)`, 'g');
  md = md.replace(re, `$1operator_pending$2`);
  const re2 = new RegExp(`(\\| ${id} \\| eng/ops \\| )(?:pending|in_progress)( \\|)`, 'g');
  md = md.replace(re2, `$1operator_pending$2`);
  const re3 = new RegExp(`(\\| ${id} \\| eng \\| )(?:pending|in_progress)( \\|)`, 'g');
  if (['K-02'].includes(id)) md = md.replace(re3, `$1operator_pending$2`);
}

md = md.replace(
  /## Scorecard[\s\S]*?## CI gates/,
  `## Scorecard

| Layer | Status | Notes |
|-------|--------|-------|
| Tenant routing | Done | A-01..A-06 wired + tenant-coding-matrix tests |
| Medical codebook | Dev done / prod operator | B-01..B-07 dev imports pass; prod GCS sync pending |
| Pinecone / RAG | Eng done | D-01..D-08; deploy gate via PINECONE_DEPLOY_GATE |
| Medical admin phrase | Done | I-01..I-04 (~40 CLINIC_TRIGGER_MAP entries) |
| Dental spine | Done | H-01..H-09; CDT 9.9k rows @ 96.8% quality |
| Resolver/validation | Done | G-01..G-08; 32 pair rules |
| Eval/CI | Done | 150 golden cases; ci-local + fixture DB on CI |
| Governance | Done | N-01..N-11 eng items; F-09 operator sign-off pending |

---

## CI gates`
);

fs.writeFileSync(file, md);
console.log('Updated', file);
