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

const severityOrder = { critical: 0, warning: 1, info: 2 };

function groupAlerts(flatAlerts) {
  const byClinic = new Map();
  for (const a of flatAlerts) {
    const key = a.clinic_id;
    if (!byClinic.has(key)) {
      byClinic.set(key, {
        clinic_id: a.clinic_id,
        company_name: a.company_name,
        minutes_remaining: a.minutes_remaining,
        subscription_status: a.subscription_status,
        trial_status: a.trial_status,
        severity: a.severity,
        reasons: [],
      });
    }
    const g = byClinic.get(key);
    g.reasons.push(a.reason);
    if ((severityOrder[a.severity] ?? 9) < (severityOrder[g.severity] ?? 9)) {
      g.severity = a.severity;
    }
  }
  return Array.from(byClinic.values()).sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
  );
}

const ACTIVE_CLINIC_WHERE = `(archived_at IS NULL OR archived_at = '')`;

function getActiveClinics(includeArchived = false) {
  const sql = includeArchived
    ? 'SELECT * FROM clinics ORDER BY created_at DESC'
    : `SELECT * FROM clinics WHERE ${ACTIVE_CLINIC_WHERE} ORDER BY created_at DESC`;
  return db.db.prepare(sql).all();
}

function getAllTenantAlerts() {
  const clinics = getActiveClinics(false);
  const allAlerts = [];

  for (const clinic of clinics) {
    const customerId = resolveTenantCustomerId(clinic.clinic_id);
    const customer = getCustomerBilling(customerId);
    const minutesRemaining = getMinutesRemaining(customerId);
    const errorCount = getRecentErrorCount(customerId);
    allAlerts.push(...buildTenantAlert(clinic, customer, minutesRemaining, errorCount));
  }

  allAlerts.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  const grouped = groupAlerts(allAlerts);
  return { flat: allAlerts, grouped };
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

function getClinicPmsFields(clinic) {
  return {
    pms_type: clinic?.pms_type || 'somo',
    pms_enabled: clinic?.pms_enabled === 1 || clinic?.pms_enabled === true,
  };
}

function getPendingInviteForClinic(clinicId, customerId) {
  if (!db.db || !clinicId) return false;
  try {
    const row = db.db.prepare(`
      SELECT id FROM provider_invites
      WHERE status = 'pending'
        AND (clinic_id = ? OR (? IS NOT NULL AND customer_id = ?))
      LIMIT 1
    `).get(clinicId, customerId, customerId);
    return !!row;
  } catch {
    return false;
  }
}

function formatInvoiceSummary(invoice) {
  if (!invoice) return null;
  return {
    billing_month: invoice.billing_month || null,
    due_date: invoice.due_date || null,
    sent_at: invoice.sent_at || null,
    status: invoice.status || null,
    total: invoice.total ?? null,
    invoice_number: invoice.invoice_number || null,
  };
}

function getLastInvoiceSummary(customerId) {
  if (!customerId || typeof db.getCustomerInvoices !== 'function') return null;
  const invoices = db.getCustomerInvoices(customerId) || [];
  return formatInvoiceSummary(invoices[0] || null);
}

function getCustomerInvoiceHistory(customerId, limit = 6) {
  if (!customerId || typeof db.getCustomerInvoices !== 'function') return [];
  return (db.getCustomerInvoices(customerId) || [])
    .slice(0, limit)
    .map(formatInvoiceSummary)
    .filter(Boolean);
}

function enrichTenantAdminFields(clinic, customerId) {
  const pms = getClinicPmsFields(clinic);
  return {
    ...pms,
    pending_invite: getPendingInviteForClinic(clinic.clinic_id, customerId),
    last_invoice: getLastInvoiceSummary(customerId),
  };
}

function buildBillingPayload(clinic, customerId) {
  const billing = enrichTenantRow(clinic);
  return {
    plan_tier: billing.plan_tier,
    subscription_status: billing.subscription_status,
    trial_status: billing.trial_status,
    minutes_remaining: billing.minutes_remaining,
    last_invoice: getLastInvoiceSummary(customerId),
    invoices: getCustomerInvoiceHistory(customerId, 6),
  };
}

module.exports = {
  getAllTenantAlerts,
  getActiveClinics,
  ACTIVE_CLINIC_WHERE,
  enrichTenantRow,
  enrichTenantAdminFields,
  buildBillingPayload,
  getClinicPmsFields,
  getPendingInviteForClinic,
  getLastInvoiceSummary,
  formatInvoiceSummary,
  resolveTenantCustomerId,
  getCustomerBilling,
  getMinutesRemaining,
  groupAlerts,
};
