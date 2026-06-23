#!/usr/bin/env node
'use strict';

/**
 * Compare funnel match vs classifyDermPatientQA on gap_results raw queries.
 * Optional: Kelly processTurn on KELLY_SAMPLE_N rows when LLM keys present.
 *
 *   GAP_JSON="/path/to/gap_results_raw (3).json" npm run sandbox:funnel-kelly-gap
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);

const GAP_JSON =
  process.env.GAP_JSON ||
  path.join(process.env.HOME || '', 'Downloads/gap_results_raw (3).json');
const SAMPLE_N = parseInt(process.env.GAP_SAMPLE_N || '120', 10);
const KELLY_SAMPLE_N = parseInt(process.env.KELLY_SAMPLE_N || '20', 10);

const { match } = require('../services/catalog/funnel-match-service');
const { classifyDermPatientQA } = require('../services/shared/derm-patient-qa-triage');

function loadGapRows() {
  if (!fs.existsSync(GAP_JSON)) {
    console.error(`GAP_JSON not found: ${GAP_JSON}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(GAP_JSON, 'utf8'));
  const raw = data.filter((r) => r.variant === 'raw' && String(r.query || '').trim().length > 5);
  return raw;
}

function stratifiedSample(rows, n) {
  const routine = [];
  const safety = [];
  const other = [];
  for (const r of rows) {
    const q = String(r.query || '').toLowerCase();
    if (/melanoma|what is|is this|genital|infant|wart|diagnos/.test(q)) safety.push(r);
    else if (/acne|rosacea|tret|retinoid|barrier|rash|dark spot|purging/.test(q)) routine.push(r);
    else other.push(r);
  }
  const per = Math.floor(n / 3);
  const pick = (arr, count) => arr.slice(0, count);
  return [
    ...pick(routine, per),
    ...pick(safety, per),
    ...pick(other, n - 2 * per),
  ].slice(0, n);
}

function hasLlmEnv() {
  return !!(process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

async function maybeKellyTurn(message, sessionId, clinicId) {
  const KellyAgentService = require('../services/kelly/kelly-agent-service');
  const started = Date.now();
  const result = await KellyAgentService.processTurn({
    message,
    sessionId,
    channel: 'chat',
    clinicId,
    patientId: null,
  });
  return {
    ms: Date.now() - started,
    toolsUsed: result.toolsUsed || [],
    reply_preview: String(result.reply || '').slice(0, 400),
  };
}

async function main() {
  const rows = stratifiedSample(loadGapRows(), SAMPLE_N);
  const report = {
    gap_json: GAP_JSON,
    sample_n: rows.length,
    kelly_sample_n: 0,
    agreement: { urgent_to_specialist: 0, urgent_total: 0, routine_to_program: 0, routine_total: 0 },
    rows: [],
    mismatches: [],
  };

  let kellyCount = 0;
  const clinicId = process.env.CLINIC_ID || process.env.DEFAULT_CLINIC_ID || 'clinic-default';
  const kellySessionId = `sandbox_gap_${Date.now()}`;
  const runKelly = hasLlmEnv() && process.env.SKIP_KELLY !== '1';

  for (let i = 0; i < rows.length; i++) {
    const q = String(rows[i].query || '').trim();
    const funnel = match({ inquiry: q, user_goal: 'track_program' });
    const derm = classifyDermPatientQA({ message: q });

    const row = {
      query: q.slice(0, 120),
      funnel_route: funnel.route,
      funnel_concern_id: funnel.concern_id,
      funnel_layer: funnel.layer,
      derm_intent: derm.intent,
      derm_needs_clarification: derm.needs_clarification,
      derm_urgency: derm.systemic_assessment?.urgency,
    };

    if (derm.intent === 'urgent' || derm.systemic_assessment?.is_emergency) {
      report.agreement.urgent_total += 1;
      if (funnel.route === 'specialist') report.agreement.urgent_to_specialist += 1;
    }
    if (derm.intent === 'routine') {
      report.agreement.routine_total += 1;
      if (funnel.route === 'program') report.agreement.routine_to_program += 1;
    }

    if (
      (derm.intent === 'urgent' && funnel.route !== 'specialist') ||
      (derm.intent === 'routine' && funnel.route === 'specialist' && funnel.layer !== 'L0')
    ) {
      report.mismatches.push(row);
    }

    if (runKelly && kellyCount < KELLY_SAMPLE_N && /acne|tret|rosacea|barrier|purging/i.test(q)) {
      try {
        row.kelly = await maybeKellyTurn(q, `${kellySessionId}_${i}`, clinicId);
        kellyCount += 1;
      } catch (e) {
        row.kelly = { error: e.message };
      }
    }

    report.rows.push(row);
  }

  report.kelly_sample_n = kellyCount;
  report.mismatches = report.mismatches.slice(0, 20);

  const outDir = path.join(root, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'funnel-kelly-gap-compare.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('Funnel vs derm triage gap compare');
  console.log(`  samples: ${report.sample_n}`);
  console.log(
    `  urgent→specialist: ${report.agreement.urgent_to_specialist}/${report.agreement.urgent_total}`,
  );
  console.log(
    `  routine→program: ${report.agreement.routine_to_program}/${report.agreement.routine_total}`,
  );
  console.log(`  mismatches (top): ${report.mismatches.length}`);
  console.log(`  report: ${outPath}`);
  if (!runKelly) console.log('  Kelly: skipped (no API keys or SKIP_KELLY=1)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
