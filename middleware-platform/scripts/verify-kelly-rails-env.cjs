#!/usr/bin/env node
'use strict';

/**
 * Kelly Rails V2 env gate — fail when hybrid/legacy can win in staging/prod profiles.
 *
 * Usage:
 *   node scripts/verify-kelly-rails-env.cjs
 *   KELLY_RAILS_ENV_PROFILE=staging node scripts/verify-kelly-rails-env.cjs
 */

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function isStagingOrProdProfile() {
  const profile = String(process.env.KELLY_RAILS_ENV_PROFILE || '').trim().toLowerCase();
  if (profile === 'staging' || profile === 'production' || profile === 'prod') return true;
  if (process.env.STAGING === '1' || process.env.STAGING === 'true') return true;
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  return nodeEnv === 'production' || nodeEnv === 'staging';
}

function main() {
  const strictProfile = isStagingOrProdProfile();
  const errors = [];
  const warnings = [];

  const railsV2 = process.env.KELLY_RAILS_V2;
  const hybrid = process.env.KELLY_ALLOW_HYBRID_GRAPH;
  const rollout = process.env.KELLY_RAILS_ROLLOUT_PCT;

  if (truthy(hybrid)) {
    errors.push('KELLY_ALLOW_HYBRID_GRAPH must be 0 or unset (legacy hybrid must not win over v2).');
  }

  if (strictProfile) {
    if (!truthy(railsV2)) {
      errors.push('KELLY_RAILS_V2 must be 1 in staging/production profile.');
    }
    const pct = rollout === undefined || rollout === '' ? 1 : parseFloat(rollout);
    if (!Number.isFinite(pct) || pct < 1) {
      errors.push('KELLY_RAILS_ROLLOUT_PCT must be 1 in staging/production profile.');
    }
    const modeRouting = String(process.env.CONVERSATION_MODE_ROUTING || 'shadow').toLowerCase();
    if (modeRouting !== 'enforce') {
      errors.push('CONVERSATION_MODE_ROUTING must be enforce in staging/production profile.');
    }
  } else if (!truthy(railsV2)) {
    warnings.push('KELLY_RAILS_V2 is not 1 (OK for local dev; set for v2 E2E).');
  }

  for (const w of warnings) console.warn(`⚠️  ${w}`);
  if (errors.length) {
    console.error('Kelly Rails env verification FAILED:\n');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('verify-kelly-rails-env: OK');
  console.log(
    JSON.stringify(
      {
        profile: strictProfile ? 'staging_or_prod' : 'dev',
        KELLY_RAILS_V2: railsV2 ?? '(unset)',
        KELLY_ALLOW_HYBRID_GRAPH: hybrid ?? '(unset)',
        KELLY_RAILS_ROLLOUT_PCT: rollout ?? '(default 1)',
        CONVERSATION_MODE_ROUTING: process.env.CONVERSATION_MODE_ROUTING ?? '(unset)'
      },
      null,
      2
    )
  );
}

main();
