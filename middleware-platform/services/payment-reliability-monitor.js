'use strict';

const db = require('../database');
const Metrics = require('./metrics');

function toIso(d) {
  return new Date(d).toISOString();
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

function minutesAgo(m) {
  return new Date(Date.now() - m * 60 * 1000);
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function getEnvInt(name, fallback) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) ? v : fallback;
}

function getEnvFloat(name, fallback) {
  const v = parseFloat(process.env[name] || '');
  return Number.isFinite(v) ? v : fallback;
}

function getOpsCounterSum(name, sinceHours = 1) {
  const rows = db.getOpsCounters ? db.getOpsCounters(sinceHours) : [];
  return rows
    .filter((r) => r && r.name === name)
    .reduce((sum, r) => sum + safeNum(r.count), 0);
}

function countStripeWebhookFailures({ sinceMinutes = 60 } = {}) {
  const since = toIso(minutesAgo(sinceMinutes));
  try {
    const row = db.db
      .prepare(
        `
        SELECT COUNT(1) AS n
        FROM stripe_webhook_events
        WHERE status = 'failed' AND processed_at >= ?
      `
      )
      .get(since);
    return safeNum(row?.n);
  } catch (_) {
    return 0;
  }
}

function countOpenReconSlaBreaches() {
  const now = toIso(new Date());
  try {
    const row = db.db
      .prepare(
        `
        SELECT COUNT(1) AS n
        FROM reconciliation_exceptions
        WHERE status = 'open'
          AND sla_due_at IS NOT NULL
          AND trim(sla_due_at) != ''
          AND datetime(sla_due_at) < datetime(?)
      `
      )
      .get(now);
    return safeNum(row?.n);
  } catch (_) {
    return 0;
  }
}

function getSloTargets() {
  return {
    payments_api_success_rate_30d: getEnvFloat('PAYMENTS_API_SLO_SUCCESS_RATE_30D', 0.995),
    stripe_webhook_processing_success_30d: getEnvFloat('STRIPE_WEBHOOK_SLO_SUCCESS_30D', 0.999),
    reconciliation_job_completion_hours: getEnvFloat('RECONCILIATION_SLO_COMPLETION_HOURS', 6)
  };
}

function evaluateSliSnapshot() {
  // Lightweight: use counters + recent failure tables (not full 30d math yet).
  const sinceHours = getEnvFloat('PAYMENT_SLI_WINDOW_HOURS', 1);

  const failedCheckout = getOpsCounterSum('payment_checkout_failed', sinceHours);
  const erroredCheckout = getOpsCounterSum('payment_checkout_error', sinceHours);
  const failedProcess = getOpsCounterSum('payment_process_failed', sinceHours);

  // PaymentProcessorService in-memory Metrics counters are process-local; include but don't rely on them.
  const mem = Metrics.getAll ? Metrics.getAll() : {};
  const memSuccess = safeNum(mem.payments_success_total);
  const memRecordErr = safeNum(mem.payments_record_error_total);
  const memLedgerErr = safeNum(mem.payments_ledger_error_total);

  return {
    window_hours: sinceHours,
    payment_ops_counters: {
      payment_checkout_failed: failedCheckout,
      payment_checkout_error: erroredCheckout,
      payment_process_failed: failedProcess
    },
    stripe_webhook_failures_last_hour: countStripeWebhookFailures({ sinceMinutes: 60 }),
    open_reconciliation_sla_breaches: countOpenReconSlaBreaches(),
    in_memory_metrics: {
      payments_success_total: memSuccess,
      payments_record_error_total: memRecordErr,
      payments_ledger_error_total: memLedgerErr
    }
  };
}

function computeAlerts() {
  const webhookFailThreshold = getEnvInt('ALERT_STRIPE_WEBHOOK_FAILURES_PER_HOUR', 5);
  const paymentFailThreshold = getEnvInt('ALERT_PAYMENT_PROCESS_FAILED_PER_HOUR', 10);
  const reconBreachThreshold = getEnvInt('ALERT_RECON_SLA_BREACHES', 1);

  const stripeWebhookFailures = countStripeWebhookFailures({ sinceMinutes: 60 });
  const paymentProcessFailed = getOpsCounterSum('payment_process_failed', 1);
  const reconBreaches = countOpenReconSlaBreaches();

  const alerts = [];

  if (stripeWebhookFailures >= webhookFailThreshold) {
    alerts.push({
      key: 'stripe_webhook_failures',
      severity: stripeWebhookFailures >= webhookFailThreshold * 2 ? 'critical' : 'high',
      message: `Stripe webhook failures last hour: ${stripeWebhookFailures}`,
      value: stripeWebhookFailures,
      threshold: webhookFailThreshold
    });
  }

  if (paymentProcessFailed >= paymentFailThreshold) {
    alerts.push({
      key: 'payment_process_failed_spike',
      severity: paymentProcessFailed >= paymentFailThreshold * 2 ? 'critical' : 'high',
      message: `payment_process_failed last hour: ${paymentProcessFailed}`,
      value: paymentProcessFailed,
      threshold: paymentFailThreshold
    });
  }

  if (reconBreaches >= reconBreachThreshold) {
    alerts.push({
      key: 'reconciliation_sla_breaches',
      severity: reconBreaches >= Math.max(3, reconBreachThreshold) ? 'critical' : 'high',
      message: `Open reconciliation exceptions past SLA: ${reconBreaches}`,
      value: reconBreaches,
      threshold: reconBreachThreshold
    });
  }

  return {
    generated_at: toIso(new Date()),
    slo_targets: getSloTargets(),
    sli_snapshot: evaluateSliSnapshot(),
    alerts
  };
}

module.exports = {
  computeAlerts,
  evaluateSliSnapshot,
  getSloTargets,
  countStripeWebhookFailures,
  countOpenReconSlaBreaches
};

