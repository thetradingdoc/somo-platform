#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.chdir(require('path').join(__dirname, '..'));

const db = require('../database');
const {
  resolveUseCaseTemplate,
  getEffectiveTenantPolicy
} = require('../services/prompt-profile-templates');
const { TriagePolicy } = require('../services/conversation-mode/tenant-policy');

const profiles = db.db.prepare(`
  SELECT pp.*, c.use_case as customer_use_case
  FROM prompt_profiles pp
  LEFT JOIN customers c ON c.id = pp.customer_id
  WHERE pp.status = 'active'
`).all();

let updated = 0;
let skipped = 0;

for (const row of profiles) {
  const useCase = row.use_case || row.customer_use_case || 'healthcare_clinic';
  const template = resolveUseCaseTemplate(useCase);
  const policy = getEffectiveTenantPolicy(row);
  const isFrontDesk =
    policy?.triage_policy === TriagePolicy.DISABLED ||
    useCase === 'dental' ||
    useCase === 'healthcare_clinic';

  if (!isFrontDesk) {
    skipped++;
    continue;
  }

  const policyJson = JSON.stringify(template.policy || { triage_policy: TriagePolicy.DISABLED });
  const metadata = JSON.stringify({
    use_case: useCase,
    tenant_policy: template.policy || { triage_policy: TriagePolicy.DISABLED },
    backfilled_at: new Date().toISOString()
  });

  db.db.prepare(`
    UPDATE prompt_profiles
    SET system_prompt = ?,
        allowed_tools = ?,
        specialty = ?,
        use_case = ?,
        policy_json = COALESCE(policy_json, ?),
        metadata = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    template.system_prompt,
    JSON.stringify(template.allowed_tools),
    template.specialty,
    useCase,
    policyJson,
    metadata,
    row.id
  );
  updated++;
  console.log(`✅ Updated profile ${row.id} (${useCase})`);
}

console.log(`\nDone. Updated: ${updated}, Skipped (clinical): ${skipped}`);
