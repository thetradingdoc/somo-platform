#!/usr/bin/env node
/**
 * Classify and purge ~/.cursor/plans per Somo docs cleanup plan.
 * Usage: node scripts/cleanup-cursor-plans.cjs [--dry-run|--execute]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLANS_DIR = path.join(os.homedir(), '.cursor', 'plans');
const MODE = process.argv.includes('--execute') ? 'execute' : 'dry-run';

const CONSUMER_KEYWORDS = [
  'consumer', 'skin', 'derm', 'journal', 'reveal', 'littlelab', 'dodgecall',
  'equipe', 'benji', 'crypto', 'trading', 'athlete', 'activecare', 'acl',
  'v3_', 'mobile_prod', 'conflict_engine', 'quick-check', 'face-age',
  'shop-voice', 'pause_gcp_skin', 'decommission', 'funnel_clinical',
  'mainnet', 'two_journey', 'html_brand_planner', 'skinandcare', 'skin_scan',
  'finish_consumer', 'patient_app_v3', 'redesign_v3', 'reveal_',
  'brand_ip_documentation', 'capability_tagline', 'image_1_sphere',
  'text-only_somo_logo', 'todos_phase_08',
];

const STALE_OPS_SLUGS = new Set([
  'clean_github_push', 'push_wip_to_github', 'github_pr_push', 'push_and_deploy',
  'code_review_fixes', 'code_review_refactor_closeout', 'commit_and_push_pr1',
  'ui_bugfix_and_push', 'customer_ready_p0-p2', 'kelly_front_desk_ux',
  'provider_calendar_upgrade', 'calendar_design_portal-wide',
  'ship_customer-ready_changes', 'provider_portal_e2e', 'demo_form_ux_rebuild',
  'landing_ui_parity_gate', 'qualification_prod_verification', 'somo_qualification_demo',
]);

const KEEP_SLUGS = new Set([
  'architecture_gap_remediation',
  'crm_phase_1_production',
  'production_rollout_execution',
  'complete_voice_billing_plan',
  'prod_ready_deploy',
  'kelly_phase_b_production',
  'f2_tom_harris_e2e',
  'purge_inconsistent_trial_rows',
  'rcm_journey_redesign',
  'provider_visual_refactor_wave_1',
  'replace_lp-phone_svg',
  'demo_phase1_hitl_conversion',
]);

function slugFromFilename(name) {
  return name.replace(/\.plan\.md$/, '').replace(/_[a-f0-9]{8}$/, '');
}

function isConsumerSlug(slug) {
  const lower = slug.toLowerCase();
  return CONSUMER_KEYWORDS.some((kw) => lower.includes(kw));
}

function parseTodos(content) {
  const todos = [];
  const re = /^\s+-\s+id:\s+(\S+)\s*\n\s+content:\s+.+\s*\n\s+status:\s+(\w+)/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    todos.push({ id: m[1], status: m[2] });
  }
  return todos;
}

function hasOpenTodos(content) {
  const todos = parseTodos(content);
  return todos.some((t) => t.status === 'pending' || t.status === 'in_progress');
}

function main() {
  if (!fs.existsSync(PLANS_DIR)) {
    console.error('Plans dir not found:', PLANS_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(PLANS_DIR).filter((f) => f.endsWith('.plan.md'));
  const bySlug = new Map();

  for (const file of files) {
    const slug = slugFromFilename(file);
    const full = path.join(PLANS_DIR, file);
    const stat = fs.statSync(full);
    const content = fs.readFileSync(full, 'utf8');
    const entry = { file, full, slug, mtime: stat.mtimeMs, content, open: hasOpenTodos(content) };
    const existing = bySlug.get(slug);
    if (!existing || entry.mtime > existing.mtime) {
      bySlug.set(slug, entry);
    }
  }

  const toKeep = [];
  const toDelete = [];

  for (const file of files) {
    const full = path.join(PLANS_DIR, file);
    const slug = slugFromFilename(file);
    const content = fs.readFileSync(full, 'utf8');
    const canonical = bySlug.get(slug);

    if (KEEP_SLUGS.has(slug)) {
      if (file === canonical.file) toKeep.push(file);
      else toDelete.push({ file, reason: 'duplicate_hash_keep_canonical' });
      continue;
    }

    if (isConsumerSlug(slug)) {
      toDelete.push({ file, reason: 'consumer' });
      continue;
    }

    if (STALE_OPS_SLUGS.has(slug)) {
      toDelete.push({ file, reason: 'stale_ops_or_completed' });
      continue;
    }

    if (KEEP_SLUGS.has(slug) === false && !hasOpenTodos(content)) {
      toDelete.push({ file, reason: 'completed_somo' });
      continue;
    }

    if (hasOpenTodos(content) && !isConsumerSlug(slug) && !STALE_OPS_SLUGS.has(slug)) {
      // Open todos but not in allowlist — still delete per plan (only keep explicit list)
      toDelete.push({ file, reason: 'open_but_not_in_allowlist' });
      continue;
    }

    toDelete.push({ file, reason: 'default_delete' });
  }

  const manifest = {
    mode: MODE,
    timestamp: new Date().toISOString(),
    total: files.length,
    keep: toKeep.length,
    delete: toDelete.length,
    kept: toKeep,
    deleted: toDelete,
  };

  const tmpDir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const manifestPath = path.join(tmpDir, `plan-cleanup-manifest-${Date.now()}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Mode: ${MODE}`);
  console.log(`Total: ${files.length} | Keep: ${toKeep.length} | Delete: ${toDelete.length}`);
  console.log('Keep:', toKeep.join(', ') || '(none)');
  console.log('Manifest:', manifestPath);

  if (MODE === 'execute') {
    for (const { file } of toDelete) {
      fs.unlinkSync(path.join(PLANS_DIR, file));
    }
    console.log(`Deleted ${toDelete.length} plan files.`);
  }

  return manifest;
}

main();
