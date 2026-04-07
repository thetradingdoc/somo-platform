/**
 * DocLittle — Clinical Pipeline Evaluation Script
 *
 * Usage (from middleware-platform/):
 *   node scripts/pipeline-eval.js
 *   node scripts/pipeline-eval.js --verbose
 *   node scripts/pipeline-eval.js --phase P6
 *
 * What this does:
 *   1. Probes service files (aligned to implemented phase modules)
 *   2. Validates exported interfaces
 *   3. Queries SQLite via sqlite_master (readonly DB open; mirrors database.js path rules)
 *   4. Functional smoke tests (no network, no LLM)
 *   5. Traces transcript event flow through current architecture
 *   6. Prints a phase-by-phase gap report
 *
 * Exit codes: 0 = no regressions (fail count 0), 1 = regression failures
 *
 * DB: set DB_PATH=./middleware-dev.db (from middleware-platform/) so table checks hit your dev DB.
 * Note: requiring modules that import database.js may print migration logs once (side effect).
 */

'use strict';

const path = require('path');
const fs = require('fs');

const VERBOSE = process.argv.includes('--verbose');
const PHASE_FILTER = (() => {
  const idx = process.argv.indexOf('--phase');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};
const pass = `${c.green}✔${c.reset}`;
const fail = `${c.red}✘${c.reset}`;
const missing = `${c.yellow}◌${c.reset}`;
const warn = `${c.yellow}⚠${c.reset}`;

const results = { pass: 0, fail: 0, missing: 0, warn: 0 };
const phaseResults = {};

function record(phase, status) {
  results[status]++;
  if (!phaseResults[phase]) phaseResults[phase] = { pass: 0, fail: 0, missing: 0, warn: 0 };
  phaseResults[phase][status]++;
}

function log(phase, status, label, detail) {
  record(phase, status);
  const icon = { pass, fail, missing, warn }[status];
  const color = { pass: c.green, fail: c.red, missing: c.yellow, warn: c.yellow }[status];
  console.log(`  ${icon} ${color}${label}${c.reset}${detail ? c.gray + '  ' + detail + c.reset : ''}`);
}

function findRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'server.js')) && fs.existsSync(path.join(cwd, 'services'))) {
    return cwd;
  }
  const mp = path.join(cwd, 'middleware-platform');
  if (fs.existsSync(mp)) return mp;
  let dir = cwd;
  for (let i = 0; i < 5; i++) {
    dir = path.dirname(dir);
    const candidate = path.join(dir, 'middleware-platform');
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(dir, 'server.js')) && fs.existsSync(path.join(dir, 'services'))) return dir;
  }
  return cwd;
}
const ROOT = findRoot();

function rel(p) {
  return path.join(ROOT, p);
}

function safeRequire(relPath) {
  const full = rel(relPath);
  if (!fs.existsSync(full)) return { ok: false, missing: true, error: `File not found: ${relPath}` };
  try {
    const mod = require(full);
    return { ok: true, exports: mod };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Mirror middleware-platform/database.js DB path resolution; open readonly for eval only. */
function resolveDbPath() {
  const env = process.env.NODE_ENV || 'development';
  const isProdEnv = env === 'production' || env === 'prod';
  const defaultDbDir = isProdEnv ? '/home' : (process.env.HOME || '/home' || ROOT);
  let dbFileName;
  if (process.env.DB_NAME) dbFileName = process.env.DB_NAME;
  else if (isProdEnv) dbFileName = 'middleware-prod.db';
  else if (env === 'test') dbFileName = 'middleware-test.db';
  else dbFileName = 'middleware-dev.db';
  return process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : path.join(defaultDbDir, dbFileName);
}

let DB = null;
function getDb() {
  if (DB !== null) return DB;
  try {
    const Database = require('better-sqlite3');
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) return null;
    DB = new Database(dbPath, { readonly: true, fileMustExist: true });
    return DB;
  } catch (_) {
    return null;
  }
}

function tableExists(tableName) {
  const db = getDb();
  if (!db) return null;
  try {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
    return !!row;
  } catch (_) {
    return null;
  }
}

function countRows(tableName) {
  const db = getDb();
  if (!db) return null;
  try {
    return db.prepare(`SELECT COUNT(*) as n FROM ${tableName}`).get()?.n ?? 0;
  } catch (_) {
    return null;
  }
}

function checkExport(mod, fnName) {
  if (!mod) return false;
  return typeof mod[fnName] === 'function' || typeof mod.default?.[fnName] === 'function';
}

function section(phase, title, subtitle) {
  if (PHASE_FILTER && PHASE_FILTER !== phase) return false;
  console.log(`\n${c.bold}${c.white}── ${phase}: ${title}${c.reset}`);
  if (subtitle) console.log(`${c.gray}   ${subtitle}${c.reset}`);
  return true;
}

console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════════════════════╗`);
console.log(`║   DocLittle — Clinical Pipeline Evaluation               ║`);
console.log(`╚══════════════════════════════════════════════════════════╝${c.reset}`);
console.log(`${c.gray}  Root: ${ROOT}${c.reset}`);
console.log(`${c.gray}  DB:  ${resolveDbPath()}${c.reset}`);
console.log(`${c.gray}  Time: ${new Date().toISOString()}${c.reset}`);

// ─── P0 — Channel Adapter & Event Envelope ───────────────────────────────────
if (section('P0', 'Channel Adapter & Event Envelope', 'Unified ingress (feature-flagged in server + video-consult)')) {
  const ca = safeRequire('services/channel-adapter.js');
  if (ca.missing) {
    log('P0', 'missing', 'services/channel-adapter.js');
  } else if (!ca.ok) {
    log('P0', 'fail', 'services/channel-adapter.js', ca.error);
  } else {
    log('P0', 'pass', 'services/channel-adapter.js exists');
    checkExport(ca.exports, 'adaptIncomingEvent')
      ? log('P0', 'pass', '  exports.adaptIncomingEvent()')
      : log('P0', 'fail', '  exports.adaptIncomingEvent()', 'Missing export');
  }

  const ee = safeRequire('services/event-envelope.js');
  if (ee.missing) {
    log('P0', 'missing', 'services/event-envelope.js');
  } else if (!ee.ok) {
    log('P0', 'fail', 'services/event-envelope.js', ee.error);
  } else {
    log('P0', 'pass', 'services/event-envelope.js exists');
    checkExport(ee.exports, 'buildEventEnvelope')
      ? log('P0', 'pass', '  exports.buildEventEnvelope()')
      : log('P0', 'fail', '  exports.buildEventEnvelope()', 'Missing export');
  }

  const vc = safeRequire('routes/video-consult.js');
  if (vc.ok) {
    const src = fs.readFileSync(rel('routes/video-consult.js'), 'utf8');
    src.includes('adaptIncomingEvent')
      ? log('P0', 'pass', 'routes/video-consult.js wires adaptIncomingEvent (when flag on)')
      : log('P0', 'warn', 'routes/video-consult.js', 'adaptIncomingEvent not found in source');
  } else if (vc.missing) {
    log('P0', 'fail', 'routes/video-consult.js', 'Route file missing');
  } else {
    log('P0', 'fail', 'routes/video-consult.js failed to load', vc.error);
  }

  const serverExists = fs.existsSync(rel('server.js'));
  if (serverExists) {
    const src = fs.readFileSync(rel('server.js'), 'utf8');
    src.includes('adaptIncomingEvent')
      ? log('P0', 'pass', 'server.js wires adaptIncomingEvent for chat (when flag on)')
      : log('P0', 'warn', 'server.js', 'adaptIncomingEvent not found in source');
  } else {
    log('P0', 'fail', 'server.js', 'Not found');
  }
}

// ─── P1 — Intake normalizer + evidence stream ────────────────────────────────
if (section('P1', 'Unified Intake Normalizer + intake_event_stream')) {
  const inn = safeRequire('services/intake-normalizer.js');
  if (inn.missing) {
    log('P1', 'missing', 'services/intake-normalizer.js');
  } else if (!inn.ok) {
    log('P1', 'fail', 'services/intake-normalizer.js', inn.error);
  } else {
    log('P1', 'pass', 'services/intake-normalizer.js exists');
    checkExport(inn.exports, 'normalizeIntakeEvent')
      ? log('P1', 'pass', '  exports.normalizeIntakeEvent()')
      : log('P1', 'fail', '  normalizeIntakeEvent', 'Missing');
    if (typeof inn.exports?.normalizeIntakeEvent === 'function') {
      try {
        const out = inn.exports.normalizeIntakeEvent({
          source: 'test',
          event_type: 'chat_turn',
          payload: { message: 'rash on face severity 6' },
        });
        if (out?.fields?.chief_complaint || out?.normalized_type) {
          log('P1', 'pass', '  normalizeIntakeEvent() smoke', VERBOSE ? JSON.stringify(out.fields || {}) : '');
        } else {
          log('P1', 'warn', '  normalizeIntakeEvent() unexpected shape');
        }
      } catch (e) {
        log('P1', 'fail', '  normalizeIntakeEvent() threw', e.message);
      }
    }
  }

  const ist = tableExists('intake_event_stream');
  if (ist === null) {
    log('P1', 'warn', 'DB: intake_event_stream', 'Could not open DB (set DB_PATH=./middleware-dev.db)');
  } else {
    ist
      ? log('P1', 'pass', 'DB: intake_event_stream table exists')
      : log('P1', 'missing', 'DB: intake_event_stream', 'Run app/migrations');
  }

  const sss = safeRequire('services/session-state-store.js');
  if (!sss.ok || sss.missing) {
    log('P1', sss.missing ? 'missing' : 'fail', 'services/session-state-store.js', sss.error || '');
  } else {
    log('P1', 'pass', 'services/session-state-store.js exists');
    ['upsertFromNormalizedEvent', 'getCanonicalState', 'evaluateGate'].forEach((fn) => {
      checkExport(sss.exports, fn)
        ? log('P1', 'pass', `  exports.${fn}()`)
        : log('P1', 'fail', `  exports.${fn}()`, 'Missing');
    });
  }

  const ssp = tableExists('session_state_projection');
  if (ssp === null) {
    log('P1', 'warn', 'DB: session_state_projection', 'Could not open DB');
  } else {
    ssp
      ? log('P1', 'pass', 'DB: session_state_projection table exists')
      : log('P1', 'missing', 'DB: session_state_projection');
  }

  const vcs = safeRequire('services/video-consult-service.js');
  if (vcs.ok) {
    ['createSession', 'getSessionState', 'appendLiveTranscript'].forEach((fn) => {
      checkExport(vcs.exports, fn)
        ? log('P1', 'pass', `  video-consult-service.${fn}()`)
        : log('P1', 'fail', `  video-consult-service.${fn}()`, 'Missing');
    });
  } else {
    log('P1', vcs.missing ? 'missing' : 'fail', 'services/video-consult-service.js', vcs.error || '');
  }
}

// ─── P2 — Safety Pre-Screen (unified) ─────────────────────────────────────
if (section("P2", "Safety Pre-Screen (unified)")) {
  const sps = safeRequire("services/safety-prescreen.js");
  if (sps.missing) {
    log("P2", "missing", "services/safety-prescreen.js");
  } else if (!sps.ok) {
    log("P2", "fail", "services/safety-prescreen.js", sps.error);
  } else {
    log("P2", "pass", "services/safety-prescreen.js exists");
    checkExport(sps.exports, "evaluateSafety")
      ? log("P2", "pass", "  exports.evaluateSafety()")
      : log("P2", "fail", "  evaluateSafety", "Missing");
    if (typeof sps.exports?.evaluateSafety === "function") {
      try {
        const r = sps.exports.evaluateSafety({ text: "chest pain", eventType: "transcript", payload: {} });
        if (r && r.status) {
          log("P2", "pass", `  evaluateSafety() smoke: status=${r.status}`, VERBOSE ? JSON.stringify(r.flags || []) : "");
        } else {
          log("P2", "warn", "  evaluateSafety() unexpected shape");
        }
      } catch (e) {
        log("P2", "fail", "  evaluateSafety() threw", e.message);
      }
    }
  }
  const st = safeRequire("services/symptom-triage-service.js");
  if (st.ok && checkExport(st.exports, "detectRisk")) {
    log("P2", "pass", "symptom-triage-service.detectRisk() (legacy video risk)");
  } else {
    log("P2", st.missing ? "missing" : "fail", "services/symptom-triage-service.js", st.error || "");
  }
}

// ─── P3 — Required-Fields Gate ─────────────────────────────────────────────
if (section("P3", "Required-Fields Gate + ask-next-question")) {
  const irf = safeRequire("services/intake-required-fields.js");
  if (irf.missing) {
    log("P3", "missing", "services/intake-required-fields.js");
  } else if (!irf.ok) {
    log("P3", "fail", "services/intake-required-fields.js", irf.error);
  } else {
    log("P3", "pass", "services/intake-required-fields.js exists");
    ["getRequiredFieldsSchema", "evaluateRequiredFields", "nextRequiredField"].forEach((fn) => {
      checkExport(irf.exports, fn)
        ? log("P3", "pass", `  exports.${fn}()`)
        : log("P3", "fail", `  ${fn}`, "Missing");
    });
  }
  const anq = safeRequire("services/ask-next-question-service.js");
  if (anq.missing) {
    log("P3", "missing", "services/ask-next-question-service.js");
  } else if (!anq.ok) {
    log("P3", "fail", "services/ask-next-question-service.js", anq.error);
  } else {
    log("P3", "pass", "services/ask-next-question-service.js");
    checkExport(anq.exports, "generateQuestion")
      ? log("P3", "pass", "  exports.generateQuestion()")
      : log("P3", "fail", "  generateQuestion", "Missing");
  }
  const tri = tableExists("triage_sessions");
  if (tri === null) {
    log("P3", "warn", "DB: triage_sessions", "DB not accessible");
  } else {
    tri ? log("P3", "pass", "DB: triage_sessions exists") : log("P3", "fail", "DB: triage_sessions missing");
  }
}

// ─── P4 — Map-first brain (named modules optional; underlying RAG exists) ───
if (section("P4", "ICD/CPT map layer (knowledge + triage RAG)")) {
  const pqs = safeRequire("services/pre-query-synthesis.js");
  log("P4", pqs.missing ? "missing" : pqs.ok ? "pass" : "fail", "services/pre-query-synthesis.js (optional named module)", pqs.error || "");
  const icm = safeRequire("services/icd-candidate-mapper.js");
  log("P4", icm.missing ? "missing" : icm.ok ? "pass" : "fail", "services/icd-candidate-mapper.js (optional named module)", icm.error || "");
  const ks = safeRequire("services/knowledge-service.js");
  if (ks.ok) {
    ["getCodeCandidatesDualSource", "validateCodesExist"].forEach((fn) => {
      checkExport(ks.exports, fn)
        ? log("P4", "pass", `  knowledge-service.${fn}()`)
        : log("P4", "fail", `  knowledge-service.${fn}()`, "Missing");
    });
    if (typeof ks.exports?.validateCodesExist === "function") {
      try {
        const v = ks.exports.validateCodesExist(
          { icd10: ["J06.9", "INVALID99"], cpt: ["99213"], hcpcs: [] },
          { trustExternalSource: true }
        );
        v && v.valid !== undefined
          ? log("P4", "pass", `  validateCodesExist smoke valid=${v.valid}`, VERBOSE ? JSON.stringify(v.invalid) : "")
          : log("P4", "warn", "  validateCodesExist unexpected shape");
      } catch (e) {
        log("P4", "fail", "  validateCodesExist threw", e.message);
      }
    }
  } else {
    log("P4", ks.missing ? "missing" : "fail", "services/knowledge-service.js", ks.error || "");
  }
  const tr2 = safeRequire("services/triage-rag-service-v2.js");
  if (tr2.ok && checkExport(tr2.exports, "enrichFromSymptoms")) {
    log("P4", "pass", "triage-rag-service-v2.enrichFromSymptoms()");
  } else {
    log("P4", tr2.missing ? "missing" : "fail", "services/triage-rag-service-v2.js", tr2.error || "");
  }
  const n = countRows("icd10_codes");
  if (n === null) {
    log("P4", "warn", "DB: icd10_codes count", "DB not accessible");
  } else if (n === 0) {
    log("P4", "warn", "DB: icd10_codes EMPTY", "Seed icd10_codes for full coding RAG (not a code regression)");
  } else {
    log("P4", "pass", `DB: icd10_codes rows=${n.toLocaleString()}`);
  }
}

// ─── P5 — Query Planner ──────────────────────────────────────────────────────
if (section("P5", "Query Planner + typed subqueries")) {
  const qp = safeRequire("services/query-planner.js");
  if (qp.missing) {
    log("P5", "missing", "services/query-planner.js");
  } else if (!qp.ok) {
    log("P5", "fail", "services/query-planner.js", qp.error);
  } else {
    log("P5", "pass", "services/query-planner.js");
    ["buildTypedQueryPlan", "runPathologyRetrieval", "resolveServiceOption"].forEach((fn) => {
      checkExport(qp.exports, fn)
        ? log("P5", "pass", `  exports.${fn}()`)
        : log("P5", "fail", `  ${fn}`, "Missing");
    });
    if (typeof qp.exports?.buildTypedQueryPlan === "function") {
      try {
        const plan = qp.exports.buildTypedQueryPlan({ message: "rash on face", state: {}, pathway: "triage" });
        plan && plan.subqueries
          ? log("P5", "pass", "  buildTypedQueryPlan() smoke", VERBOSE ? JSON.stringify(Object.keys(plan.subqueries || {})) : "")
          : log("P5", "warn", "  buildTypedQueryPlan unexpected shape");
      } catch (e) {
        log("P5", "fail", "  buildTypedQueryPlan threw", e.message);
      }
    }
  }
  const vcg = safeRequire("services/video-consult-graph.js");
  if (vcg.ok) {
    checkExport(vcg.exports, "processEvent")
      ? log("P5", "pass", "video-consult-graph.processEvent()")
      : log("P5", "fail", "processEvent missing");
    const src = fs.readFileSync(rel("services/video-consult-graph.js"), "utf8");
    src.includes("QueryPlanner") && src.includes("buildTypedQueryPlan")
      ? log("P5", "pass", "video-consult-graph references QueryPlanner")
      : log("P5", "warn", "video-consult-graph may not inject query_plan");
  } else {
    log("P5", vcg.missing ? "missing" : "fail", "services/video-consult-graph.js", vcg.error || "");
  }
}

// ─── P6 — OBF / CosIng stack ─────────────────────────────────────────────────
if (section("P6", "OBF / CosIng product + ingredient resolver")) {
  const pir = safeRequire("services/product-ingredient-resolver.js");
  if (pir.missing) {
    log("P6", "missing", "services/product-ingredient-resolver.js");
  } else if (!pir.ok) {
    log("P6", "fail", "services/product-ingredient-resolver.js", pir.error);
  } else {
    log("P6", "pass", "services/product-ingredient-resolver.js");
    ["resolveProductByName", "lookupIngredientFunctions"].forEach((fn) => {
      checkExport(pir.exports, fn)
        ? log("P6", "pass", `  exports.${fn}()`)
        : log("P6", "fail", `  ${fn}`, "Missing");
    });
  }
  ["scripts/ingest-obf.js", "scripts/ingest-cosing.js"].forEach((s) => {
    fs.existsSync(rel(s)) ? log("P6", "pass", `${s} exists`) : log("P6", "missing", s);
  });
  ["products_catalog", "product_ingredients", "cosing_ingredients"].forEach((t) => {
    const ex = tableExists(t);
    if (ex === null) {
      log("P6", "warn", `DB: ${t}`, "DB not accessible");
    } else if (!ex) {
      log("P6", "missing", `DB: ${t}`);
    } else {
      const n = countRows(t);
      log("P6", n > 0 ? "pass" : "warn", `DB: ${t} rows=${n}`, n > 0 ? "" : "Run ingest scripts");
    }
  });
  const kp = rel("services/kelly-agent-service.js");
  if (fs.existsSync(kp)) {
    const src = fs.readFileSync(kp, "utf8");
    src.includes("resolve_product_ingredients")
      ? log("P6", "pass", "Kelly tool resolve_product_ingredients referenced")
      : log("P6", "missing", "Kelly resolve_product_ingredients");
  }
}

// ─── P7 — De-identified case patterns ────────────────────────────────────────
if (section("P7", "Case patterns store (de-identified)")) {
  const cps = safeRequire("services/case-patterns-service.js");
  if (cps.missing) {
    log("P7", "missing", "services/case-patterns-service.js");
  } else if (!cps.ok) {
    log("P7", "fail", "services/case-patterns-service.js", cps.error);
  } else {
    log("P7", "pass", "services/case-patterns-service.js");
    checkExport(cps.exports, "ingestCasePattern")
      ? log("P7", "pass", "  exports.ingestCasePattern()")
      : log("P7", "fail", "ingestCasePattern missing");
  }
  const ct = tableExists("case_patterns");
  if (ct === null) {
    log("P7", "warn", "DB: case_patterns", "DB not accessible");
  } else {
    ct ? log("P7", "pass", "DB: case_patterns exists") : log("P7", "missing", "DB: case_patterns");
  }
  const on = ["1", "true", "yes"].includes(String(process.env.CASE_DEIDENT_ENABLED || "").toLowerCase().trim());
  on ? log("P7", "warn", "CASE_DEIDENT_ENABLED on", "Ensure privacy review before prod") : log("P7", "pass", "CASE_DEIDENT_ENABLED off (default safe)");
}

// ─── P8 — Care path catalog ──────────────────────────────────────────────────
if (section("P8", "Care Path Catalog (deterministic)")) {
  const cpc = safeRequire("services/care-path-catalog.js");
  if (cpc.missing) {
    log("P8", "missing", "services/care-path-catalog.js");
  } else if (!cpc.ok) {
    log("P8", "fail", "services/care-path-catalog.js", cpc.error);
  } else {
    log("P8", "pass", "services/care-path-catalog.js");
    checkExport(cpc.exports, "resolveCarePath")
      ? log("P8", "pass", "  exports.resolveCarePath()")
      : log("P8", "fail", "resolveCarePath missing");
    if (typeof cpc.exports?.resolveCarePath === "function") {
      try {
        const r = cpc.exports.resolveCarePath({ intent: null, urgency: "urgent", safety_status: "green" });
        r && r.route ? log("P8", "pass", `  resolveCarePath smoke route=${r.route}`) : log("P8", "warn", "unexpected resolveCarePath shape");
      } catch (e) {
        log("P8", "fail", "resolveCarePath threw", e.message);
      }
    }
  }
}

// ─── P9 — Evidence fusion + case summary + billing pack + artifacts ──────────
if (section("P9", "Evidence fusion + case summary + billing readiness")) {
  const ef = safeRequire("services/evidence-fusion.js");
  if (ef.missing) {
    log("P9", "missing", "services/evidence-fusion.js");
  } else if (!ef.ok) {
    log("P9", "fail", "services/evidence-fusion.js", ef.error);
  } else {
    log("P9", "pass", "services/evidence-fusion.js");
    checkExport(ef.exports, "fuseEvidence") ? log("P9", "pass", "  fuseEvidence()") : log("P9", "fail", "fuseEvidence missing");
  }
  const csc = safeRequire("services/case-summary-composer.js");
  if (csc.missing) {
    log("P9", "missing", "services/case-summary-composer.js");
  } else if (!csc.ok) {
    log("P9", "fail", "services/case-summary-composer.js", csc.error);
  } else {
    log("P9", "pass", "services/case-summary-composer.js");
    checkExport(csc.exports, "composeCaseSummary") ? log("P9", "pass", "  composeCaseSummary()") : log("P9", "fail", "composeCaseSummary missing");
  }
  const brp = safeRequire("services/billing-readiness-pack.js");
  if (brp.missing) {
    log("P9", "missing", "services/billing-readiness-pack.js");
  } else if (!brp.ok) {
    log("P9", "fail", "services/billing-readiness-pack.js", brp.error);
  } else {
    log("P9", "pass", "services/billing-readiness-pack.js");
    checkExport(brp.exports, "buildBillingReadinessPack") ? log("P9", "pass", "  buildBillingReadinessPack()") : log("P9", "fail", "buildBillingReadinessPack missing");
  }
  const fat = tableExists("final_assessment_artifacts");
  if (fat === null) {
    log("P9", "warn", "DB: final_assessment_artifacts", "DB not accessible");
  } else {
    fat ? log("P9", "pass", "DB: final_assessment_artifacts exists") : log("P9", "missing", "DB: final_assessment_artifacts");
  }
  const vgp = rel("services/video-consult-graph.js");
  if (fs.existsSync(vgp)) {
    const src = fs.readFileSync(vgp, "utf8");
    ["EvidenceFusion", "CaseSummaryComposer", "BillingReadinessPack", "insertFinalAssessmentArtifact"].forEach((needle) => {
      src.includes(needle)
        ? log("P9", "pass", `video-consult-graph references ${needle}`)
        : log("P9", "warn", `video-consult-graph missing ${needle}`);
    });
  }
}

// ─── P10 — Output governance + shadow adapter flag ───────────────────────────
if (section("P10", "Output guardrails + rollout flags")) {
  const pol = safeRequire("services/clinical-recommendation-policy.js");
  if (pol.missing) {
    log("P10", "missing", "services/clinical-recommendation-policy.js");
  } else if (!pol.ok) {
    log("P10", "fail", "services/clinical-recommendation-policy.js", pol.error);
  } else {
    log("P10", "pass", "clinical-recommendation-policy.js");
    checkExport(pol.exports, "applyOutputGuardrails")
      ? log("P10", "pass", "  applyOutputGuardrails()")
      : log("P10", "fail", "applyOutputGuardrails missing");
  }
  const vas = safeRequire("services/video-consult-assistant-service.js");
  if (vas.ok) {
    checkExport(vas.exports, "mapVisionDetectionsToTags")
      ? log("P10", "pass", "video-consult-assistant-service.mapVisionDetectionsToTags()")
      : log("P10", "warn", "mapVisionDetectionsToTags missing (vision tags)");
    checkExport(vas.exports, "mapYoloToClinical")
      ? log("P10", "warn", "mapYoloToClinical exists", "ICD from vision not expected here")
      : log("P10", "fail", "mapYoloToClinical missing");
  } else {
    log("P10", vas.missing ? "missing" : "fail", "services/video-consult-assistant-service.js", vas.error || "");
  }
  const sp = rel("server.js");
  if (fs.existsSync(sp)) {
    const s = fs.readFileSync(sp, "utf8");
    s.includes("UNIFIED_CHANNEL_ADAPTER_SHADOW_ENABLED")
      ? log("P10", "pass", "server.js: UNIFIED_CHANNEL_ADAPTER_SHADOW_ENABLED")
      : log("P10", "warn", "server.js missing shadow adapter flag");
  }
}

// ─── INFRA ───────────────────────────────────────────────────────────────────
if (!PHASE_FILTER || PHASE_FILTER === "INFRA") {
  console.log(`\n${c.bold}${c.white}── INFRA: Existing infrastructure health${c.reset}`);
  const sse = safeRequire("services/video-consult-sse.js");
  if (sse.ok) {
    ["broadcastTranscriptDelta", "broadcastAssistantUpdate", "broadcastRiskAlert", "broadcastCodesUpdated"].forEach((fn) => {
      checkExport(sse.exports, fn) ? log("INFRA", "pass", `video-consult-sse.${fn}()`) : log("INFRA", "fail", fn, "Missing");
    });
  } else {
    log("INFRA", sse.missing ? "missing" : "fail", "services/video-consult-sse.js", sse.error || "");
  }
  const fhir = safeRequire("services/fhir-service.js");
  if (fhir.ok) {
    ["storeTranscript", "createEncounter", "getOrCreatePatient"].forEach((fn) => {
      checkExport(fhir.exports, fn) ? log("INFRA", "pass", `fhir-service.${fn}()`) : log("INFRA", "fail", fn, "Missing");
    });
  } else {
    log("INFRA", fhir.missing ? "missing" : "fail", "services/fhir-service.js", fhir.error || "");
  }
  const coreTables = [
    "video_consult_sessions",
    "video_consult_transcripts",
    "icd10_codes",
    "cpt_codes",
    "intake_event_stream",
    "session_state_projection",
    "case_patterns",
    "final_assessment_artifacts",
  ];
  coreTables.forEach((t) => {
    const ex = tableExists(t);
    if (ex === null) {
      log("INFRA", "warn", `DB: ${t}`, "Cannot verify");
    } else {
      ex ? log("INFRA", "pass", `DB: ${t} exists`) : log("INFRA", "fail", `DB: ${t}`, "Missing");
    }
  });
}

// ─── FLOW trace (transcript event) ───────────────────────────────────────────
if (!PHASE_FILTER || PHASE_FILTER === "FLOW") {
  console.log(`\n${c.bold}${c.white}── FLOW: Transcript event path (14 steps)${c.reset}`);
  const steps = [
    { label: "01 POST /api/video-consult/agent-events", check: () => fs.existsSync(rel("routes/video-consult.js")) },
    { label: "02 verifyAgentAuth", check: () => fs.readFileSync(rel("routes/video-consult.js"), "utf8").includes("verifyAgentAuth") },
    { label: "03 checkRateLimit", check: () => fs.readFileSync(rel("routes/video-consult.js"), "utf8").includes("checkRateLimit") },
    { label: "04 resolveRoomToEncounter", check: () => safeRequire("services/video-consult-service.js").ok && checkExport(safeRequire("services/video-consult-service.js").exports, "resolveRoomToEncounter") },
    { label: "05 appendLiveTranscript", check: () => safeRequire("services/video-consult-service.js").ok && checkExport(safeRequire("services/video-consult-service.js").exports, "appendLiveTranscript") },
    { label: "06 broadcastTranscriptDelta", check: () => safeRequire("services/video-consult-sse.js").ok && checkExport(safeRequire("services/video-consult-sse.js").exports, "broadcastTranscriptDelta") },
    { label: "07 scheduleRealtimeCodeFetch", check: () => fs.readFileSync(rel("routes/video-consult.js"), "utf8").includes("scheduleRealtimeCodeFetch") },
    { label: "08 symptom / SafetyPreScreen risk path", check: () => fs.readFileSync(rel("routes/video-consult.js"), "utf8").includes("SafetyPreScreen") },
    { label: "09 broadcastRiskAlert", check: () => safeRequire("services/video-consult-sse.js").ok && checkExport(safeRequire("services/video-consult-sse.js").exports, "broadcastRiskAlert") },
    { label: "10 LangGraph processEvent (end_session / graph host)", check: () => safeRequire("services/video-consult-graph.js").ok },
    { label: "11 Channel adapter (optional flag)", check: () => safeRequire("services/channel-adapter.js").ok, expectedMissing: false },
    { label: "12 Intake normalizer", check: () => safeRequire("services/intake-normalizer.js").ok, expectedMissing: false },
    { label: "13 Session state + required-fields gate helpers", check: () => safeRequire("services/session-state-store.js").ok && safeRequire("services/intake-required-fields.js").ok, expectedMissing: false },
    { label: "14 Query planner wired in graph / Kelly", check: () => fs.readFileSync(rel("services/video-consult-graph.js"), "utf8").includes("QueryPlanner"), expectedMissing: false },
  ];
  steps.forEach((step, i) => {
    let ok = false;
    try {
      ok = step.check();
    } catch (_) {}
    if (step.expectedMissing) {
      ok ? log("FLOW", "pass", step.label) : log("FLOW", "missing", step.label);
    } else {
      ok ? log("FLOW", "pass", step.label) : log("FLOW", "fail", step.label);
    }
  });
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(62)}`);
console.log(`${c.bold}${c.white} Summary${c.reset}`);
console.log(`${"─".repeat(62)}`);
const phaseOrder = ["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "INFRA", "FLOW"];
phaseOrder.forEach((ph) => {
  const r = phaseResults[ph];
  if (!r) return;
  const total = r.pass + r.fail + r.missing + r.warn;
  const bar = [
    c.green + "█".repeat(r.pass) + c.reset,
    c.red + "█".repeat(r.fail) + c.reset,
    c.yellow + "░".repeat(r.missing) + c.reset,
    c.yellow + "▒".repeat(r.warn) + c.reset,
  ].join("");
  const pct = total ? Math.round((r.pass / total) * 100) : 0;
  console.log(
    `  ${ph.padEnd(6)} ${bar.padEnd(50)}  ${c.green}${r.pass}✔${c.reset} ${c.red}${r.fail}✘${c.reset} ${c.yellow}${r.missing}◌${c.reset} ${c.yellow}${r.warn}⚠${c.reset}  ${pct < 100 ? c.yellow : c.green}${pct}%${c.reset}`
  );
});
console.log(`${"─".repeat(62)}`);
console.log(
  `  Total  ${c.green}${results.pass} passed${c.reset}  ${c.red}${results.fail} failed${c.reset}  ${c.yellow}${results.missing} missing${c.reset}  ${c.yellow}${results.warn} warnings${c.reset}`
);
console.log(`${"─".repeat(62)}`);
if (results.fail > 0) {
  console.log(`\n${c.red}${c.bold}Regressions: ${results.fail} failed checks.${c.reset}\n`);
} else if (results.missing > 0) {
  console.log(`\n${c.cyan}No regressions; some items still missing (expected during rollout).${c.reset}\n`);
} else {
  console.log(`\n${c.green}${c.bold}All checks green.${c.reset}\n`);
}
process.exit(results.fail > 0 ? 1 : 0);
