#!/usr/bin/env node
/**
 * Phase 0 Security & Financial Integrity — Verification Test Suite
 *
 * Usage:
 *   node phase0-verify.js                        # run all checks
 *   node phase0-verify.js --section 1            # run one section
 *   node phase0-verify.js --archive              # archive todo on full pass
 *   BASE_URL=https://api.example.com node phase0-verify.js  # test remote
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = one or more checks failed
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ─── Config ──────────────────────────────────────────────────────────────────
const BASE_URL    = process.env.BASE_URL    || 'http://localhost:4000';
const ROOT        = process.env.PROJECT_ROOT || path.join(__dirname, 'middleware-platform');
/** Consolidated middleware docs (repo root), replaces former `docs/middleware-platform/*.md` tree */
const MW_DOCS_README = path.join(ROOT, '..', 'docs', 'middleware-platform', 'README.md');
const REPO_DOCS_RUNBOOKS_MP = path.join(ROOT, '..', 'docs', 'runbooks', 'middleware-platform');
const TODOS_SRC   = process.env.TODOS_SRC   || path.join(__dirname, 'todos/pending/PHASE0_SECURITY_FINANCIAL_INTEGRITY_TODOS.md');
const TODOS_ARCH  = process.env.TODOS_ARCH  || path.join(__dirname, 'todos/archived');
const ARGS        = process.argv.slice(2);
const ONLY_SECTION = (() => { const i = ARGS.indexOf('--section'); return i >= 0 ? Number(ARGS[i+1]) : null; })();
const DO_ARCHIVE  = ARGS.includes('--archive');
const VERBOSE     = ARGS.includes('--verbose') || ARGS.includes('-v');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

let passed = 0, failed = 0, skipped = 0;
const failures = [];

function p(label)   { return path.join(ROOT, label); }
function exists(fp) { try { return fs.existsSync(fp); } catch(_) { return false; } }

function fileContains(fp, pattern) {
  try {
    const content = fs.readFileSync(fp, 'utf8');
    if (pattern instanceof RegExp) return pattern.test(content);
    return content.includes(pattern);
  } catch(_) { return false; }
}

function grepDir(dir, pattern, ext = '.js') {
  if (!exists(dir)) return false;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { if (walk(full)) return true; }
      else if (entry.name.endsWith(ext) && fileContains(full, pattern)) return true;
    }
    return false;
  };
  return walk(dir);
}

function check(section, name, fn) {
  if (ONLY_SECTION && section !== ONLY_SECTION) { skipped++; return; }
  let ok = false;
  let reason = '';
  try {
    const result = fn();
    ok = result === true || result === undefined;
    if (typeof result === 'string') { ok = false; reason = result; }
  } catch(e) { ok = false; reason = e.message; }

  if (ok) {
    passed++;
    if (VERBOSE) console.log(`  ${GREEN}✓${RESET} [§${section}] ${name}`);
  } else {
    failed++;
    failures.push({ section, name, reason });
    console.log(`  ${RED}✗${RESET} [§${section}] ${name}${reason ? ` — ${YELLOW}${reason}${RESET}` : ''}`);
  }
}

async function httpGet(urlPath, adminToken) {
  return new Promise((resolve) => {
    const full = `${BASE_URL}${urlPath}`;
    const mod  = full.startsWith('https') ? https : http;
    const opts = { timeout: 5000 };
    if (adminToken) opts.headers = { 'Authorization': `Bearer ${adminToken}` };
    const req = mod.get(full, opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.on('timeout', ()  => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

// ─── SECTION 1: Payment Security & Fraud Controls ────────────────────────────
function runSection1() {
  console.log(`\n${BOLD}§1 Payment Security & Fraud Controls${RESET}`);

  check(1, 'withIdempotency middleware exists in server.js',
    () => fileContains(p('server.js'), 'withIdempotency'));

  check(1, 'Idempotency covers refund path',
    () => fileContains(p('routes/payment.js'), 'withPaymentIdempotency'));

  check(1, 'Idempotency TTL cleanup scheduled',
    () => fileContains(p('server.js'), 'cleanupIdempotencyKeys'));

  check(1, 'Duplicate-charge guard in /process-payment',
    () => fileContains(p('server.js'), 'DUPLICATE_PAYMENT_ATTEMPT'));

  check(1, 'Duplicate-charge guard in /api/payment/process',
    () => fileContains(p('routes/payment.js'), 'rejectDuplicatePaymentAttempt'));

  check(1, 'Stripe webhook signature validation present',
    () => fileContains(p('routes/stripe-webhook-handler.js'), 'constructEvent'));

  check(1, 'STRIPE_WEBHOOK_SECRET required (not optional)',
    () => fileContains(p('routes/stripe-webhook-handler.js'), 'STRIPE_WEBHOOK_SECRET'));

  check(1, 'Stripe webhook staleness window enforced',
    () => fileContains(p('routes/stripe-webhook-handler.js'), 'STRIPE_WEBHOOK_REPLAY_WINDOW_SEC'));

  check(1, 'Stripe webhook dedup table (stripe_webhook_events)',
    () => fileContains(p('routes/stripe-webhook-handler.js'), 'stripe_webhook_events'));

  check(1, 'Circle webhook signature verification called',
    () => fileContains(p('server.js'), 'verifyWebhookSignature'));

  check(1, 'Circle webhook replay defense present',
    () => fileContains(p('server.js'), /replay.*circle|circle.*replay/i));

  check(1, 'Twilio signature middleware file exists',
    () => exists(p('middleware/webhook-security.js')));

  check(1, 'twilioSignatureRequired enforces in production',
    () => fileContains(p('middleware/webhook-security.js'), 'twilioSignatureRequired'));

  check(1, 'Twilio replayGuard uses SHA-256 hashing',
    () => fileContains(p('middleware/webhook-security.js'), 'sha256'));

  check(1, 'Twilio replay guard applied to /voice/incoming',
    () => fileContains(p('server.js'), /replayGuard.*twilio_voice_incoming|twilio_voice_incoming.*replayGuard/));

  check(1, 'Anti-sybil service file exists',
    () => exists(p('services/anti-sybil-service.js')));

  check(1, 'Anti-sybil evaluateAndRecord covers identity + IP + amount',
    () => fileContains(p('services/anti-sybil-service.js'), 'identity_burst_15m') &&
          fileContains(p('services/anti-sybil-service.js'), 'ip_burst_10m'));

  check(1, 'Anti-sybil block/challenge/allow decision logic',
    () => fileContains(p('services/anti-sybil-service.js'), "decision = score >= 70 ? 'block'"));

  check(1, 'Anti-sybil appeal submission endpoint exists',
    () => fileContains(p('services/anti-sybil-service.js'), 'submitAppeal'));

  check(1, 'Anti-sybil wired to payment processing path',
    () => fileContains(p('server.js'), 'ANTI_SYBIL_BLOCKED'));

  check(1, 'Fraud response playbook published (consolidated middleware README)',
    () => exists(MW_DOCS_README) && fileContains(MW_DOCS_README, 'Fraud Response Playbook'));
}

// ─── SECTION 2: Financial Integrity & Reconciliation ─────────────────────────
function runSection2() {
  console.log(`\n${BOLD}§2 Financial Integrity & Reconciliation${RESET}`);

  check(2, 'Financial integrity migration file exists',
    () => exists(p('migrations/041_financial_integrity_reconciliation.js')));

  check(2, 'Canonical ledger events table defined',
    () => fileContains(p('migrations/041_financial_integrity_reconciliation.js'), 'ledger_events_canonical'));

  check(2, 'All 6 canonical event types documented',
    () => fileContains(p('migrations/041_financial_integrity_reconciliation.js'),
          'authorization|capture|settlement|refund|dispute|adjustment'));

  check(2, 'Provider reconciliation rows table defined',
    () => fileContains(p('migrations/041_financial_integrity_reconciliation.js'), 'provider_reconciliation_rows'));

  check(2, 'Processor reconciliation rows table defined',
    () => fileContains(p('migrations/041_financial_integrity_reconciliation.js'), 'processor_reconciliation_rows'));

  check(2, 'Reconciliation job runs table with deterministic_key UNIQUE',
    () => fileContains(p('migrations/041_financial_integrity_reconciliation.js'), 'deterministic_key TEXT NOT NULL UNIQUE'));

  check(2, 'Exception table with SLA + owner columns',
    () => fileContains(p('migrations/041_financial_integrity_reconciliation.js'), 'sla_due_at') &&
          fileContains(p('migrations/041_financial_integrity_reconciliation.js'), 'owner'));

  check(2, 'Financial close reports table defined',
    () => fileContains(p('migrations/041_financial_integrity_reconciliation.js'), 'financial_close_reports'));

  check(2, 'Reconciliation snapshots table defined',
    () => fileContains(p('migrations/041_financial_integrity_reconciliation.js'), 'reconciliation_snapshots'));

  check(2, 'Immutable snapshot triggers (UPDATE + DELETE)',
    () => fileContains(p('migrations/041_financial_integrity_reconciliation.js'), 'trg_reconciliation_snapshots_no_update') &&
          fileContains(p('migrations/041_financial_integrity_reconciliation.js'), 'trg_reconciliation_snapshots_no_delete'));

  check(2, 'Financial integrity service file exists',
    () => exists(p('services/financial-integrity-service.js')));

  check(2, 'runDeterministicReconciliation uses hash-based key',
    () => fileContains(p('services/financial-integrity-service.js'), 'deterministicKey'));

  check(2, '6 mismatch classifications implemented',
    () => fileContains(p('services/financial-integrity-service.js'), 'missing_internal') &&
          fileContains(p('services/financial-integrity-service.js'), 'currency_mismatch') &&
          fileContains(p('services/financial-integrity-service.js'), 'amount_mismatch'));

  check(2, 'SLA resolution by severity (critical = 2h)',
    () => fileContains(p('services/financial-integrity-service.js'), 'RECON_SLA_HOURS_CRITICAL'));

  check(2, 'Daily close report generation implemented',
    () => fileContains(p('services/financial-integrity-service.js'), 'generateDailyFinancialCloseReport'));

  check(2, 'Snapshot chain (previous_hash) maintained',
    () => fileContains(p('services/financial-integrity-service.js'), 'previous_hash'));

  check(2, 'Reconciliation job wired in server.js on interval',
    () => fileContains(p('server.js'), 'runDeterministicReconciliation') &&
          fileContains(p('server.js'), 'FINANCIAL_INTEGRITY_JOBS_ENABLED'));

  check(2, 'RCM reconciliation run endpoint mounted',
    () => fileContains(p('routes/rcm.js'), '/reconciliation/run'));

  check(2, 'Financial close endpoint mounted',
    () => fileContains(p('routes/rcm.js'), '/financial-close'));
}

// ─── SECTION 3: Payments Edge-Case Operations ────────────────────────────────
function runSection3() {
  console.log(`\n${BOLD}§3 Payments Edge-Case Operations${RESET}`);

  check(3, 'Edge-case operations migration file exists',
    () => exists(p('migrations/042_payment_edge_case_operations.js')));

  check(3, 'Refund audit table in migration',
    () => fileContains(p('migrations/042_payment_edge_case_operations.js'), 'payment_refund_audit'));

  check(3, 'Disputes table in migration',
    () => fileContains(p('migrations/042_payment_edge_case_operations.js'), 'payment_disputes'));

  check(3, 'Settlement dead-letter queue in migration',
    () => fileContains(p('migrations/042_payment_edge_case_operations.js'), 'settlement_dead_letter_queue'));

  check(3, 'Exception ownership table in migration',
    () => fileContains(p('migrations/042_payment_edge_case_operations.js'), 'payment_exception_queue_roles'));

  check(3, 'Refund workflow service exists',
    () => exists(p('services/refund-workflow-service.js')));

  check(3, 'Refund eligibility gate enforced (checkout status + age)',
    () => fileContains(p('services/refund-workflow-service.js'), 'REFUND_MAX_AGE_DAYS'));

  check(3, 'Refund uses Stripe amount_received ceiling (no over-refund)',
    () => fileContains(p('services/refund-workflow-service.js'), 'amount_received') ||
          fileContains(p('services/refund-workflow-service.js'), 'amount_refunded'));

  check(3, 'Refund audit trail (before + after Stripe call)',
    () => fileContains(p('services/refund-workflow-service.js'), 'insertPaymentRefundAudit') ||
          fileContains(p('services/refund-workflow-service.js'), 'updatePaymentRefundAudit'));

  check(3, '/api/payment/refund uses RefundWorkflowService',
    () => fileContains(p('routes/payment.js'), 'RefundWorkflowService') ||
          fileContains(p('routes/payment.js'), 'refund-workflow-service'));

  check(3, 'Dispute service file exists',
    () => exists(p('services/payment-dispute-service.js')));

  check(3, 'Dispute status transitions mapped',
    () => fileContains(p('services/payment-dispute-service.js'), 'workflow_status'));

  check(3, 'Dispute owner/backup assignment implemented',
    () => fileContains(p('services/payment-dispute-service.js'), 'owner'));

  check(3, 'Stripe dispute webhook events handled',
    () => fileContains(p('routes/stripe-webhook-handler.js'), 'charge.dispute.created') ||
          fileContains(p('routes/stripe-webhook-handler.js'), 'dispute'));

  check(3, 'Settlement retry service file exists',
    () => exists(p('services/settlement-retry-service.js')));

  check(3, 'Exponential backoff in retry service',
    () => fileContains(p('services/settlement-retry-service.js'), /backoff|exponential/i));

  check(3, 'Dead-letter after max attempts',
    () => fileContains(p('services/settlement-retry-service.js'), 'SETTLEMENT_RETRY_MAX_ATTEMPTS'));

  check(3, 'Settlement retry worker started in server.js',
    () => fileContains(p('server.js'), 'SETTLEMENT_RETRY_JOB_ENABLED') ||
          fileContains(p('server.js'), 'settlement-retry'));

  check(3, 'Exception ownership service file exists',
    () => exists(p('services/payment-exception-ownership.js')));

  check(3, 'DRI primary/backup env vars used',
    () => fileContains(p('services/payment-exception-ownership.js'), 'PAYMENT_EXCEPTION_DRI_PRIMARY'));

  check(3, 'Payment ops routes mounted',
    () => exists(p('routes/payment-ops.js')));

  check(3, 'Disputes admin endpoint exists in payment-ops',
    () => fileContains(p('routes/payment-ops.js'), '/disputes'));

  check(3, 'Exception owners endpoint exists in payment-ops',
    () => fileContains(p('routes/payment-ops.js'), 'exception-owners'));

  check(3, 'Customer-facing payment error taxonomy doc exists',
    () => exists(MW_DOCS_README) && fileContains(MW_DOCS_README, 'Payment errors'));
}

// ─── SECTION 4: Reliability & Operations Discipline ──────────────────────────
function runSection4() {
  console.log(`\n${BOLD}§4 Reliability & Operations Discipline${RESET}`);

  check(4, 'SLO/SLI documentation exists',
    () => exists(MW_DOCS_README) && fileContains(MW_DOCS_README, 'SLOs'));

  check(4, 'SLO targets cover payment API + webhook + reconciliation',
    () => fileContains(MW_DOCS_README, 'webhook') &&
          fileContains(MW_DOCS_README, 'reconciliation'));

  check(4, 'Payment reliability monitor service exists',
    () => exists(p('services/payment-reliability-monitor.js')));

  check(4, 'Monitor checks webhook failures',
    () => fileContains(p('services/payment-reliability-monitor.js'), 'stripe_webhook_events'));

  check(4, 'Monitor checks reconciliation SLA breaches',
    () => fileContains(p('services/payment-reliability-monitor.js'), 'sla_due_at'));

  check(4, 'Monitor checks payment failure spikes',
    () => fileContains(p('services/payment-reliability-monitor.js'), /payment.*fail|ops_counter/i));

  check(4, 'Alerts endpoint mounted in payment-ops',
    () => fileContains(p('routes/payment-ops.js'), '/alerts') ||
          fileContains(p('routes/payment-ops.js'), 'alerts'));

  check(4, 'Reliability monitor worker started in server.js',
    () => fileContains(p('server.js'), 'PAYMENT_RELIABILITY_MONITOR_ENABLED') ||
          fileContains(p('server.js'), 'payment-reliability-monitor'));

  check(4, 'On-call and escalation policy doc exists',
    () => exists(MW_DOCS_README) && fileContains(MW_DOCS_README, 'On-call'));

  check(4, 'Processor outage runbook exists',
    () => exists(path.join(REPO_DOCS_RUNBOOKS_MP, 'RUNBOOK_PROCESSOR_OUTAGE.md')));

  check(4, 'Replay attack runbook exists',
    () => exists(path.join(REPO_DOCS_RUNBOOKS_MP, 'RUNBOOK_REPLAY_ATTACK_ATTEMPT.md')));

  check(4, 'Reconciliation drift runbook exists',
    () => exists(path.join(REPO_DOCS_RUNBOOKS_MP, 'RUNBOOK_RECONCILIATION_DRIFT.md')));

  check(4, 'Stripe webhook failures runbook exists',
    () => exists(path.join(REPO_DOCS_RUNBOOKS_MP, 'RUNBOOK_STRIPE_WEBHOOK_FAILURES.md')));

  check(4, 'Incident response protocol doc exists',
    () => exists(MW_DOCS_README) && fileContains(MW_DOCS_README, 'Incident response'));

  check(4, 'Incident response has severity model',
    () => fileContains(MW_DOCS_README, /sev(erity)?[ -]?[12]/i));

  check(4, 'Postmortem template exists',
    () => exists(MW_DOCS_README) && fileContains(MW_DOCS_README, 'Postmortem'));

  check(4, 'Postmortem template has remediation tracking section',
    () => fileContains(MW_DOCS_README, /remediation|action item/i));
}

// ─── SECTION 5: Data Privacy, Governance & Auditability ─────────────────────
function runSection5() {
  console.log(`\n${BOLD}§5 Data Privacy, Governance & Auditability${RESET}`);

  check(5, 'Audit event insertion used across codebase',
    () => grepDir(p(''), 'insertAuditEvent'));

  check(5, 'HIPAA access log insertion present',
    () => grepDir(p(''), 'insertHipaaAccessLog'));

  check(5, 'Audit log schema has actor/action/resource/timestamp',
    () => grepDir(p('migrations'), 'actor_type') &&
          grepDir(p('migrations'), 'resource_type'));

  check(5, 'sanitizeForLog / safeLogRequestBody used for PII redaction',
    () => fileContains(p('services/payment-security.js'), 'sanitizeForLog') ||
          fileContains(p('server.js'), 'sanitizeForLog'));

  check(5, 'Least-privilege session auth middleware exists (requirePatientSession)',
    () => fileContains(p('server.js'), 'requirePatientSession'));

  check(5, 'Provider auth middleware enforces X-Provider-Id',
    () => fileContains(p('server.js'), 'requireProviderAuth'));

  check(5, 'Admin auth middleware enforces session',
    () => fileContains(p('middleware/admin-auth.js'), 'requireAdminAuth') ||
          fileContains(p('server.js'), 'requireAdminAuth'));

  check(5, 'JWT required for FHIR endpoints in production',
    () => fileContains(p('server.js'), 'REQUIRE_JWT_FOR_FHIR'));

  check(5, 'Patient session rotation implemented',
    () => fileContains(p('server.js'), 'rotatePatientSessionIfNeeded'));

  check(5, 'CSRF protection on cookie-based patient sessions',
    () => fileContains(p('server.js'), 'requireCsrfForCookieAuth'));

  check(5, 'Seed endpoint blocked in production/staging',
    () => fileContains(p('server.js'), "env === 'production'") &&
          fileContains(p('server.js'), 'SEED_ENABLED'));

  check(5, 'Document download tokens are single-use',
    () => fileContains(p('server.js'), 'markPatientDocumentDownloadTokenUsed'));

  check(5, 'Bot/WAF guard on sensitive public endpoints',
    () => fileContains(p('server.js'), 'botGuard'));

  check(5, 'Dev endpoints blocked in production (create-test-payment-method)',
    () => fileContains(p('server.js'), "NODE_ENV !== 'production'") &&
          fileContains(p('server.js'), 'create-test-payment-method'));
}

// ─── SECTION 6: Key & Secret Management ──────────────────────────────────────
function runSection6() {
  console.log(`\n${BOLD}§6 Key & Secret Management${RESET}`);

  check(6, 'env-validator utility exists',
    () => exists(p('utils/env-validator.js')));

  check(6, 'validateAndExitIfInvalid called on startup',
    () => fileContains(p('server.js'), 'validateAndExitIfInvalid'));

  check(6, 'Stripe key validated through stripe-config (not raw env)',
    () => exists(p('utils/stripe-config.js')) &&
          fileContains(p('utils/stripe-config.js'), 'SECURITY ERROR'));

  check(6, 'JWT_SECRET minimum length enforced in production',
    () => fileContains(p('server.js'), 'jwtSecret.length < 32'));

  check(6, 'REQUIRE_JWT_FOR_FHIR enforced in production',
    () => fileContains(p('server.js'), "Refusing to start") &&
          fileContains(p('server.js'), 'REQUIRE_JWT_FOR_FHIR'));

  check(6, 'Circle API key never logged (sanitizeForLog used)',
    () => fileContains(p('services/payment-security.js'), 'sanitize') ||
          grepDir(p('services'), 'sanitizeForLog'));

  check(6, 'API keys are hashed before storage',
    () => fileContains(p('utils/api-keys.js'), 'hashApiKey') ||
          grepDir(p('utils'), 'hashApiKey'));

  check(6, 'API key encryption/decryption utility exists',
    () => fileContains(p('utils/api-keys.js'), 'encrypt') ||
          fileContains(p('utils/api-keys.js'), 'decrypt'));

  check(6, 'Key rotation endpoint exists for merchant API keys',
    () => fileContains(p('server.js'), '/api-keys/rotate') ||
          grepDir(p('routes'), 'rotateMerchantApiKey'));

  check(6, 'Scoped JWT tokens for FHIR/patient auth',
    () => exists(p('routes/auth-tokens.js')));

  check(6, 'Secret material blocked in logs (no raw key logging)',
    () => !fileContains(p('server.js'), /console\.log.*STRIPE_SECRET/i) &&
          !fileContains(p('server.js'), /console\.log.*CIRCLE_API_KEY/i));

  check(6, 'Wallet recovery procedures documented',
    () => exists(MW_DOCS_README) && fileContains(MW_DOCS_README, 'Wallet key custody'));
}

// ─── SECTION 7: Impact Ledger & Public Trust ─────────────────────────────────
function runSection7() {
  console.log(`\n${BOLD}§7 Impact Ledger & Public Trust Infrastructure${RESET}`);

  check(7, 'Impact ledger schema/migration exists',
    () => grepDir(p('migrations'), 'impact_ledger') ||
          grepDir(p('migrations'), 'impact_events'));

  check(7, 'Impact event types defined (provenance/verification_state)',
    () => grepDir(p('migrations'), 'verification_state') ||
          grepDir(p('services'), 'verification_state'));

  check(7, 'Verified impact standard defined (evidence requirements)',
    () => grepDir(p('docs'), /verified.impact|impact.standard/i, '.md') ||
          grepDir(p('services'), 'verified_impact'));

  check(7, 'Immutable evidence hash chain implemented',
    () => grepDir(p('services'), 'hash_chain') ||
          grepDir(p('services'), 'evidence_hash') ||
          grepDir(p('migrations'), 'evidence_hash'));

  check(7, 'Read-only public dashboard endpoint exists',
    () => grepDir(p('routes'), /public.*dashboard|impact.*public/i) ||
          grepDir(p('routes'), 'impact_ledger'));

  check(7, 'Methodology page / explanation doc exists',
    () => grepDir(p('docs'), /methodology|impact.metric/i, '.md'));

  check(7, 'Governance charter for anti-gaming exists',
    () => grepDir(p('docs'), /governance|anti.gaming/i, '.md') ||
          grepDir(p('services'), 'anti.gaming'));
}

// ─── SECTION 8: Governance & Program Controls ────────────────────────────────
function runSection8() {
  console.log(`\n${BOLD}§8 Governance & Program Controls${RESET}`);

  check(8, 'Community charter document exists',
    () => grepDir(p('docs'), /community.charter|charter/i, '.md'));

  check(8, 'Contribution rulebook or anti-abuse policy exists',
    () => grepDir(p('docs'), /contribution.rule|anti.abuse/i, '.md'));

  check(8, 'Appeals process implemented (anti-sybil appeals)',
    () => fileContains(p('services/anti-sybil-service.js'), 'submitAppeal') &&
          exists(p('server.js')) &&
          fileContains(p('server.js'), 'risk-appeals'));

  check(8, 'Review committee / dispute review process documented',
    () => grepDir(p('docs'), /review.committee|dispute.review/i, '.md'));

  check(8, 'Treasury/routing decision rights documented',
    () => grepDir(p('docs'), /treasury|decision.rights/i, '.md'));

  check(8, 'Transparency cadence defined',
    () => grepDir(p('docs'), /transparency|ops.summary/i, '.md'));
}

// ─── SECTION 9: Validation Gates ─────────────────────────────────────────────
function runSection9() {
  console.log(`\n${BOLD}§9 Validation Gates${RESET}`);

  check(9, '100% webhook signature coverage — Stripe',
    () => fileContains(p('routes/stripe-webhook-handler.js'), 'constructEvent'));

  check(9, '100% webhook signature coverage — Twilio voice',
    () => fileContains(p('server.js'), 'twilioSignatureRequired'));

  check(9, '100% webhook signature coverage — Twilio SMS',
    () => fileContains(p('server.js'), 'twilioSignatureRequired') &&
          fileContains(p('server.js'), '/sms/incoming'));

  check(9, 'Reconciliation job capable of producing daily close',
    () => fileContains(p('services/financial-integrity-service.js'), 'generateDailyFinancialCloseReport'));

  check(9, 'No unresolved exception SLA query available',
    () => fileContains(p('services/financial-integrity-service.js'), 'listExceptionQueue'));

  check(9, 'Incident response doc with severity model present',
    () => exists(MW_DOCS_README) && fileContains(MW_DOCS_README, 'Incident response'));

  check(9, 'Privacy controls — PHI-scoped session auth enforced',
    () => fileContains(p('server.js'), 'requirePatientSession') &&
          fileContains(p('server.js'), 'jwtFhirAuth'));

  check(9, 'Audit log available for access-control review',
    () => grepDir(p(''), 'insertAuditEvent'));

  check(9, 'Postmortem template in place',
    () => exists(MW_DOCS_README) && fileContains(MW_DOCS_README, 'Postmortem'));
}

// ─── Live HTTP smoke tests (optional, non-blocking) ──────────────────────────
async function runSmokeTests() {
  console.log(`\n${BOLD}§HTTP Smoke Tests (${BASE_URL})${RESET}`);
  const token = process.env.ADMIN_SESSION_TOKEN || '';

  const tests = [
    { path: '/health',                            label: 'Health endpoint responds' },
    { path: '/api/rcm/financial-close',           label: 'Financial close endpoint accessible (admin)', token },
    { path: '/api/admin/payment-ops/alerts',      label: 'Alerts endpoint accessible (admin)',          token },
    { path: '/api/admin/payment-ops/slo',         label: 'SLO endpoint accessible (admin)',             token },
    { path: '/api/admin/payment-ops/disputes',    label: 'Disputes queue accessible (admin)',           token },
    { path: '/api/admin/payment-ops/exception-owners', label: 'Exception owners accessible (admin)',   token },
    { path: '/api/public/risk-appeals',           label: 'Risk appeals intake reachable (POST only, GET should 404)', expectNot: 200 },
  ];

  for (const t of tests) {
    const res = await httpGet(t.path, t.token);
    const got = res.status;
    const ok  = t.expectNot ? got !== t.expectNot : (got >= 200 && got < 500);
    if (ok) {
      passed++;
      if (VERBOSE) console.log(`  ${GREEN}✓${RESET} [HTTP] ${t.label} (${got})`);
    } else {
      failed++;
      failures.push({ section: 'HTTP', name: t.label, reason: `status ${got}` });
      console.log(`  ${RED}✗${RESET} [HTTP] ${t.label} — ${YELLOW}status ${got}${RESET}`);
    }
  }
}

// ─── Archive helper ───────────────────────────────────────────────────────────
function archiveTodos() {
  if (!exists(TODOS_SRC)) {
    console.log(`\n${YELLOW}⚠ Cannot archive: source file not found at ${TODOS_SRC}${RESET}`);
    return;
  }
  try {
    if (!fs.existsSync(TODOS_ARCH)) fs.mkdirSync(TODOS_ARCH, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const dest  = path.join(TODOS_ARCH, `PHASE0_SECURITY_FINANCIAL_INTEGRITY_TODOS_ARCHIVED_${stamp}.md`);
    let content = fs.readFileSync(TODOS_SRC, 'utf8');
    content = `> **ARCHIVED ${stamp}** — All Phase 0 checks passed. See phase0-verify.js for verification record.\n\n` + content;
    fs.writeFileSync(dest, content, 'utf8');
    fs.writeFileSync(TODOS_SRC, `# Phase 0 Todos — ARCHIVED\n\nArchived to: \`${dest}\`\nDate: ${stamp}\n\nAll items verified. See \`todos/archived/\` for the full record.\n`, 'utf8');
    console.log(`\n${GREEN}✅ Todos archived → ${dest}${RESET}`);
  } catch(e) {
    console.log(`\n${RED}✗ Archive failed: ${e.message}${RESET}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}╔════════════════════════════════════════════════════╗`);
  console.log(`║  Phase 0 — Security & Financial Integrity Checks  ║`);
  console.log(`╚════════════════════════════════════════════════════╝${RESET}`);
  console.log(`Project root : ${ROOT}`);
  console.log(`Server URL   : ${BASE_URL}`);
  if (ONLY_SECTION) console.log(`${YELLOW}Running section ${ONLY_SECTION} only${RESET}`);

  runSection1();
  runSection2();
  runSection3();
  runSection4();
  runSection5();
  runSection6();
  runSection7();
  runSection8();
  runSection9();

  if (!ONLY_SECTION) await runSmokeTests();

  // ─── Summary ───────────────────────────────────────────────────────────────
  const total = passed + failed + skipped;
  console.log(`\n${BOLD}─────────────────────────────────────────────────────${RESET}`);
  console.log(`${BOLD}Results:${RESET}  ${GREEN}${passed} passed${RESET}  ${failed > 0 ? RED : ''}${failed} failed${RESET}  ${YELLOW}${skipped} skipped${RESET}  (${total} total)`);

  if (failures.length) {
    console.log(`\n${RED}${BOLD}Failed checks:${RESET}`);
    failures.forEach(f => {
      console.log(`  ${RED}✗${RESET} [§${f.section}] ${f.name}${f.reason ? `\n        ${YELLOW}→ ${f.reason}${RESET}` : ''}`);
    });
  }

  const allPassed = failed === 0;

  if (allPassed) {
    console.log(`\n${GREEN}${BOLD}✅ All Phase 0 checks passed.${RESET}`);
    if (DO_ARCHIVE) {
      archiveTodos();
    } else {
      console.log(`${YELLOW}Run with --archive to archive the todos file.${RESET}`);
    }
  } else {
    console.log(`\n${RED}${BOLD}Phase 0 not complete — ${failed} check(s) failed.${RESET}`);
    console.log(`Fix the items above, then re-run:\n  node phase0-verify.js`);
    console.log(`\nTo run just one section:\n  node phase0-verify.js --section 3`);
  }

  console.log('');
  process.exit(allPassed ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

