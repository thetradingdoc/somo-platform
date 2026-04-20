#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(ROOT, '..');
const ARTIFACT_DIR = path.resolve(process.env.REASONING_HARNESS_ARTIFACT_DIR || path.join(ROOT, 'test-results', 'readiness-artifacts'));
const PINECONE_MIN_VECTOR_COUNT = Math.max(1, Number(process.env.PINECONE_MIN_VECTOR_COUNT || 1000));
const PINECONE_MIN_RETRIEVAL_CASES = Math.max(1, Number(process.env.PINECONE_MIN_RETRIEVAL_CASES || 1));
const OPTION_A_NO_VECTOR = ['1', 'true', 'yes'].includes(String(process.env.REASONING_OPTION_A_NO_VECTOR || '1').toLowerCase());
const gitSha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() || 'unknown';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const harnessArtifact = path.join(ARTIFACT_DIR, `reasoning-eval-${ts}-${gitSha}.json`);
const summaryArtifact = path.join(ARTIFACT_DIR, `production-gate-summary-${ts}-${gitSha}.json`);
const RUNBOOKS_README = path.join(REPO_ROOT, 'docs', 'runbooks', 'README.md');
const REASONING_README = path.join(REPO_ROOT, 'docs', 'reasoning', 'README.md');
const canaryEvidencePath = path.join(ARTIFACT_DIR, 'canary-drill-evidence.json');
const dashboardSignoffPath = path.join(ARTIFACT_DIR, 'dashboard-signoff.json');
const alertInventoryPath = path.join(ARTIFACT_DIR, 'reasoning-alert-inventory.json');
const migrationRiskMemoPath = path.join(ARTIFACT_DIR, 'migration-risk-memo.json');
const routeRegressionSnapshotPath = path.join(ARTIFACT_DIR, 'route-regression-snapshot.json');
const e2eWaiverPath = path.join(ARTIFACT_DIR, 'e2e-scan-chat-waiver.json');
const dlqStabilityArtifactPath = path.join(ARTIFACT_DIR, 'dlq-stability-evidence.json');
const semanticQualityArtifactPath = path.join(ARTIFACT_DIR, 'semantic-quality-gate.json');
const DLQ_MAX_BACKLOG = Math.max(0, Number(process.env.REASONING_DLQ_MAX_BACKLOG || 50));
const ROUTE_REGRESSION_MAX_COUNT = Math.max(0, Number(process.env.REASONING_ROUTE_REGRESSION_MAX_COUNT || 0));

const results = [];
let failed = false;

function add(status, id, detail) {
  results.push({ status, id, detail });
  const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '!' : '✗';
  const printer = status === 'FAIL' ? console.error : status === 'WARN' ? console.warn : console.log;
  printer(`${icon} ${id}${detail ? ` — ${detail}` : ''}`);
  if (status === 'FAIL') failed = true;
}

function run(name, cmd, args, extraEnv = {}) {
  const out = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
  if (out.status !== 0) {
    add('FAIL', name, (out.stderr || out.stdout || '').trim().slice(0, 500));
    return { ok: false, out };
  }
  add('PASS', name);
  return { ok: true, out };
}

function parseLastJsonObject(text) {
  const src = String(text || '').trim();
  if (!src) return null;
  const lines = src.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = lines.slice(i).join('\n').trim();
    try {
      return JSON.parse(candidate);
    } catch (_) {
      continue;
    }
  }
  return null;
}

function requireEnv() {
  const hasProviderKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
  if (!hasProviderKey) add('FAIL', 'ENV_PROVIDER_KEY', 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
  else add('PASS', 'ENV_PROVIDER_KEY');

  if (!process.env.REASONING_HARNESS_ARTIFACT_DIR) {
    add('PASS', 'ENV_REASONING_HARNESS_ARTIFACT_DIR', `Defaulting to ${ARTIFACT_DIR}`);
  } else {
    add('PASS', 'ENV_REASONING_HARNESS_ARTIFACT_DIR', process.env.REASONING_HARNESS_ARTIFACT_DIR);
  }

  const liveRequested = process.env.REASONING_HARNESS_LIVE_MODEL === '1' || process.env.REASONING_HARNESS_LIVE_MODEL === 'true';
  if (!liveRequested) {
    add('FAIL', 'ENV_LIVE_MODEL_REQUIRED', 'Set REASONING_HARNESS_LIVE_MODEL=1 for Batch 1 completion.');
  } else {
    add('PASS', 'ENV_LIVE_MODEL_REQUIRED');
  }
}

function verifyLangSmithEnvProject() {
  const tracingEnabled =
    String(process.env.LANGCHAIN_TRACING_V2 || '').toLowerCase() === 'true' ||
    String(process.env.LANGSMITH_TRACING || '').toLowerCase() === 'true';
  if (!tracingEnabled) {
    add('FAIL', 'LANGSMITH_TRACING_ENABLED', 'Set LANGCHAIN_TRACING_V2=true (or LANGSMITH_TRACING=true).');
  } else {
    add('PASS', 'LANGSMITH_TRACING_ENABLED');
  }
  const hasKey = Boolean(process.env.LANGSMITH_API_KEY || process.env.AP_Langchain);
  if (!hasKey) {
    add('FAIL', 'LANGSMITH_API_KEY_PRESENT', 'Set LANGSMITH_API_KEY (or AP_Langchain).');
  } else {
    add('PASS', 'LANGSMITH_API_KEY_PRESENT');
  }
  const env = String(process.env.NODE_ENV || 'development').toLowerCase();
  const expectedSuffix = env === 'production' ? 'prod' : env === 'staging' ? 'staging' : 'dev';
  const expectedProject = `middleware-${expectedSuffix}`;
  const project = String(process.env.LANGCHAIN_PROJECT || process.env.LANGSMITH_PROJECT || '').trim();
  if (!project) {
    add('FAIL', 'LANGSMITH_PROJECT_SET', `Set LANGCHAIN_PROJECT=${expectedProject}`);
    return;
  }
  if (project !== expectedProject) {
    add('FAIL', 'LANGSMITH_PROJECT_NAMING', `Expected ${expectedProject}, got ${project}`);
  } else {
    add('PASS', 'LANGSMITH_PROJECT_NAMING', project);
  }
}

function validateHarnessArtifact(filePath) {
  if (!fs.existsSync(filePath)) {
    add('FAIL', 'HARNESS_ARTIFACT_EXISTS', filePath);
    return null;
  }
  let json = null;
  try {
    json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    add('FAIL', 'HARNESS_ARTIFACT_PARSE', String(err.message || err));
    return null;
  }
  add('PASS', 'HARNESS_ARTIFACT_PARSE');

  if (!Array.isArray(json.cases) || json.cases.length === 0) {
    add('FAIL', 'HARNESS_CASES_PRESENT', 'cases[] missing/empty');
  } else {
    add('PASS', 'HARNESS_CASES_PRESENT', `${json.cases.length} cases`);
  }

  const rubric = json.rubric_summary || {};
  const hasRubric =
    typeof rubric.route_safety === 'number' &&
    typeof rubric.harm_precision === 'number' &&
    typeof rubric.child_safety === 'number';
  if (!hasRubric) add('FAIL', 'HARNESS_RUBRIC_SCHEMA', 'rubric_summary missing normalized scores');
  else add('PASS', 'HARNESS_RUBRIC_SCHEMA');

  const hasGateCoverage = json.gate_coverage && typeof json.gate_coverage === 'object';
  if (!hasGateCoverage) add('FAIL', 'HARNESS_GATE_COVERAGE_SCHEMA', 'gate_coverage missing');
  else add('PASS', 'HARNESS_GATE_COVERAGE_SCHEMA');

  const nonModel = json.cases.filter((c) => c.reasoning_mode !== 'model');
  if (nonModel.length > 0) {
    add('FAIL', 'LIVE_MODEL_NO_STUB_FALLBACK', `${nonModel.length}/${json.cases.length} non-model cases`);
  } else {
    add('PASS', 'LIVE_MODEL_NO_STUB_FALLBACK');
  }

  const retrievalActive = json.cases.filter((c) => {
    const s = String(c?.reasoning_retrieval?.status || '').toLowerCase();
    return s && s !== 'none' && s !== 'failed';
  });
  if (OPTION_A_NO_VECTOR) {
    add('WARN', 'PINECONE_RETRIEVAL_ACTIVE', `Option A mode active; retrieval requirement skipped (${retrievalActive.length}/${json.cases.length} active).`);
  } else if (retrievalActive.length < PINECONE_MIN_RETRIEVAL_CASES) {
    add(
      'FAIL',
      'PINECONE_RETRIEVAL_ACTIVE',
      `${retrievalActive.length}/${json.cases.length} cases with retrieval active; need >= ${PINECONE_MIN_RETRIEVAL_CASES}`
    );
  } else {
    add('PASS', 'PINECONE_RETRIEVAL_ACTIVE', `${retrievalActive.length}/${json.cases.length} cases`);
  }

  const falseProvenance = json.cases.filter((c) => {
    const status = String(c?.reasoning_retrieval?.status || '').toLowerCase();
    const claimProv = c?.reasoning_claim_provenance || {};
    const refs = Object.values(claimProv).flatMap((arr) => (Array.isArray(arr) ? arr : []));
    const hasPinecone = refs.some((r) => String(r?.source || '').toLowerCase().includes('pinecone'));
    return status === 'none' && hasPinecone;
  });
  if (falseProvenance.length > 0) {
    add('FAIL', 'RETRIEVAL_PROVENANCE_HONEST', `${falseProvenance.length} cases claim pinecone provenance with retrieval status=none`);
  } else {
    add('PASS', 'RETRIEVAL_PROVENANCE_HONEST');
  }

  return json;
}

function verifyPineconeReadiness() {
  if (OPTION_A_NO_VECTOR) {
    add('WARN', 'PINECONE_OPTION_A_MODE', 'Vector/Pinecone checks downgraded in Option A no-vector mode.');
    return;
  }
  const ready = run('PINECONE_READINESS_SCRIPT', 'npm', ['run', 'verify:reasoning:pinecone-readiness']);
  if (!ready.ok) return;

  const probe = run(
    'PINECONE_INDEX_STATS',
    process.execPath,
    [
      '-e',
      "const p=require('./services/pinecone-rest');(async()=>{try{if(!p.isPineconeConfigured()){console.log(JSON.stringify({configured:false}));process.exit(2);}const s=await p.pineconeDescribeIndexStats();const t=Number(s?.totalVectorCount||s?.total_vector_count||0);console.log(JSON.stringify({configured:true,totalVectorCount:t}));}catch(e){console.error(JSON.stringify({configured:true,error:String(e?.message||e)}));process.exit(1);}})();"
    ]
  );
  if (!probe.ok) return;
  let parsed = null;
  try {
    const line = String(probe.out.stdout || '').trim().split('\n').filter(Boolean).pop();
    parsed = JSON.parse(line);
  } catch (_) {
    add('FAIL', 'PINECONE_INDEX_STATS_PARSE', 'Could not parse pinecone index stats probe output');
    return;
  }
  if (!parsed?.configured) {
    add('FAIL', 'PINECONE_CONFIGURED', 'Pinecone not configured in this environment');
    return;
  }
  add('PASS', 'PINECONE_CONFIGURED');
  const total = Number(parsed.totalVectorCount || 0);
  if (total < PINECONE_MIN_VECTOR_COUNT) {
    add('FAIL', 'PINECONE_VECTOR_COUNT', `${total} vectors; need >= ${PINECONE_MIN_VECTOR_COUNT}`);
  } else {
    add('PASS', 'PINECONE_VECTOR_COUNT', `${total} vectors`);
  }
}

function verifyBatch3DocsAndMapping() {
  if (!fs.existsSync(RUNBOOKS_README)) {
    add('FAIL', 'RUNBOOKS_README_EXISTS', RUNBOOKS_README);
    return;
  }
  add('PASS', 'RUNBOOKS_README_EXISTS');
  if (!fs.existsSync(REASONING_README)) {
    add('FAIL', 'REASONING_README_EXISTS', REASONING_README);
    return;
  }
  add('PASS', 'REASONING_README_EXISTS');

  const runbooks = fs.readFileSync(RUNBOOKS_README, 'utf8');
  const reasoning = fs.readFileSync(REASONING_README, 'utf8');

  const requiredRunbookAnchors = [
    '#alert-rules',
    '#reasoning-gate-failure-triage',
    '#reasoning-kill-switch-recovery',
    '#reasoning-post-incident-template',
    '#reasoning-rollout-runbook'
  ];
  const missingRunbookAnchors = requiredRunbookAnchors.filter((a) => !runbooks.includes(a));
  if (missingRunbookAnchors.length > 0) {
    add('FAIL', 'RUNBOOKS_CONSOLIDATED_ANCHORS', `Missing anchors: ${missingRunbookAnchors.join(', ')}`);
  } else {
    add('PASS', 'RUNBOOKS_CONSOLIDATED_ANCHORS');
  }

  if (!reasoning.toLowerCase().includes('rollout gate')) {
    add('FAIL', 'REASONING_README_ROLLOUT_GATE_REF', 'Rollout gate section not found in docs/reasoning/README.md');
  } else {
    add('PASS', 'REASONING_README_ROLLOUT_GATE_REF');
  }

  const requiredAlertMetricRefs = [
    'reasoning.gate.schema.fail.count',
    'reasoning.gate.semantic_contract.fail.count',
    'reasoning.gate.confidence.defer.count',
    'reasoning.gate.safety.fail.count',
    'reasoning.gate.provider_error.count'
  ];
  const missingMetricRefs = requiredAlertMetricRefs.filter((m) => !runbooks.includes(m));
  if (missingMetricRefs.length > 0) {
    add('FAIL', 'ALERT_REASONING_GATE_METRICS_MAPPED', `Missing metric refs: ${missingMetricRefs.join(', ')}`);
  } else {
    add('PASS', 'ALERT_REASONING_GATE_METRICS_MAPPED');
  }

  const reasoningAlertRows = [
    'Reasoning API error rate',
    'Reasoning provider error gate',
    'Reasoning schema gate failures',
    'Reasoning semantic contract gate failures',
    'Reasoning confidence deferrals',
    'Reasoning safety gate failures'
  ];
  const unmapped = reasoningAlertRows.filter((row) => {
    const idx = runbooks.indexOf(row);
    if (idx < 0) return true;
    const line = runbooks.slice(idx, runbooks.indexOf('\n', idx) >= 0 ? runbooks.indexOf('\n', idx) : undefined);
    return !(line.includes('#reasoning-gate-failure-triage') || line.includes('#reasoning-kill-switch-recovery') || line.includes('#reasoning-rollout-runbook'));
  });
  if (unmapped.length > 0) {
    add('FAIL', 'ALERT_TO_REASONING_RUNBOOK_MAPPING', `Unmapped/incorrect rows: ${unmapped.join('; ')}`);
  } else {
    add('PASS', 'ALERT_TO_REASONING_RUNBOOK_MAPPING');
  }
}

function verifyArtifactJson(filePath, checkId, requiredFields) {
  if (!fs.existsSync(filePath)) {
    add('FAIL', checkId, `Missing artifact: ${filePath}`);
    return null;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    add('FAIL', `${checkId}_PARSE`, String(err?.message || err));
    return null;
  }
  const missing = requiredFields.filter((k) => parsed[k] == null);
  if (missing.length > 0) {
    add('FAIL', `${checkId}_FIELDS`, `Missing fields: ${missing.join(', ')}`);
    return null;
  }
  add('PASS', checkId, filePath);
  return parsed;
}

function verifyBatch3Artifacts() {
  const canary = verifyArtifactJson(
    canaryEvidencePath,
    'CANARY_DRILL_EVIDENCE',
    ['operator', 'date', 'stages_completed', 'kill_switch_tested', 'recovery_verified']
  );
  if (canary) {
    if (!Array.isArray(canary.stages_completed) || canary.stages_completed.length === 0) {
      add('FAIL', 'CANARY_DRILL_EVIDENCE_STAGES', 'stages_completed must be a non-empty array');
    } else {
      add('PASS', 'CANARY_DRILL_EVIDENCE_STAGES');
    }
    if (!canary.kill_switch_tested || !canary.recovery_verified) {
      add('FAIL', 'CANARY_DRILL_COMPLETENESS', 'kill_switch_tested and recovery_verified must both be true');
    } else {
      add('PASS', 'CANARY_DRILL_COMPLETENESS');
    }
  }

  const dashboard = verifyArtifactJson(
    dashboardSignoffPath,
    'DASHBOARD_SIGNOFF',
    ['operator', 'date', 'dashboard_url', 'panels_validated', 'synthetic_alert_fired']
  );
  if (dashboard) {
    if (!Array.isArray(dashboard.panels_validated) || dashboard.panels_validated.length === 0) {
      add('FAIL', 'DASHBOARD_SIGNOFF_PANELS', 'panels_validated must be a non-empty array');
    } else {
      add('PASS', 'DASHBOARD_SIGNOFF_PANELS');
    }
    if (!dashboard.synthetic_alert_fired) {
      add('FAIL', 'DASHBOARD_SIGNOFF_SYNTHETIC_ALERT', 'synthetic_alert_fired must be true');
    } else {
      add('PASS', 'DASHBOARD_SIGNOFF_SYNTHETIC_ALERT');
    }
    const panelSet = Array.isArray(dashboard.panels_validated) ? dashboard.panels_validated.map((p) => String(p || '')) : [];
    const needed = ['landing.scan_context.present.count', 'landing.scan_context.missed_in_reply.count'];
    const missing = needed.filter((m) => !panelSet.includes(m));
    if (missing.length > 0) {
      add('FAIL', 'DASHBOARD_SCAN_CONTEXT_PANELS', `Missing panels: ${missing.join(', ')}`);
    } else {
      add('PASS', 'DASHBOARD_SCAN_CONTEXT_PANELS');
    }
  }
}

function verifyAlertToRunbookLiveWiring() {
  const inventory = verifyArtifactJson(
    alertInventoryPath,
    'ALERT_INVENTORY_EVIDENCE',
    ['captured_at', 'source', 'alerts']
  );
  if (!inventory) return;
  if (!Array.isArray(inventory.alerts) || inventory.alerts.length === 0) {
    add('FAIL', 'ALERT_INVENTORY_ALERTS_PRESENT', 'alerts must be a non-empty array');
    return;
  }
  add('PASS', 'ALERT_INVENTORY_ALERTS_PRESENT', `${inventory.alerts.length} alerts`);

  const requiredNames = [
    'Reasoning API error rate',
    'Reasoning provider error gate',
    'Reasoning latency spike',
    'Reasoning schema gate failures',
    'Reasoning semantic contract gate failures',
    'Reasoning confidence deferrals',
    'Reasoning safety gate failures',
    'Scan generic fallback rate spike',
    'Scan context stale reject spike'
  ];
  const missing = requiredNames.filter((name) => !inventory.alerts.some((a) => String(a?.name || '').trim() === name));
  if (missing.length > 0) {
    add('FAIL', 'ALERT_INVENTORY_REASONING_COVERAGE', `Missing alerts: ${missing.join(', ')}`);
    return;
  }
  add('PASS', 'ALERT_INVENTORY_REASONING_COVERAGE');

  const invalidRunbookLinks = inventory.alerts
    .filter((a) => requiredNames.includes(String(a?.name || '').trim()))
    .filter((a) => {
      const runbook = String(a?.runbook_url || '');
      return !(
        runbook.includes('#reasoning-gate-failure-triage') ||
        runbook.includes('#reasoning-kill-switch-recovery') ||
        runbook.includes('#reasoning-rollout-runbook')
      );
    })
    .map((a) => String(a?.name || 'unknown'));
  if (invalidRunbookLinks.length > 0) {
    add('FAIL', 'ALERT_INVENTORY_RUNBOOK_LINKS', `Invalid runbook links for: ${invalidRunbookLinks.join(', ')}`);
    return;
  }
  add('PASS', 'ALERT_INVENTORY_RUNBOOK_LINKS');

  const missingIds = inventory.alerts
    .filter((a) => requiredNames.includes(String(a?.name || '').trim()))
    .filter((a) => !String(a?.id || '').trim())
    .map((a) => String(a?.name || 'unknown'));
  if (missingIds.length > 0) {
    add('FAIL', 'ALERT_INVENTORY_IDS_PRESENT', `Missing IDs for: ${missingIds.join(', ')}`);
  } else {
    add('PASS', 'ALERT_INVENTORY_IDS_PRESENT');
  }
}

function verifySemanticQualityOnlineChecks() {
  const full = run('E2E_FULL_SCAN_CHAT_GATE', 'npm', ['run', 'test:e2e-full-scan-chat']);
  if (!full.ok) return;
  const result = parseLastJsonObject(full.out.stdout);
  if (!result || !result.ok) {
    add('FAIL', 'SEMANTIC_E2E_PARSE', 'Could not parse full scan-chat E2E JSON output');
    return;
  }
  const assistant = Array.isArray(result?.transcript?.assistant) ? result.transcript.assistant : [];
  const user = Array.isArray(result?.transcript?.user) ? result.transcript.user : [];
  const afterScanReply = String(assistant[assistant.length - 2] || '').toLowerCase();
  const finalReply = String(assistant[assistant.length - 1] || '').toLowerCase();
  const scanReferenced = /(fruit snacks|orange juice|scan|barcode|food|ingredient|product|category route)/i.test(afterScanReply);
  const noGenericFallback = !/(don't see|do not see|what product did you scan|could you share.*product|what symptom or concern should we focus on next|which part of your body is affected)/i.test(afterScanReply);
  const continuity = /(low risk|generally safe|children|parent|practical|takeaway|product|fruit snacks|orange juice)/i.test(finalReply);
  if (!scanReferenced) add('FAIL', 'SEMANTIC_SCAN_REFERENCE', 'Turn after scan did not reference scanned product/category');
  else add('PASS', 'SEMANTIC_SCAN_REFERENCE');
  if (!noGenericFallback) add('FAIL', 'SEMANTIC_NO_GENERIC_FALLBACK', 'Generic fallback detected with scan context present');
  else add('PASS', 'SEMANTIC_NO_GENERIC_FALLBACK');
  if (!continuity) add('FAIL', 'SEMANTIC_TURN_CONTINUITY', 'Final turn did not maintain scan-topic continuity');
  else add('PASS', 'SEMANTIC_TURN_CONTINUITY');
  const verdict = result.ok && scanReferenced && noGenericFallback && continuity ? 'PASS' : 'FAIL';
  fs.writeFileSync(
    semanticQualityArtifactPath,
    JSON.stringify(
      {
        run_at: new Date().toISOString(),
        session_id: result.session_id || null,
        barcode_lookup: result.barcode_lookup || null,
        assertions: {
          semantic_scan_reference: scanReferenced,
          semantic_no_generic_fallback: noGenericFallback,
          semantic_turn_continuity: continuity
        },
        verdict
      },
      null,
      2
    )
  );
  add(verdict === 'PASS' ? 'PASS' : 'FAIL', 'SEMANTIC_QUALITY_ARTIFACT', semanticQualityArtifactPath);
}

function verifyDlqStabilityGate() {
  const triage = run('DLQ_TRIAGE_REPLAY', 'npm', ['run', 'ops:dlq:tool-calls:triage-replay']);
  const resolve = run('DLQ_RESOLVE_TERMINAL', 'npm', ['run', 'ops:dlq:tool-calls:resolve-terminal']);
  if (!triage.ok || !resolve.ok) return;

  const triageJson = parseLastJsonObject(triage.out.stdout);
  const resolveJson = parseLastJsonObject(resolve.out.stdout);
  if (!triageJson) {
    add('FAIL', 'DLQ_TRIAGE_JSON_PARSE', 'Could not parse triage-replay output JSON');
    return;
  }
  if (!resolveJson) {
    add('FAIL', 'DLQ_RESOLVE_JSON_PARSE', 'Could not parse resolve-terminal output JSON');
    return;
  }
  const stable = Number(triageJson.stable_size ?? triageJson.after_size ?? 0);
  if (stable > DLQ_MAX_BACKLOG) {
    add('FAIL', 'DLQ_BACKLOG_THRESHOLD', `stable_size=${stable} exceeds max=${DLQ_MAX_BACKLOG}`);
  } else {
    add('PASS', 'DLQ_BACKLOG_THRESHOLD', `stable_size=${stable} (max=${DLQ_MAX_BACKLOG})`);
  }
  const terminalRemaining = Number(resolveJson.terminal_identified || 0) - Number(resolveJson.archived_count || 0);
  if (terminalRemaining > 0) {
    add('FAIL', 'DLQ_TERMINAL_RESOLUTION_STATUS', `${terminalRemaining} terminal entries not archived`);
  } else {
    add('PASS', 'DLQ_TERMINAL_RESOLUTION_STATUS', `archived=${resolveJson.archived_count || 0}`);
  }

  fs.writeFileSync(
    dlqStabilityArtifactPath,
    JSON.stringify(
      {
        captured_at: new Date().toISOString(),
        threshold_max_backlog: DLQ_MAX_BACKLOG,
        triage: triageJson,
        terminal_resolution: resolveJson
      },
      null,
      2
    )
  );
  add('PASS', 'DLQ_STABILITY_ARTIFACT_WRITTEN', dlqStabilityArtifactPath);
}

function verifyRouteRegressionCounters() {
  const snap = verifyArtifactJson(
    routeRegressionSnapshotPath,
    'ROUTE_REGRESSION_SNAPSHOT',
    ['captured_at', 'window_minutes', 'metrics']
  );
  if (!snap) return;
  if (!snap.metrics || typeof snap.metrics !== 'object') {
    add('FAIL', 'ROUTE_REGRESSION_SNAPSHOT_METRICS', 'metrics must be an object of counters');
    return;
  }
  const entries = Object.entries(snap.metrics).map(([k, v]) => [k, Number(v || 0)]);
  const offenders = entries.filter(([, v]) => v > ROUTE_REGRESSION_MAX_COUNT);
  if (offenders.length > 0) {
    add(
      'FAIL',
      'ROUTE_REGRESSION_COUNTERS_WITHIN_POLICY',
      offenders.map(([k, v]) => `${k}=${v}`).join(', ')
    );
  } else {
    add('PASS', 'ROUTE_REGRESSION_COUNTERS_WITHIN_POLICY', `all <= ${ROUTE_REGRESSION_MAX_COUNT}`);
  }
}

function verifyMigrationRiskDecision() {
  const memo = verifyArtifactJson(
    migrationRiskMemoPath,
    'MIGRATION_RISK_MEMO',
    ['owner', 'date', 'decision', 'dedupe_audit', 'queue_snapshot_assessment']
  );
  if (!memo) return;
  const decision = String(memo.decision || '').trim();
  if (!['safe_to_ship', 'requires_fix_before_ship'].includes(decision)) {
    add('FAIL', 'MIGRATION_RISK_DECISION_ENUM', `Invalid decision=${decision}`);
    return;
  }
  add('PASS', 'MIGRATION_RISK_DECISION_ENUM', decision);
  if (decision === 'requires_fix_before_ship') {
    add('FAIL', 'MIGRATION_RISK_DECISION_SHIP_BLOCK', 'Decision requires_fix_before_ship blocks release');
  } else {
    add('PASS', 'MIGRATION_RISK_DECISION_SHIP_BLOCK');
  }
}

function verifyE2EScanChatGate() {
  const skipE2E = String(process.env.REASONING_RELEASE_SKIP_E2E || '') === '1';
  if (skipE2E) {
    const waiver = verifyArtifactJson(
      e2eWaiverPath,
      'E2E_SCAN_CHAT_WAIVER',
      ['owner', 'reason', 'ticket', 'expiry']
    );
    if (!waiver) return;
    const expiryMs = Date.parse(String(waiver.expiry || ''));
    if (!Number.isFinite(expiryMs)) {
      add('FAIL', 'E2E_SCAN_CHAT_WAIVER_EXPIRY_PARSE', `Invalid expiry: ${waiver.expiry}`);
      return;
    }
    if (expiryMs < Date.now()) {
      add('FAIL', 'E2E_SCAN_CHAT_WAIVER_NOT_EXPIRED', `Waiver expired at ${waiver.expiry}`);
      return;
    }
    add('WARN', 'E2E_SCAN_CHAT_SKIPPED_WITH_WAIVER', `Valid waiver until ${waiver.expiry}`);
    return;
  }
  run('E2E_SCAN_CHAT_TWO_TURN_GATE', 'npm', ['run', 'test:e2e-chat-scan-gate']);
}

function writeSummary() {
  fs.mkdirSync(path.dirname(summaryArtifact), { recursive: true });
  fs.writeFileSync(
    summaryArtifact,
    JSON.stringify(
      {
        run_at: new Date().toISOString(),
        git_sha: gitSha,
        failed,
        results
      },
      null,
      2
    )
  );
  console.log(`Summary: ${summaryArtifact}`);
}

function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  requireEnv();
  verifyLangSmithEnvProject();
  run('FLAG_STATE_CHECK', process.execPath, [path.join(ROOT, 'scripts/check-reasoning-flag-state.cjs')]);
  run('REASONING_GUARDRAILS', 'npm', ['run', 'test:reasoning:guardrails'], {});
  run('REASONING_MAP_TEST', 'npm', ['run', 'test:reasoning-map'], {});
  verifyPineconeReadiness();
  verifyBatch3DocsAndMapping();
  verifyBatch3Artifacts();
  verifyAlertToRunbookLiveWiring();
  verifyDlqStabilityGate();
  verifyRouteRegressionCounters();
  verifyMigrationRiskDecision();
  verifyE2EScanChatGate();
  verifySemanticQualityOnlineChecks();

  const harness = run(
    'HARNESS_RUN',
    'npm',
    ['run', 'eval:reasoning:harness', '--', '--output', harnessArtifact]
  );
  if (harness.ok) validateHarnessArtifact(harnessArtifact);

  writeSummary();
  process.exit(failed ? 1 : 0);
}

main();
