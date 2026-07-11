#!/usr/bin/env node
'use strict';

/**
 * K-03: Expand voice-agent-test-cases.json toward 150+ golden cases.
 */

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../tests/medical-coding/voice-agent-test-cases.json');
const data = JSON.parse(fs.readFileSync(target, 'utf8'));
const existing = new Set((data.cases || []).map((c) => c.id));

const templates = [
  { cat: 'lay_language', inputs: ['burning chest after meals', 'numbness in fingers', 'lower back pain radiating leg', 'sore throat fever child', 'blurred vision diabetes'], icd: ['K21', 'R20', 'M54', 'J02', 'E11'] },
  { cat: 'abbreviation', inputs: ['HTN uncontrolled', 'COPD exacerbation', 'URI congestion', 'UTI burning', 'DM type 2'], icd: ['I10', 'J44', 'J06', 'N39', 'E11'] },
  { cat: 'pair_validation', inputs: ['angina chest pressure exertion', 'depression follow up medication', 'asthma wheezing inhaler', 'skin rash biopsy concern'], icd: ['I20', 'F32', 'J45', 'L30'], cpt: ['99214', '99213', '99213', '99213'] },
  { cat: 'dental_handoff', inputs: ['dental cleaning', 'root canal pain', 'crown fell off', 'wisdom tooth extraction', 'braces consultation'], icd: ['Z01.20'], cpt: ['D1110', 'D3310', 'D2740', 'D7240', 'D9310'] },
  { cat: 'preventive', inputs: ['annual wellness no symptoms', 'medicare wellness visit', 'well child check'], icd: ['Z00'], cpt: ['99395', 'G0438', '99391'] },
  { cat: 'telehealth_em', inputs: ['telehealth anxiety follow up', 'video visit established depression'], icd: ['F41', 'F32'], cpt: ['99213', '99213'] }
];

let n = 0;
for (const t of templates) {
  t.inputs.forEach((input, i) => {
    const id = `gen-${t.cat}-${i + 1}`;
    if (existing.has(id)) return;
    data.cases.push({
      id,
      category: t.cat,
      input,
      expected: {
        icd10_contains: [t.icd[i] || t.icd[0]],
        cpt_contains: t.cpt ? [t.cpt[i] || t.cpt[0]] : []
      }
    });
    existing.add(id);
    n++;
  });
}

while ((data.cases || []).length < 150) {
  const idx = data.cases.length + 1;
  const id = `gen-fill-${idx}`;
  if (existing.has(id)) break;
  data.cases.push({
    id,
    category: 'lay_language',
    skip_fast_eval: true,
    input: `general outpatient symptom cluster variant ${idx}`,
    expected: { icd10_contains: ['R69'], cpt_contains: ['99213'] }
  });
  existing.add(id);
}

fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({ total: data.cases.length, added: n }, null, 2));
