#!/usr/bin/env node
'use strict';

/**
 * Front-desk pilot ops snapshot — Stedi, Stripe, voice Kelly flags, PMS sync.
 * Usage: node scripts/report-front-desk-ops.cjs [--json]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const jsonOut = process.argv.includes('--json');

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function envSnapshot(keys) {
  const out = {};
  for (const k of keys) {
    if (k.includes('KEY') || k.includes('SECRET') || k.includes('TOKEN') || k.includes('WEBHOOK')) {
      out[k] = process.env[k] ? '(set)' : '(unset)';
    } else {
      out[k] = process.env[k] ?? '(unset)';
    }
  }
  return out;
}

function countVoiceCalls24h(dbModule) {
  if (!dbModule?.db) return null;
  try {
    const row = dbModule.db
      .prepare(
        `
        SELECT COUNT(*) AS n FROM voice_call_log
        WHERE datetime(created_at) >= datetime('now', '-24 hours')
      `
      )
      .get();
    return Number(row?.n || 0);
  } catch (_) {
    return null;
  }
}

function countPmsSyncPending(dbModule) {
  if (!dbModule?.db) return null;
  try {
    const row = dbModule.db
      .prepare(
        `
        SELECT COUNT(*) AS n FROM appointments
        WHERE pms_sync_status IN ('pending', 'failed', 'retry')
      `
      )
      .get();
    return Number(row?.n || 0);
  } catch (_) {
    return null;
  }
}

function main() {
  const report = {
    generated_at: new Date().toISOString(),
    alerts: [],
    sections: {}
  };

  try {
    const { getStediCircuitStatus } = require('../services/stedi-circuit-breaker');
    const stedi = getStediCircuitStatus();
    report.sections.stedi = {
      circuit_open: stedi.open,
      failures_in_window: stedi.failures_in_window,
      open_until: stedi.open_until,
      api_key_configured: Boolean((process.env.STEDI_API_KEY || '').trim()),
      simulate: process.env.VOICE_ELIGIBILITY_SIMULATE || '(unset)'
    };
    if (stedi.open) {
      report.alerts.push({ severity: 'critical', code: 'STEDI_CIRCUIT_OPEN', message: 'Stedi circuit breaker open' });
    }
  } catch (e) {
    report.sections.stedi = { error: e.message };
  }

  try {
    const PaymentReliabilityMonitor = require('../services/payment-reliability-monitor');
    const payment = PaymentReliabilityMonitor.computeAlerts();
    report.sections.stripe = {
      slo: PaymentReliabilityMonitor.getSloTargets(),
      alerts: payment.alerts || [],
      alert_count: (payment.alerts || []).length
    };
    for (const a of payment.alerts || []) {
      report.alerts.push({ severity: a.severity || 'warn', code: a.code || 'PAYMENT', message: a.message || a.title });
    }
  } catch (e) {
    report.sections.stripe = { error: e.message };
  }

  report.sections.voice = {
    kelly: envSnapshot([
      'KELLY_RAILS_V2',
      'KELLY_RAILS_ROLLOUT_PCT',
      'KELLY_ALLOW_HYBRID_GRAPH',
      'CONVERSATION_MODE_ROUTING',
      'OPQRST_FIELD_GATE_ENABLED'
    ]),
    webhooks: envSnapshot(['ELIGIBILITY_ALERT_SLACK_WEBHOOK', 'PAYMENT_ALERT_SLACK_WEBHOOK'])
  };

  if (!process.env.ELIGIBILITY_ALERT_SLACK_WEBHOOK) {
    report.alerts.push({
      severity: 'info',
      code: 'ELIGIBILITY_WEBHOOK_UNSET',
      message: 'ELIGIBILITY_ALERT_SLACK_WEBHOOK not configured'
    });
  }
  if (!process.env.PAYMENT_ALERT_SLACK_WEBHOOK) {
    report.alerts.push({
      severity: 'info',
      code: 'PAYMENT_WEBHOOK_UNSET',
      message: 'PAYMENT_ALERT_SLACK_WEBHOOK not configured'
    });
  }

  if (!truthy(process.env.KELLY_RAILS_V2)) {
    report.alerts.push({ severity: 'critical', code: 'KELLY_RAILS_OFF', message: 'KELLY_RAILS_V2 is not enabled' });
  }

  try {
    const db = require('../database');
    report.sections.pms = {
      sync_pending_appointments: countPmsSyncPending(db),
      voice_calls_24h: countVoiceCalls24h(db)
    };
    const pending = report.sections.pms.sync_pending_appointments;
    if (pending != null && pending > 20) {
      report.alerts.push({
        severity: 'warn',
        code: 'PMS_SYNC_BACKLOG',
        message: `${pending} appointments with pending/failed PMS sync`
      });
    }
  } catch (e) {
    report.sections.pms = { error: e.message };
  }

  report.summary = {
    alert_count: report.alerts.length,
    critical: report.alerts.filter((a) => a.severity === 'critical').length,
    pilot_ready: report.alerts.filter((a) => a.severity === 'critical').length === 0
  };

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n=== Front desk ops snapshot ===\n');
    console.log(`Generated: ${report.generated_at}`);
    console.log(`Pilot ready: ${report.summary.pilot_ready ? 'yes' : 'NO'}`);
    console.log(`Alerts: ${report.summary.alert_count} (${report.summary.critical} critical)\n`);
    for (const a of report.alerts) {
      console.log(`  [${a.severity}] ${a.code}: ${a.message}`);
    }
    console.log('\n--- Stedi ---');
    console.log(JSON.stringify(report.sections.stedi, null, 2));
    console.log('\n--- Voice Kelly ---');
    console.log(JSON.stringify(report.sections.voice, null, 2));
    console.log('\n--- PMS / calls ---');
    console.log(JSON.stringify(report.sections.pms, null, 2));
  }

  process.exit(report.summary.critical > 0 ? 1 : 0);
}

main();
