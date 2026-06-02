#!/usr/bin/env node
'use strict';

/**
 * Merge docs/*.md in a folder into README.md + second file (max 2 .md per folder).
 * Replaces merged paths with short redirect stubs and updates _consolidated_path_redirects.json.
 *
 * Usage: node scripts/consolidate-docs-two-per-folder.cjs [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const REDIRECTS_PATH = path.join(DOCS, '_consolidated_path_redirects.json');
const DRY_RUN = process.argv.includes('--dry-run');

/** @type {Record<string, { index: string, second: string, intoIndex: string[], intoSecond: string[] }>} */
const PLANS = {
  'agent/somo-demo': {
    index: 'README.md',
    second: 'RUNBOOK.md',
    intoIndex: [
      'ARCHITECTURE.md',
      'DECISIONS.md',
      'ISOLATION_CONTRACT.md',
      'TEMPLATE_REGISTRY.md',
      'PLAYBOOK_MEDICAL.md',
      'GOOGLE_SHEETS_SYNC_DESIGN.md',
    ],
    intoSecond: [
      'PHASE_A_GO_RECOVERY_RUNBOOK.md',
      'PROD_OUTBOUND_SALES_RUNBOOK.md',
      'PROD_E2E_EXECUTION_REPORT_2026-06-02.md',
    ],
  },
  deployment: {
    index: 'README.md',
    second: 'OPERATIONS.md',
    intoIndex: [],
    intoSecond: [
      'SOMO_CLOUD_RUN_DEPLOY.md',
      'GCP_SOMO_SERVICE_CUTOVER.md',
      'SOMO_LANDING.md',
      'SOMO_LANDING_HERO.md',
      'SOMO_DEMO_LANDING.md',
      'STAGING_CLOUDSQL.md',
      'STAGING_CRON.md',
      'STAGING_OBSERVABILITY.md',
      'STAGING_SIGNOFF.md',
      'STAGING_TRIAL_ROLLOUT.md',
      'STAGING_MYSKINANDCARE.md',
      'VOICE_CURRENT_ARCHITECTURE.md',
      'VOICE_SUBSCRIPTION_BILLING_ARCHITECTURE.md',
      'VOICE_BILLING_TEST_RESULTS.md',
      'PROVIDER_SIGNUP_FLOW.md',
      'PROVIDER_TRIAL_SIM_ARCHITECTURE.md',
      'PROD_DB_PARITY.md',
      'MEDICAL_CODEBOOK_SETUP.md',
      'EDGE_ROUTING_CONFIGS.md',
      'RENDER_PRODUCTION_CHECKLIST.md',
      'retell-agent-inventory.md',
      'RETELL_AGENT_INVENTORY.md',
      'GCP_DEPLOY_ROLLBACK.md',
    ],
  },
  runbooks: {
    index: 'README.md',
    second: 'OPERATIONS.md',
    intoIndex: [],
    intoSecond: [
      'CALLSOMO_GCP_CUTOVER.md',
      'GCP_DEPLOY_ROLLBACK_RUNBOOK.md',
      'PROD_MONITORING_WORKFLOWS.md',
      'voice-inbound-troubleshooting.md',
      'trial-lifecycle.md',
      'wipe-tenant-data.md',
      'PAYOR_BATCH_REPROCESSING.md',
      'PAYOR_INGEST_FAILURE_RECOVERY.md',
      'PAYOR_SCORING_POLICY_ROLLBACK.md',
      'PROVIDER_NETWORK_RELINK_REBUILD.md',
      'PHOTO_TO_BILL_KEY_ROTATION.md',
      'LEGACY_DOMAIN_RETIREMENT.md',
      'DLQ_TOOL_CALLS_INCIDENT_NOTE.md',
      'prod-preflight-census.md',
    ],
  },
  'user-journey': {
    index: 'README.md',
    second: 'JOURNEY.md',
    intoIndex: [],
    intoSecond: [
      '02-journey-now.md',
      '04-surfaces-and-urls.md',
      '06-mobile-and-web-parity.md',
      '07-v1-product-decisions.md',
      '08-step1-match-users.md',
      '09-step1-match-design.md',
      '10-agentic-funnel-scope.md',
      '11-growth-backlog.md',
      '12-funnel-qa-checklist.md',
    ],
  },
  Database: {
    index: 'README.md',
    second: 'OPERATIONS.md',
    intoIndex: [],
    intoSecond: [
      'DB_STRUCTURE_AND_PIPELINE.md',
      'ENV_AND_DB_SSOT.md',
      'TENANT_MODEL.md',
      'FK_ENFORCEMENT.md',
      'PHONE_NUMBERS.md',
      'VOICE_AGENT_STATE.md',
      'SOMO_FOUNDATION_RUNBOOK.md',
      'WEEK1_HANDOFF_TEMPLATE.md',
      'BACKLOG_STATUS.md',
    ],
  },
  Payor: {
    index: 'README.md',
    second: 'OPERATIONS.md',
    intoIndex: [],
    intoSecond: [
      'PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md',
      'PAYOR_SOURCE_CONTRACTS.md',
      'PAYOR_NAMING_CONVENTION.md',
      'PAYOR_CMS_TRACK_RUNBOOK.md',
      'PAYOR_DEFERRED_THIRD_PARTY_DATASETS.md',
      'PROVIDER_DIRECTORY_PIPELINE_AND_PUBLIC_SEARCH.md',
      'PROVIDER_NETWORK_INGESTION_CONTRACTS.md',
      'PRODUCTION_READINESS_BASELINE.md',
    ],
  },
  'patient-app': {
    index: 'README.md',
    second: 'PRODUCT.md',
    intoIndex: [],
    intoSecond: [
      'PATIENT_APP_ARCHITECTURE_AND_AGENT_ORCHESTRATION.md',
      'PATIENT_ROUTINE_TEMPLATE_FLOW_V1.md',
      'PATIENT_JOURNAL_REDESIGN_V1.md',
      'PATIENT_HOME_SUMMARY_METRICS_V1.md',
      'PATIENT_DAILY_LOG_AND_MEDIA_MODEL_V1.md',
      'SCAN_CHAT_ORCHESTRATION_CURRENT_STATE.md',
      'BACKEND_ROUTES_AND_TABLES_PATIENT_PORTAL.md',
      'MONTH1_SAFE_LAUNCH_RUNBOOK.md',
    ],
  },
  RCM: {
    index: 'README.md',
    second: 'ARCHITECTURE.md',
    intoIndex: [],
    intoSecond: [
      'KELLY_RCM_ARCHITECTURE.md',
      'PA_ARCHITECTURE.md',
      'STEDI_PA_WORKSTREAM.md',
      'RCM_E2E_TEST_FLOW.md',
      'RCM_PATIENT_PAY_GATEWAY.md',
      'RCM_LEDGER_ROLLBACK.md',
      'VOICE_VS_RCM_TABLES.md',
    ],
  },
  Brand: {
    index: 'README.md',
    second: 'SOMO_GUIDELINES.md',
    intoIndex: ['GITHUB_MIGRATION.md', 'INFRA_BRAND_DEFERRAL.md', 'LOGO_AND_ICON_SSOT.md', 'QA_MATRIX.md'],
    intoSecond: [],
  },
  meta: {
    index: 'README.md',
    second: 'CANONICAL_DOC_MAP.md',
    intoIndex: [],
    intoSecond: [
      'ENGINEERING_DOC_HYGIENE.md',
      'SURFACE_OWNERSHIP_MAP.md',
      'PO_SURFACE_SCORECARD.md',
      'CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md',
    ],
  },
  auth: {
    index: 'README.md',
    second: 'AUTH.md',
    intoIndex: [],
    intoSecond: ['ADMIN_VS_PROVIDER_LOGIN.md', 'API_DEVELOPER_SIGNUP.md', 'LEGACY_SIGNUP_AUDIT.md', 'auth-entrypoints.md'],
  },
  architecture: {
    index: 'README.md',
    second: 'LIVE.md',
    intoIndex: [],
    intoSecond: [
      'CURRENT_STATE_ARCHITECTURE.md',
      'kelly_rails_v2_as_built.md',
      'KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md',
      'SERVER_DECOMPOSITION.md',
      'RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md',
      'RUNTIME_ENTRYPOINTS_AND_CALL_PATHS.md',
      'CODEBASE_REVIEW_ROADMAP.md',
      'LANGGRAPH_CHECKPOINTER_DEV.md',
      'VOICE_PHONE_SEMANTICS.md',
      'VOICE_PROMPT_SSOT.md',
    ],
  },
  development: {
    index: 'README.md',
    second: 'GUIDES.md',
    intoIndex: [],
    intoSecond: ['CODE_OWNERSHIP_BY_SURFACE.md', 'SCRIPTS_OPERATIONS_MAP.md'],
  },
  'Medical Coding': {
    index: 'README.md',
    second: 'ARCHITECTURE.md',
    intoIndex: [],
    intoSecond: ['OPERATIONS.md'],
  },
  testing: {
    index: 'README.md',
    second: 'TESTING.md',
    intoIndex: [],
    intoSecond: ['PROD_PLAYWRIGHT_SUITES.md', 'STAGING_DIAGNOSTIC_RUNBOOK.md'],
  },
  legal: {
    index: 'README.md',
    second: 'POLICIES.md',
    intoIndex: [],
    intoSecond: ['PRIVACY_POLICY.md', 'TERMS_OF_SERVICE.md'],
  },
  security: {
    index: 'README.md',
    second: 'SECURITY.md',
    intoIndex: [],
    intoSecond: ['SECRET_SCANNING.md'],
  },
  setup: {
    index: 'README.md',
    second: 'ENV.md',
    intoIndex: [],
    intoSecond: ['ENVIRONMENT_VARIABLES_BY_SURFACE.md'],
  },
  product: {
    index: 'README.md',
    second: 'PRODUCT.md',
    intoIndex: [],
    intoSecond: ['SOMOPAY_SCOPE.md', 'TRIAL_NUDGE_EMAILS.md'],
  },
};

function anchorId(relPath) {
  const base = path.basename(relPath, '.md');
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function mergeSection(relPath, body) {
  const id = anchorId(relPath);
  const title = path.basename(relPath, '.md').replace(/_/g, ' ');
  return `\n\n---\n\n<a id="${id}"></a>\n\n## ${title}\n\n*Merged from \`docs/${relPath}\` on 2026-06-02.*\n\n${body.trim()}\n`;
}

function readIfExists(dir, name) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function main() {
  const redirects = fs.existsSync(REDIRECTS_PATH)
    ? JSON.parse(fs.readFileSync(REDIRECTS_PATH, 'utf8'))
    : {};

  for (const [folder, plan] of Object.entries(PLANS)) {
    const dir = path.join(DOCS, folder);
    if (!fs.existsSync(dir)) {
      console.warn('skip missing folder', folder);
      continue;
    }

    const indexPath = path.join(dir, plan.index);
    const secondPath = path.join(dir, plan.second);
    let indexBody = readIfExists(dir, plan.index) || `# ${folder}\n\n**Last updated:** 2026-06-02\n`;
    let secondBody = readIfExists(dir, plan.second) || `# ${path.basename(plan.second, '.md')}\n\n**Last updated:** 2026-06-02\n`;

    const merged = [];

    for (const name of plan.intoIndex) {
      const body = readIfExists(dir, name);
      if (!body || /^# Moved/m.test(body.trim())) continue;
      indexBody += mergeSection(`${folder}/${name}`, body);
      merged.push(name);
    }
    for (const name of plan.intoSecond) {
      const body = readIfExists(dir, name);
      if (!body || /^# Moved/m.test(body.trim())) continue;
      secondBody += mergeSection(`${folder}/${name}`, body);
      merged.push(name);
    }

    if (!merged.length) {
      console.log('no merges', folder);
      continue;
    }

    const indexRel = `docs/${folder}/${plan.index}`;
    const secondRel = `docs/${folder}/${plan.second}`;

    console.log(`${folder}: merge ${merged.length} → ${plan.index} + ${plan.second}`);

    if (!DRY_RUN) {
      fs.writeFileSync(indexPath, indexBody);
      fs.writeFileSync(secondPath, secondBody);

      for (const name of merged) {
        const rel = `docs/${folder}/${name}`;
        const anchor = anchorId(rel);
        const target = plan.intoIndex.includes(name) ? plan.index : plan.second;
        redirects[rel] = `docs/${folder}/${target}#${anchor}`;
        fs.unlinkSync(path.join(dir, name));
      }
      fs.writeFileSync(REDIRECTS_PATH, JSON.stringify(redirects, null, 2) + '\n');
    }
  }

  console.log(DRY_RUN ? 'dry-run complete' : 'consolidation complete');
}

main();
