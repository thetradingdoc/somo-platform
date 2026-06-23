#!/usr/bin/env node
'use strict';

/**
 * Identify telehealth claims missing billing envelope; resubmit with POS 02 + 95/GT.
 *
 * Usage:
 *   node scripts/resubmit-telehealth-claims.cjs [--dry-run]   # default
 *   node scripts/resubmit-telehealth-claims.cjs --execute [--limit 20] [--since 2025-01-01]
 */

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const InsuranceService = require('../services/rcm/insurance-service');
const billingEnvelope = require('../services/rcm/billing-claim-envelope-service');

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function alreadyCorrected(responseData) {
  if (!responseData) return false;
  try {
    const o = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
    return Boolean(o?.corrected_resubmit?.at);
  } catch (_) {
    return false;
  }
}

function listCandidates({ since, limit, statuses }) {
  const sqlite = db.db;
  const statusList = statuses.map(() => '?').join(',');
  const params = [...statuses];
  let sql = `
    SELECT ic.*, a.visit_mode, a.place_of_service, a.cpt_modifiers, a.primary_icd10, a.primary_cpt,
           a.patient_name, a.date AS appointment_date
    FROM insurance_claims ic
    JOIN appointments a ON a.id = ic.appointment_id
    WHERE a.visit_mode IN ('sync_video', 'async_review')
      AND ic.status IN (${statusList})
  `;
  if (since) {
    sql += ` AND datetime(ic.submitted_at) >= datetime(?)`;
    params.push(since);
  }
  sql += ` ORDER BY ic.submitted_at ASC LIMIT ?`;
  params.push(limit);
  return sqlite.prepare(sql).all(...params);
}

async function resubmitOne(row, execute) {
  const placeOfService = billingEnvelope.resolvePlaceOfService({
    visit_mode: row.visit_mode,
    place_of_service: row.place_of_service
  });
  const modifiers = billingEnvelope.resolveTelehealthModifiers({
    visit_mode: row.visit_mode,
    place_of_service: placeOfService,
    payer_id: row.payer_id,
    existing_modifiers: billingEnvelope.parseCptModifiersJson(row.cpt_modifiers)
  });

  const payload = {
    appointmentId: row.appointment_id,
    patientId: row.patient_id,
    patientName: row.patient_name || 'Patient',
    memberId: row.member_id,
    payerId: row.payer_id,
    serviceCode: row.service_code || row.primary_cpt,
    diagnosisCode: row.diagnosis_code || row.primary_icd10,
    placeOfService,
    visit_mode: row.visit_mode,
    modifiers,
    totalAmount: row.total_amount,
    copayPaid: row.copay_amount || 0,
    dateOfService: row.appointment_date,
    npi: row.provider_npi || null,
    idempotency_key: `${row.id}_corr_${Date.now()}`
  };

  if (!execute) {
    return { dryRun: true, payload };
  }

  const result = await InsuranceService.submitClaim(payload);
  if (result.success) {
    let prev = {};
    try {
      prev = row.response_data ? JSON.parse(row.response_data) : {};
    } catch (_) {}
    prev.corrected_resubmit = {
      at: new Date().toISOString(),
      prior_claim_id: row.id,
      new_claim_id: result.claimId,
      place_of_service: placeOfService,
      modifiers
    };
    db.updateInsuranceClaim(row.id, { response_data: JSON.stringify(prev) });
  }
  return { dryRun: false, result, payload };
}

async function main() {
  const execute = hasFlag('execute');
  const limit = parseInt(getArg('limit', '50'), 10) || 50;
  const since = getArg('since', null);
  const statuses = (getArg('status', 'submitted,denied,rejected') || 'submitted,denied,rejected')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const rows = listCandidates({ since, limit: limit * 3, statuses });
  const targets = rows.filter((r) => !alreadyCorrected(r.response_data)).slice(0, limit);

  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'dry-run',
    candidates: targets.length,
    stedi_mode: InsuranceService.getStediClaimSubmissionMode()
  }, null, 2));

  let ok = 0;
  let fail = 0;
  for (const row of targets) {
    try {
      const out = await resubmitOne(row, execute);
      if (execute) {
        if (out.result?.success) {
          ok++;
          console.log(`✅ ${row.id} → ${out.result.claimId} POS=${out.payload.placeOfService} mods=${out.payload.modifiers.join(',')}`);
        } else {
          fail++;
          console.log(`❌ ${row.id} → ${out.result?.error || 'failed'}`);
        }
      } else {
        console.log(`[dry-run] ${row.id} POS=${out.payload.placeOfService} mods=${out.payload.modifiers.join(',')} CPT=${out.payload.serviceCode}`);
      }
    } catch (e) {
      fail++;
      console.warn(`❌ ${row.id}:`, e.message);
    }
  }

  console.log(JSON.stringify({ submitted: ok, failed: fail, dry_run: !execute }, null, 2));
  if (!execute && targets.length > 0) {
    console.log('Re-run with --execute to submit corrected claims.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
