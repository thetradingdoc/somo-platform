const crypto = require('crypto');
const db = require('../database');

const DEFAULT_OWNER = process.env.RECON_EXCEPTION_DEFAULT_OWNER || 'finance-oncall';
const SLA_HOURS_BY_SEVERITY = {
  low: parseInt(process.env.RECON_SLA_HOURS_LOW || '72', 10) || 72,
  medium: parseInt(process.env.RECON_SLA_HOURS_MEDIUM || '24', 10) || 24,
  high: parseInt(process.env.RECON_SLA_HOURS_HIGH || '8', 10) || 8,
  critical: parseInt(process.env.RECON_SLA_HOURS_CRITICAL || '2', 10) || 2
};

function toIsoDay(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function withSortedKeys(obj) {
  if (Array.isArray(obj)) return obj.map(withSortedKeys);
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  Object.keys(obj)
    .sort()
    .forEach((k) => {
      out[k] = withSortedKeys(obj[k]);
    });
  return out;
}

function normalizeStatus(s) {
  return String(s || '').trim().toLowerCase() || 'unknown';
}

function normalizeCurrency(c) {
  return String(c || 'USD').trim().toUpperCase();
}

function parseJson(raw, fallback = {}) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function buildException(eventKey, internalRow, providerRow, processorRow) {
  const internalAmount = Number(internalRow?.amount || 0);
  const providerAmount = providerRow ? Number(providerRow.amount || 0) : null;
  const processorAmount = processorRow ? Number(processorRow.amount || 0) : null;

  if (!internalRow && providerRow && processorRow) {
    return {
      event_key: eventKey,
      classification: 'missing_internal',
      severity: 'high',
      internal_amount: null,
      provider_amount: providerAmount,
      processor_amount: processorAmount,
      delta: providerAmount - processorAmount
    };
  }
  if (internalRow && !providerRow) {
    return {
      event_key: eventKey,
      classification: 'missing_provider',
      severity: 'medium',
      internal_amount: internalAmount,
      provider_amount: null,
      processor_amount: processorAmount,
      delta: internalAmount - Number(processorAmount || 0)
    };
  }
  if (internalRow && !processorRow) {
    return {
      event_key: eventKey,
      classification: 'missing_processor',
      severity: 'high',
      internal_amount: internalAmount,
      provider_amount: providerAmount,
      processor_amount: null,
      delta: internalAmount - Number(providerAmount || 0)
    };
  }
  if (internalRow && providerRow && processorRow) {
    const currencies = new Set([
      normalizeCurrency(internalRow.currency),
      normalizeCurrency(providerRow.currency),
      normalizeCurrency(processorRow.currency)
    ]);
    if (currencies.size > 1) {
      return {
        event_key: eventKey,
        classification: 'currency_mismatch',
        severity: 'critical',
        internal_amount: internalAmount,
        provider_amount: providerAmount,
        processor_amount: processorAmount,
        delta: 0
      };
    }
    const maxAmount = Math.max(Math.abs(internalAmount), Math.abs(providerAmount), Math.abs(processorAmount), 1);
    const spread = Math.max(internalAmount, providerAmount, processorAmount) - Math.min(internalAmount, providerAmount, processorAmount);
    const pct = spread / maxAmount;
    if (spread > 0.01) {
      return {
        event_key: eventKey,
        classification: 'amount_mismatch',
        severity: pct >= 0.05 ? 'critical' : pct >= 0.02 ? 'high' : 'medium',
        internal_amount: internalAmount,
        provider_amount: providerAmount,
        processor_amount: processorAmount,
        delta: spread
      };
    }
    const statuses = new Set([
      normalizeStatus(internalRow.status),
      normalizeStatus(providerRow.status),
      normalizeStatus(processorRow.status)
    ]);
    if (statuses.size > 1) {
      return {
        event_key: eventKey,
        classification: 'status_mismatch',
        severity: 'medium',
        internal_amount: internalAmount,
        provider_amount: providerAmount,
        processor_amount: processorAmount,
        delta: 0
      };
    }
  }
  return null;
}

function resolveSlaDueAt(severity, now = Date.now()) {
  const hours = SLA_HOURS_BY_SEVERITY[severity] || SLA_HOURS_BY_SEVERITY.medium;
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
}

function queryMaps(windowStart, windowEnd) {
  const internalRows = db.db
    .prepare(`
      SELECT event_key, SUM(amount) AS amount, currency, status
      FROM ledger_events_canonical
      WHERE source_system = 'internal'
        AND occurred_at >= ?
        AND occurred_at < ?
      GROUP BY event_key, currency, status
    `)
    .all(windowStart, windowEnd);
  const providerRows = db.db
    .prepare(`
      SELECT event_key, amount, currency, status, provider_report_id
      FROM provider_reconciliation_rows
      WHERE COALESCE(settled_at, created_at) >= ?
        AND COALESCE(settled_at, created_at) < ?
    `)
    .all(windowStart, windowEnd);
  const processorRows = db.db
    .prepare(`
      SELECT event_key, amount, currency, status, processor_name
      FROM processor_reconciliation_rows
      WHERE COALESCE(settled_at, created_at) >= ?
        AND COALESCE(settled_at, created_at) < ?
    `)
    .all(windowStart, windowEnd);

  const mapByKey = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (!row || !row.event_key) continue;
      if (!map.has(row.event_key)) {
        map.set(row.event_key, { ...row });
      } else {
        const prev = map.get(row.event_key);
        map.set(row.event_key, {
          ...prev,
          amount: Number(prev.amount || 0) + Number(row.amount || 0)
        });
      }
    }
    return map;
  };
  return {
    internal: mapByKey(internalRows),
    provider: mapByKey(providerRows),
    processor: mapByKey(processorRows)
  };
}

function webhookIngestionEnabled() {
  return process.env.FINANCIAL_INTEGRITY_WEBHOOK_INGESTION !== '0';
}

class FinancialIntegrityService {
  /**
   * Stripe PaymentIntent → internal canonical capture + processor row (same event_key).
   * Call from POST /webhooks/stripe after signature verification so reconciliation has non-zero processor rows.
   */
  static recordStripePaymentIntentReconciliation(paymentIntent) {
    if (!webhookIngestionEnabled() || !paymentIntent || !paymentIntent.id) return null;
    const eventKey = `stripe:pi:${paymentIntent.id}`;
    const amountCents = Number(paymentIntent.amount || 0);
    const amount = Math.round(amountCents) / 100;
    const currency = normalizeCurrency((paymentIntent.currency || 'usd').toUpperCase());
    const now = new Date().toISOString();
    const ok = paymentIntent.status === 'succeeded';
    const status = ok ? 'succeeded' : 'failed';

    db.insertCanonicalLedgerEvent({
      event_key: eventKey,
      event_type: 'capture',
      source_system: 'internal',
      amount,
      currency,
      status: ok ? 'settled' : 'failed',
      occurred_at: now,
      external_ref_type: 'stripe_payment_intent',
      external_ref_id: paymentIntent.id,
      metadata: { ingested_via: 'stripe_webhook', payment_intent_status: paymentIntent.status }
    });

    return db.upsertProcessorReconciliationRow({
      processor_name: 'stripe',
      event_key: eventKey,
      amount,
      currency,
      status,
      settled_at: now,
      metadata: {
        ingested_via: 'stripe_webhook',
        stripe_payment_intent_id: paymentIntent.id,
        checkout_id: paymentIntent.metadata?.checkout_id || null,
        commerce_quote_id: paymentIntent.metadata?.commerce_quote_id || null
      }
    });
  }

  /**
   * Stripe Refund → canonical ledger (negative amount) + processor reconciliation row.
   */
  static recordStripeRefundReconciliation({
    refundId,
    paymentIntentId,
    amount,
    checkoutId,
    currency = 'USD'
  }) {
    if (!webhookIngestionEnabled() || !refundId) return null;
    const eventKey = `stripe:refund:${refundId}`;
    const now = new Date().toISOString();
    const amt = -Math.abs(Number(amount || 0));
    const cur = normalizeCurrency(currency);
    db.insertCanonicalLedgerEvent({
      event_key: eventKey,
      event_type: 'refund',
      source_system: 'internal',
      amount: amt,
      currency: cur,
      status: 'posted',
      occurred_at: now,
      external_ref_type: 'stripe_refund',
      external_ref_id: refundId,
      metadata: {
        ingested_via: 'refund_workflow',
        payment_intent_id: paymentIntentId || null,
        checkout_id: checkoutId || null
      }
    });
    return db.upsertProcessorReconciliationRow({
      processor_name: 'stripe',
      event_key: eventKey,
      amount: amt,
      currency: cur,
      status: 'succeeded',
      settled_at: now,
      metadata: {
        stripe_refund_id: refundId,
        payment_intent_id: paymentIntentId || null
      }
    });
  }

  /**
   * Stripe Dispute (chargeback) → canonical + processor rows for reconciliation.
   */
  static recordStripeDisputeReconciliation(dispute) {
    if (!webhookIngestionEnabled() || !dispute || !dispute.id) return null;
    const eventKey = `stripe:dispute:${dispute.id}`;
    const amount = (Number(dispute.amount || 0) || 0) / 100;
    const currency = normalizeCurrency((dispute.currency || 'usd').toUpperCase());
    const now = new Date().toISOString();
    const st = String(dispute.status || '').toLowerCase();
    let internalStatus = 'pending';
    if (st === 'won') internalStatus = 'settled';
    else if (st === 'lost' || st === 'charge_refunded') internalStatus = 'failed';

    db.insertCanonicalLedgerEvent({
      event_key: eventKey,
      event_type: 'dispute',
      source_system: 'internal',
      amount,
      currency,
      status: internalStatus,
      occurred_at: now,
      external_ref_type: 'stripe_dispute',
      external_ref_id: dispute.id,
      metadata: {
        ingested_via: 'stripe_webhook',
        stripe_status: dispute.status,
        charge: dispute.charge || null
      }
    });
    return db.upsertProcessorReconciliationRow({
      processor_name: 'stripe',
      event_key: eventKey,
      amount,
      currency,
      status: dispute.status,
      settled_at: now,
      metadata: { stripe_dispute_id: dispute.id, charge: dispute.charge || null }
    });
  }

  /**
   * Circle transfer completion/failure → internal settlement + processor row.
   */
  static recordCircleTransferReconciliation(transferRow, outcome = 'completed') {
    if (!webhookIngestionEnabled() || !transferRow) return null;
    const circleId = transferRow.circle_transfer_id;
    if (!circleId) return null;
    const eventKey = `circle:transfer:${circleId}`;
    const amount = Number(transferRow.amount || 0);
    const currency = normalizeCurrency(transferRow.currency || 'USDC');
    const now = new Date().toISOString();
    const ok = !/fail/i.test(String(outcome || ''));
    const status = ok ? 'completed' : 'failed';

    db.insertCanonicalLedgerEvent({
      event_key: eventKey,
      event_type: 'settlement',
      source_system: 'internal',
      amount,
      currency,
      status: ok ? 'settled' : 'failed',
      occurred_at: now,
      external_ref_type: 'circle_transfer',
      external_ref_id: String(circleId),
      metadata: {
        ingested_via: 'circle_webhook',
        claim_id: transferRow.claim_id || null,
        local_transfer_id: transferRow.id || null
      }
    });

    return db.upsertProcessorReconciliationRow({
      processor_name: 'circle',
      event_key: eventKey,
      amount,
      currency,
      status,
      settled_at: now,
      metadata: {
        ingested_via: 'circle_webhook',
        circle_transfer_id: String(circleId),
        claim_id: transferRow.claim_id || null
      }
    });
  }

  static recordCanonicalLedgerEvent(event = {}) {
    if (!event.event_key) throw new Error('event_key is required');
    if (!event.event_type) throw new Error('event_type is required');
    if (!event.source_system) throw new Error('source_system is required');
    return db.insertCanonicalLedgerEvent({
      ...event,
      currency: normalizeCurrency(event.currency || 'USD')
    });
  }

  static ingestProviderReconciliationRows(providerReportId, rows = []) {
    if (!providerReportId) throw new Error('providerReportId is required');
    const inserted = [];
    for (const row of rows) {
      if (!row || !row.event_key) continue;
      inserted.push(
        db.upsertProviderReconciliationRow({
          provider_report_id: providerReportId,
          event_key: row.event_key,
          amount: Number(row.amount || 0),
          currency: normalizeCurrency(row.currency),
          status: row.status || null,
          settled_at: row.settled_at || null,
          metadata: row.metadata || {}
        })
      );
    }
    return inserted;
  }

  static ingestProcessorReconciliationRows(processorName, rows = []) {
    if (!processorName) throw new Error('processorName is required');
    const inserted = [];
    for (const row of rows) {
      if (!row || !row.event_key) continue;
      inserted.push(
        db.upsertProcessorReconciliationRow({
          processor_name: processorName,
          event_key: row.event_key,
          amount: Number(row.amount || 0),
          currency: normalizeCurrency(row.currency),
          status: row.status || null,
          settled_at: row.settled_at || null,
          metadata: row.metadata || {}
        })
      );
    }
    return inserted;
  }

  static runDeterministicReconciliation({ windowStart, windowEnd, owner = DEFAULT_OWNER } = {}) {
    const end = windowEnd ? new Date(windowEnd) : new Date();
    const start = windowStart ? new Date(windowStart) : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const keySeed = `deterministic_reconciliation:${startIso}:${endIso}`;
    const deterministicKey = hashJson(keySeed);

    const maps = queryMaps(startIso, endIso);
    const keySet = new Set([...maps.internal.keys(), ...maps.provider.keys(), ...maps.processor.keys()]);
    const sortedKeys = Array.from(keySet).sort();

    const inputSignature = sortedKeys.map((eventKey) => ({
      event_key: eventKey,
      internal: maps.internal.get(eventKey) || null,
      provider: maps.provider.get(eventKey) || null,
      processor: maps.processor.get(eventKey) || null
    }));
    const inputHash = hashJson(withSortedKeys(inputSignature));
    let run = db.createReconciliationJobRun({
      job_name: 'deterministic_reconciliation',
      window_start: startIso,
      window_end: endIso,
      deterministic_key: deterministicKey,
      input_hash: inputHash,
      status: 'running'
    });

    const previousSnapshot = db.getLatestReconciliationSnapshot();
    db.insertReconciliationSnapshot({
      run_id: run.id,
      snapshot_type: 'job_input',
      payload_json: {
        deterministic_key: deterministicKey,
        window_start: startIso,
        window_end: endIso,
        input_signature: inputSignature
      },
      payload_hash: hashJson(withSortedKeys({ deterministicKey, startIso, endIso, inputSignature })),
      previous_hash: previousSnapshot?.payload_hash || null
    });

    const exceptions = [];
    let totalDelta = 0;
    for (const eventKey of sortedKeys) {
      const ex = buildException(eventKey, maps.internal.get(eventKey), maps.provider.get(eventKey), maps.processor.get(eventKey));
      if (!ex) continue;
      totalDelta += Number(ex.delta || 0);
      const slaDueAt = resolveSlaDueAt(ex.severity);
      const inserted = db.upsertReconciliationException({
        ...ex,
        run_id: run.id,
        owner,
        status: 'open',
        sla_due_at: slaDueAt,
        metadata: {
          internal: maps.internal.get(eventKey) || null,
          provider: maps.provider.get(eventKey) || null,
          processor: maps.processor.get(eventKey) || null
        }
      });
      exceptions.push(inserted);
    }

    run = db.updateReconciliationJobRun(run.id, {
      status: 'completed',
      mismatch_count: exceptions.length,
      unresolved_count: exceptions.filter((e) => e.status === 'open').length,
      total_delta: totalDelta,
      completed_at: new Date().toISOString()
    });

    const latestSnapshot = db.getLatestReconciliationSnapshot();
    db.insertReconciliationSnapshot({
      run_id: run.id,
      snapshot_type: 'job_output',
      payload_json: {
        deterministic_key: deterministicKey,
        mismatch_count: exceptions.length,
        unresolved_count: run.unresolved_count,
        total_delta: totalDelta,
        exceptions: exceptions.map((e) => ({
          id: e.id,
          event_key: e.event_key,
          classification: e.classification,
          severity: e.severity,
          delta: e.delta,
          owner: e.owner,
          sla_due_at: e.sla_due_at
        }))
      },
      payload_hash: hashJson(withSortedKeys({ run_id: run.id, exceptions })),
      previous_hash: latestSnapshot?.payload_hash || null
    });

    return { run, exceptions };
  }

  static generateDailyFinancialCloseReport(closeDate = toIsoDay(new Date())) {
    const dayStart = `${closeDate}T00:00:00.000Z`;
    const dayEnd = `${closeDate}T23:59:59.999Z`;
    const totalsRows = db.db
      .prepare(`
        SELECT event_type, status, SUM(amount) AS amount
        FROM ledger_events_canonical
        WHERE occurred_at >= ? AND occurred_at <= ?
        GROUP BY event_type, status
      `)
      .all(dayStart, dayEnd);

    const totals = {
      total_authorizations: 0,
      total_captures: 0,
      total_settlements: 0,
      total_refunds: 0,
      total_disputes: 0,
      pending_amount: 0,
      failed_settlement_amount: 0
    };

    for (const row of totalsRows) {
      const amount = Number(row.amount || 0);
      const type = String(row.event_type || '').toLowerCase();
      const status = normalizeStatus(row.status);
      if (type === 'authorization') totals.total_authorizations += amount;
      if (type === 'capture') totals.total_captures += amount;
      if (type === 'settlement') totals.total_settlements += amount;
      if (type === 'refund') totals.total_refunds += amount;
      if (type === 'dispute') totals.total_disputes += amount;
      if (status === 'pending') totals.pending_amount += amount;
      if (type === 'settlement' && status === 'failed') totals.failed_settlement_amount += amount;
    }

    const unresolved = db
      .listReconciliationExceptions({ status: 'open', limit: 5000 })
      .filter((row) => String(row.created_at || '').startsWith(closeDate));
    const unexplainedDeltaAmount = unresolved.reduce((sum, row) => sum + Number(row.delta || 0), 0);

    const report = db.upsertFinancialCloseReport({
      close_date: closeDate,
      currency: 'USD',
      ...totals,
      unexplained_delta_amount: unexplainedDeltaAmount,
      unexplained_delta_count: unresolved.length,
      metadata: {
        generated_by: 'financial-integrity-service',
        source_rows: totalsRows.length
      }
    });

    const latestSnapshot = db.getLatestReconciliationSnapshot();
    db.insertReconciliationSnapshot({
      snapshot_type: 'daily_close',
      payload_json: {
        close_date: closeDate,
        report,
        unresolved_exception_ids: unresolved.map((r) => r.id)
      },
      payload_hash: hashJson(withSortedKeys({ closeDate, report })),
      previous_hash: latestSnapshot?.payload_hash || null
    });
    return report;
  }

  static listExceptionQueue({ status = 'open', limit = 200 } = {}) {
    const rows = db.listReconciliationExceptions({ status, limit });
    return rows.map((row) => ({
      ...row,
      metadata: parseJson(row.metadata, {})
    }));
  }
}

module.exports = FinancialIntegrityService;
