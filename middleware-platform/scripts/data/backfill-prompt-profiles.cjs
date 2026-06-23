'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.chdir(require('path').join(__dirname, '..'));

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');
const { resolveUseCaseTemplate } = require('../../services/platform/prompt-profile-templates');

const customers = db.db.prepare(`
  SELECT c.id as customer_id, c.use_case, c.name as customer_name,
         cl.clinic_id, cl.name as clinic_name
  FROM customers c
  LEFT JOIN merchants m ON m.id = c.merchant_id
  LEFT JOIN clinics cl ON cl.merchant_id = m.id
  WHERE c.customer_type IS NULL OR c.customer_type != 'operator'
`).all();

let seeded = 0;
let skipped = 0;

for (const row of customers) {
  if (!row.clinic_id) {
    skipped++;
    continue;
  }

  const existing = db.db.prepare(
    `SELECT id FROM prompt_profiles WHERE clinic_id = ? AND status = 'active' LIMIT 1`
  ).get(row.clinic_id);

  if (existing) {
    skipped++;
    continue;
  }

  const template = resolveUseCaseTemplate(row.use_case);

  db.db.prepare(`
    INSERT INTO prompt_profiles (id, clinic_id, customer_id, name, specialty, system_prompt, allowed_tools, version, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'v1', 'active', datetime('now'), datetime('now'))
  `).run(
    uuidv4(),
    row.clinic_id,
    row.customer_id,
    `${row.clinic_name || row.customer_name || 'Practice'} — ${template.specialty}`,
    template.specialty,
    template.system_prompt,
    JSON.stringify(template.allowed_tools)
  );

  seeded++;
  console.log(`✅ Seeded: ${row.customer_name} (${row.use_case || 'healthcare_clinic'}) → clinic ${row.clinic_id}`);
}

console.log(`\nDone. Seeded: ${seeded}, Skipped (already exists or no clinic): ${skipped}`);
