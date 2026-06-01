#!/usr/bin/env node
'use strict';

/**
 * F1b — Isolated booking E2E from seedBookingReady fixture.
 * Depends S0-3 + S0-3a. Runs with KELLY_E2E_SKIP_TRIAGE=1.
 *
 * Usage:
 *   RCM_E2E_USE_EXISTING_SERVER=1 KELLY_E2E_SKIP_TRIAGE=1 npm run test:e2e:kelly:booking-fixture
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const MP = path.join(__dirname, '..');
process.chdir(MP);
process.env.DB_PATH = process.env.DB_PATH || path.join(MP, 'middleware-dev.db');
process.env.KELLY_E2E_SKIP_TRIAGE = process.env.KELLY_E2E_SKIP_TRIAGE || '1';

const API_BASE = (process.env.BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const CLINIC_ID = process.env.TEST_CLINIC_ID || 'clinic-default';
const PATIENT_PHONE = process.env.TEST_PATIENT_PHONE || '+15550009991';

const fixtures = require('../e2e/helpers/kelly-conversation-fixtures.cjs');

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m', cyan: '\x1b[36m' };
const green = (s) => `${C.green}${s}${C.reset}`;
const red = (s) => `${C.red}${s}${C.reset}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;

function apiHealth() {
  const url = new URL(`${API_BASE}/health`);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, (res) => resolve(res.statusCode)).on('error', reject);
  });
}

function toolsInclude(toolsUsed, pattern) {
  return (Array.isArray(toolsUsed) ? toolsUsed : []).some((n) => pattern.test(String(n || '')));
}

async function kellyTurn(ctx, userMsg) {
  const result = await ctx.KellyAgent.processTurn({
    sessionId: ctx.sessionId,
    clinicId: ctx.clinicId,
    patientId: ctx.patientId,
    patientName: ctx.patientName,
    callerPhone: ctx.patientPhone,
    channel: 'voice',
    message: userMsg,
  });
  return {
    reply: result?.reply || '',
    toolsUsed: Array.isArray(result?.toolsUsed) ? result.toolsUsed : [],
    result,
  };
}

async function main() {
  console.log(bold('\n═ Kelly F1b — Booking fixture E2E ═\n'));

  if (!process.env.RCM_E2E_USE_EXISTING_SERVER) {
    console.error(red('Set RCM_E2E_USE_EXISTING_SERVER=1'));
    process.exit(1);
  }
  if (!(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY)) {
    console.error(red('No LLM API key'));
    process.exit(1);
  }

  const health = await apiHealth();
  if (health !== 200) {
    console.error(red(`Middleware not healthy at ${API_BASE}`));
    process.exit(1);
  }

  const dbModule = fixtures.loadDb().dbModule;
  let patient = dbModule.getFHIRPatientByPhone?.(PATIENT_PHONE);
  if (!patient) {
    const resourceId = `Patient/e2e-book-${crypto.randomBytes(4).toString('hex')}`;
    dbModule.createFHIRPatient({
      resourceType: 'Patient',
      id: resourceId,
      name: [{ given: ['E2E'], family: 'BookingFixture' }],
      telecom: [
        { system: 'phone', value: PATIENT_PHONE },
        { system: 'email', value: 'e2e-booking-fixture@somo.test' },
      ],
    });
    patient = dbModule.getFHIRPatient(resourceId);
  }

  const sessionId = fixtures.newE2eSessionId('e2e_book');
  const patientName = 'E2E BookingFixture';
  const ctx = {
    sessionId,
    clinicId: CLINIC_ID,
    patientId: patient.resource_id,
    patientName,
    patientPhone: PATIENT_PHONE,
    KellyAgent: require('../services/kelly-agent-service'),
  };

  console.log(`${C.cyan}▶ S0-3 seedBookingReady${C.reset}`);
  fixtures.seedBookingReady(sessionId, ctx.patientId, CLINIC_ID, {
    patientName: ctx.patientName,
    patientEmail: 'e2e-booking-fixture@somo.test',
    patientPhone: PATIENT_PHONE,
  });
  fixtures.getKellyToolExecutor()._setSessionMeta(sessionId, 'kelly_e2e_skip_triage', '1');

  const preflight = fixtures.verifyBookingFixtureGates(sessionId);
  if (!preflight.ok) {
    console.error(red(`FIXTURE_GAP: ${preflight.errors.join('; ')}`));
    process.exit(1);
  }
  console.log(green('✓ S0-3a preflight passed'));

  fixtures.assertKellyState(sessionId, { phase: 'BOOKING', triage_complete: true, hasRag: true });

  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });

  console.log(`${C.cyan}▶ Turn 3 — request slots${C.reset}`);
  const t3 = await kellyTurn(ctx, 'Can you check the soonest dermatology appointment available this week?');
  fixtures.assertKellyState(sessionId, { phase: 'BOOKING' });
  if (!toolsInclude(t3.toolsUsed, /get_available_slots/i)) {
    console.error(red(`Expected get_available_slots. tools=[${t3.toolsUsed.join(',')}] reply="${t3.reply.slice(0, 100)}"`));
    process.exit(1);
  }
  console.log(green('✓ get_available_slots called'));

  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });

  console.log(`${C.cyan}▶ Turn 4 — confirm booking${C.reset}`);
  const t4 = await kellyTurn(
    ctx,
    'The first available slot works. Please book it. My name is E2E BookingFixture, email is e2e-booking-fixture@somo.test and phone is +15550009991.'
  );
  fixtures.assertKellyState(sessionId, { phase: 'BOOKING' });
  const booked =
    toolsInclude(t4.toolsUsed, /schedule_appointment/i) ||
    !!dbModule.db
      ?.prepare(`SELECT id FROM appointments WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`)
      ?.get(ctx.patientId);
  if (!booked) {
    console.error(red(`Expected schedule_appointment. tools=[${t4.toolsUsed.join(',')}] reply="${t4.reply.slice(0, 100)}"`));
    process.exit(1);
  }
  console.log(green('✓ booking confirmed'));

  fixtures.teardownKellySession(sessionId);
  console.log(green('\nF1b PASS\n'));
  process.exit(0);
}

main().catch((e) => {
  console.error(red(e.message));
  process.exit(1);
});
