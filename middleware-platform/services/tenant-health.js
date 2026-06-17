/**
 * Tenant health alerts for admin portal
 */

const db = require('../database');

function resolveTenantCustomerId(clinicId) {
  if (!clinicId) return null;
  return (
    db.getCustomerIdForClinic?.(clinicId) ||
    db.ensureCustomerIdForClinic?.(clinicId) ||
    null
  );
}

function getCustomerBilling(customerId) {
  if (!customerId) return null;
  try {
    return db.db.prepare(`
      SELECT id, company_name, name, email, subscription_status, trial_status,
             trial_expires_at, onboarding_state, plan_tier
      FROM customers WHERE id = ?
    `).get(customerId);
  } catch {
    return null;
  }
}

function getMinutesRemaining(customerId) {
  const credits = customerId ? db.getCustomerCredits(customerId) : null;
  return credits?.credits_balance_minutes ?? 0;
}

function getRecentErrorCount(customerId, days = 7) {
  if (!customerId) return 0;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const row = db.db.prepare(`
      SELECT COUNT(*) as count FROM error_log
      WHERE customer_id = ? AND created_at >= ?
    `).get(customerId, since);
    return row?.count || 0;
  } catch {
    return 0;
  }
}

function buildTenantAlert(clinic, customer, minutesRemaining, errorCount) {
  const alerts = [];
  const companyName = clinic.name || customer?.company_name || customer?.name || 'Unknown';
  const base = {
    clinic_id: clinic.clinic_id,
    company_name: companyName,
    minutes_remaining: minutesRemaining,
    subscription_status: customer?.subscription_status || null,
    trial_status: customer?.trial_status || null,
  };

  if (customer?.subscription_status === 'suspended') {
    alerts.push({ ...base, severity: 'critical', reason: 'Account suspended' });
  }
  if (customer?.trial_status === 'expired') {
    alerts.push({ ...base, severity: 'critical', reason: 'Trial expired' });
  }
  if (customer?.subscription_status === 'past_due') {
    alerts.push({ ...base, severity: 'warning', reason: 'Payment past due' });
  }
  if (minutesRemaining < 10 && minutesRemaining >= 0) {
    alerts.push({ ...base, severity: 'warning', reason: 'Low minutes remaining' });
  }
  if (!clinic.retell_agent_id) {
    alerts.push({ ...base, severity: 'warning', reason: 'No voice agent configured' });
  }
  if (errorCount >= 10) {
    alerts.push({ ...base, severity: 'warning', reason: `High error rate (${errorCount} in 7d)` });
  }
  if (customer?.trial_status === 'active' && customer.trial_expires_at) {
    const expires = new Date(customer.trial_expires_at);
    const daysLeft = (expires - Date.now()) / (24 * 60 * 60 * 1000);
    if (daysLeft > 0 && daysLeft <= 3) {
      alerts.push({ ...base, severity: 'warning', reason: 'Trial expiring soon' });
    }
  }
  if (minutesRemaining > 0 && minutesRemaining <= 30 && !alerts.some((a) => a.reason === 'Low minutes remaining')) {
    alerts.push({ ...base, severity: 'info', reason: 'Credits running low' });
  }

  return alerts;
}

function getAllTenantAlerts() {
  const clinics = db.db.prepare('SELECT * FROM clinics ORDER BY created_at DESC').all();
  const allAlerts = [];

  for (const clinic of clinics) {
    const customerId = resolveTenantCustomerId(clinic.clinic_id);
    const customer = getCustomerBilling(customerId);
    const minutesRemaining = getMinutesRemaining(customerId);
    const errorCount = getRecentErrorCount(customerId);
    allAlerts.push(...buildTenantAlert(clinic, customer, minutesRemaining, errorCount));
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  allAlerts.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  return allAlerts;
}

function enrichTenantRow(clinic) {
  const customerId = resolveTenantCustomerId(clinic.clinic_id);
  const customer = getCustomerBilling(customerId);
  const minutesRemaining = getMinutesRemaining(customerId);
  return {
    subscription_status: customer?.subscription_status || null,
    trial_status: customer?.trial_status || null,
    trial_expires_at: customer?.trial_expires_at || null,
    onboarding_state: customer?.onboarding_state || null,
    plan_tier: customer?.plan_tier || null,
    minutes_remaining: minutesRemaining,
    company_name: clinic.name,
  };
}

module.exports = {
  getAllTenantAlerts,
  enrichTenantRow,
  resolveTenantCustomerId,
  getCustomerBilling,
  getMinutesRemaining,
};
