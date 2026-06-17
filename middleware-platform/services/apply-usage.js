/**
 * Unified voice minute usage — idempotent, pack-only (no negative balance / no metered overage).
 */

const { getTier } = require('./plan-catalog');

function resolveCallId({ callId, callSid }) {
  return callId || callSid || null;
}

/**
 * @param {object} db - database module
 * @param {object} opts
 * @param {string} opts.customerId
 * @param {string} [opts.callId]
 * @param {string} [opts.callSid]
 * @param {number} opts.durationMinutes
 * @param {string} [opts.source] - twilio_status | retell_ws
 */
function applyUsage(db, opts) {
  const customerId = opts.customerId;
  const idKey = resolveCallId(opts);
  const minutesRequested = Math.max(0, Math.ceil(Number(opts.durationMinutes) || 0));
  const source = opts.source || 'unknown';

  if (!customerId) {
    return { success: false, error: 'customerId required' };
  }
  if (!idKey) {
    return { success: false, error: 'callId or callSid required' };
  }
  if (minutesRequested === 0) {
    return { success: true, minutes_applied: 0, skipped: 'zero_duration' };
  }

  const existing = db.getUsageEventByCallId(idKey);
  if (existing) {
    return {
      success: true,
      duplicate: true,
      minutes_applied: existing.minutes_applied
    };
  }

  const customer = db.getCustomer(customerId);
  if (!customer) {
    return { success: false, error: 'customer not found' };
  }

  if (customer.billing_enforcement_paused === 1) {
    db.insertUsageEvent({
      customer_id: customerId,
      call_id: idKey,
      call_sid: opts.callSid || null,
      minutes_requested: minutesRequested,
      minutes_applied: 0,
      source: `${source}:paused`,
      direction: opts.direction || null,
      channel: opts.channel || 'voice'
    });
    trackVoiceMinutes(db, customerId, minutesRequested, 0);
    return { success: true, minutes_applied: 0, enforcement_paused: true };
  }

  const pools = db.getBillingMinutePools(customerId);
  const totalAvailable = pools.total_available ?? 0;

  let remaining = minutesRequested;
  const fromPlan = Math.min(pools.plan_pool_minutes ?? 0, remaining);
  remaining -= fromPlan;
  const fromTopup = Math.min(pools.topup_balance_minutes ?? 0, remaining);
  remaining -= fromTopup;
  const minutesApplied = fromPlan + fromTopup;

  if (minutesApplied > 0) {
    const credits = pools.credits;
    if (credits && db.db) {
      db.db.prepare(`
        UPDATE customer_credits
        SET credits_balance_minutes = credits_balance_minutes - ?,
            topup_balance_minutes = topup_balance_minutes - ?,
            free_credits_used = free_credits_used + ?,
            paid_credits_used = paid_credits_used + ?,
            updated_at = datetime('now')
        WHERE customer_id = ?
      `).run(
        minutesApplied,
        fromTopup,
        Math.min(fromPlan, Math.max(0, (credits.free_credits_allocated || 0) - (credits.free_credits_used || 0))),
        fromTopup,
        customerId
      );
    }
  }

  if (remaining > 0) {
    console.warn(
      `[applyUsage] customer ${customerId} used ${minutesRequested} min but only ${minutesApplied} available (pack-only; ingress gate should have blocked)`
    );
  }

  db.insertUsageEvent({
    customer_id: customerId,
    call_id: idKey,
    call_sid: opts.callSid || null,
    minutes_requested: minutesRequested,
    minutes_applied: minutesApplied,
    source,
    direction: opts.direction || null,
    channel: opts.channel || 'voice'
  });

  trackVoiceMinutes(db, customerId, minutesRequested, minutesApplied);

  if (minutesApplied > 0) {
    try {
      const { maybeSendLowBalanceAlert } = require('./voice-billing-alerts');
      setImmediate(() => maybeSendLowBalanceAlert(customerId));
    } catch (_) { /* non-fatal */ }

    try {
      const { maybeSendTrialUsageNudges } = require('./trial-alerts');
      const { markTrialExhaustedIfNeeded } = require('./trial-lifecycle');
      setImmediate(() => {
        maybeSendTrialUsageNudges(customerId);
        markTrialExhaustedIfNeeded(db, customerId);
      });
    } catch (_) { /* non-fatal */ }
  }

  return {
    success: true,
    minutes_applied: minutesApplied,
    minutes_shortfall: remaining,
    from_plan: fromPlan,
    from_topup: fromTopup
  };
}

function trackVoiceMinutes(db, customerId, voiceMinutes, freeCreditsUsed) {
  const now = new Date();
  const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (typeof db.trackMonthlyUsage === 'function') {
    db.trackMonthlyUsage(customerId, billingMonth, voiceMinutes, 0, freeCreditsUsed, 0, 0);
  }
}

function getTotalAvailableMinutes(db, customerId) {
  const pools = db.getBillingMinutePools(customerId);
  return pools.total_available ?? 0;
}

function getLowBalanceThresholdMinutes(db, customer) {
  const tier = getTier(customer?.plan_tier || 'starter');
  const included = customer?.included_minutes_per_cycle || tier.included_minutes_per_cycle || 0;
  if (included > 0) return Math.ceil(included * 0.2);
  return 50;
}

module.exports = {
  applyUsage,
  getTotalAvailableMinutes,
  getLowBalanceThresholdMinutes,
  resolveCallId
};
