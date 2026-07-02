#!/usr/bin/env node
'use strict';

/**
 * Enable shadow week on a clinic: copay speak off + optional reply suppress.
 * Usage: node scripts/setup-phase2-shadow-week.cjs [--clinic-id <id>]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const clinicId =
  process.argv.includes('--clinic-id')
    ? process.argv[process.argv.indexOf('--clinic-id') + 1]
    : process.env.PHASE2_PILOT_CLINIC_ID;

function main() {
  process.chdir(require('path').join(__dirname, '..'));
  const db = require('../database');
  if (!db.db) throw new Error('DB unavailable');
  if (!clinicId) throw new Error('Pass --clinic-id');

  const profile = db.db
    .prepare(`SELECT id, policy_json FROM prompt_profiles WHERE clinic_id = ? LIMIT 1`)
    .get(clinicId);
  if (profile?.id) {
    let policy = {};
    try {
      policy = JSON.parse(profile.policy_json || '{}');
    } catch (_) {}
    policy.copay_quote_speak_enabled = false;
    db.db.prepare(`UPDATE prompt_profiles SET policy_json = ?, updated_at = datetime('now') WHERE id = ?`).run(
      JSON.stringify(policy),
      profile.id
    );
    console.log('✅ copay_quote_speak_enabled=0 on prompt_profile');
  }

  const vas = db.db.prepare(`SELECT id FROM voice_agent_settings WHERE clinic_id = ? LIMIT 1`).get(clinicId);
  if (vas?.id) {
    db.db.prepare(
      `UPDATE voice_agent_settings SET voice_reply_suppress_enabled = 1, updated_at = datetime('now') WHERE id = ?`
    ).run(vas.id);
    console.log('✅ voice_reply_suppress_enabled=1');
  }

  try {
    db.updateClinic?.(clinicId, { shadow_week_active: 1 });
    console.log('✅ shadow_week_active=1 on clinic');
  } catch (e) {
    console.warn('⚠️  could not set shadow_week_active:', e.message);
  }

  console.log('\nShadow week enabled. Compare desk quotes vs amount_resolution_log before enabling speak.');
  console.log('Provider checklist: docs/voice-agent/SHADOW_WEEK_RUNBOOK.md');
}

main();
