/**
 * ADMIN TENANT MONITORING ROUTES
 * Monitor usage, credits, and agent activity for all tenants (clinics)
 */

const express = require('express');
const db = require('../database');
const { requireAdminOrCapability } = require('../middleware/admin-auth');
const tenantHealth = require('../services/tenant-health');
const tenantDelete = require('../services/admin-tenant-delete-service');

const router = express.Router();
const requireTenantsAccess = requireAdminOrCapability('platform.tenants');
const requireTenantDelete = requireAdminOrCapability('platform.tenants.delete');

const resolveTenantCustomerId = tenantHealth.resolveTenantCustomerId;

/**
 * GET /api/admin/tenants/alerts
 */
router.get('/alerts', requireTenantsAccess, async (req, res) => {
  try {
    const { flat, grouped } = tenantHealth.getAllTenantAlerts();
    res.json({
      alerts: flat,
      grouped_alerts: grouped,
      total: flat.length,
      clinic_count: grouped.length,
    });
  } catch (error) {
    console.error('tenant alerts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get all tenants with usage and credits summary
 * GET /api/admin/tenants
 * 
 * Returns list of all clinics with:
 * - Basic info (name, slug, phone, status)
 * - Credits (balance, allocated, used)
 * - Usage stats (calls, minutes, function calls)
 * - Agent status
 */
router.get('/', requireTenantsAccess, async (req, res) => {
    try {
        const includeArchived = req.query.include_archived === '1';
        const clinics = tenantHealth.getActiveClinics(includeArchived);

        // Get all tenants with usage and credits
        const tenants = await Promise.all(clinics.map(async (clinic) => {
            const clinicId = clinic.clinic_id;
            const customerId = resolveTenantCustomerId(clinicId);

            const credits = (customerId && db.getCustomerCredits(customerId)) || {
                credits_balance_minutes: 0,
                free_credits_allocated: 0,
                free_credits_used: 0,
                paid_credits_purchased: 0,
                paid_credits_used: 0
            };

            const calls = db.db.prepare(`
                SELECT * FROM voice_call_log 
                WHERE customer_id = ? OR clinic_id = ?
                ORDER BY created_at DESC
            `).all(customerId || '__none__', clinicId);

            const functionCalls = customerId
              ? db.db.prepare(`
                SELECT * FROM function_call_log 
                WHERE customer_id = ? 
                ORDER BY created_at DESC
            `).all(customerId)
              : [];

            // Calculate usage metrics
            const totalCalls = calls.length;
            const totalMinutes = calls.reduce((sum, c) => {
                return sum + (c.call_duration_minutes || (c.call_duration_seconds || 0) / 60);
            }, 0);
            const totalFunctionCalls = functionCalls.length;
            const successfulFunctionCalls = functionCalls.filter(f => f.success === 1).length;

            // Get recent calls (last 7 days)
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const recentCalls = calls.filter(c => {
                const callDate = new Date(c.created_at);
                return callDate >= sevenDaysAgo;
            });
            const recentMinutes = recentCalls.reduce((sum, c) => {
                return sum + (c.call_duration_minutes || (c.call_duration_seconds || 0) / 60);
            }, 0);

            // Calculate costs
            const twilioCost = totalMinutes * 0.013; // $0.013 per minute
            const retellCost = totalMinutes * 0.02; // $0.02 per minute
            const totalCost = twilioCost + retellCost;

            // Get phone numbers
            const phoneNumbers = db.getClinicPhoneNumbers(clinicId) || [];

            const billing = tenantHealth.enrichTenantRow(clinic);

            return {
                clinic_id: clinicId,
                name: clinic.name,
                company_name: billing.company_name,
                slug: clinic.slug,
                email: clinic.email,
                phone_number: clinic.phone_number,
                phone_numbers: phoneNumbers.map(p => p.phone_number),
                retell_agent_id: clinic.retell_agent_id,
                retell_agent_status: clinic.retell_agent_status,
                is_active: clinic.is_active === 1,
                archived_at: clinic.archived_at || null,
                created_at: clinic.created_at,
                updated_at: clinic.updated_at,
                subscription_status: billing.subscription_status,
                trial_status: billing.trial_status,
                trial_expires_at: billing.trial_expires_at,
                onboarding_state: billing.onboarding_state,
                plan_tier: billing.plan_tier,
                minutes_remaining: billing.minutes_remaining,
                credits: {
                    balance_minutes: credits.credits_balance_minutes || 0,
                    free_allocated: credits.free_credits_allocated || 0,
                    free_used: credits.free_credits_used || 0,
                    free_remaining: Math.max(0, (credits.free_credits_allocated || 0) - (credits.free_credits_used || 0)),
                    paid_purchased: credits.paid_credits_purchased || 0,
                    paid_used: credits.paid_credits_used || 0,
                    paid_remaining: Math.max(0, (credits.paid_credits_purchased || 0) - (credits.paid_credits_used || 0)),
                    expires_at: credits.free_credits_expires_at || null
                },
                usage: {
                    total_calls: totalCalls,
                    total_minutes: Math.round(totalMinutes * 100) / 100,
                    total_function_calls: totalFunctionCalls,
                    successful_function_calls: successfulFunctionCalls,
                    failed_function_calls: totalFunctionCalls - successfulFunctionCalls,
                    recent_7d_calls: recentCalls.length,
                    recent_7d_minutes: Math.round(recentMinutes * 100) / 100
                },
                costs: {
                    twilio_cost_usd: Math.round(twilioCost * 100) / 100,
                    retell_cost_usd: Math.round(retellCost * 100) / 100,
                    total_cost_usd: Math.round(totalCost * 100) / 100
                },
                agent: {
                    retell_agent_id: clinic.retell_agent_id,
                    status: clinic.retell_agent_status || 'pending',
                    has_agent: !!clinic.retell_agent_id
                }
            };
        }));

        // Calculate summary stats
        const summary = {
            total_tenants: tenants.length,
            active_tenants: tenants.filter(t => t.is_active).length,
            tenants_with_agent: tenants.filter(t => t.agent.has_agent).length,
            total_credits_allocated: tenants.reduce((sum, t) => sum + t.credits.free_allocated + t.credits.paid_purchased, 0),
            total_credits_used: tenants.reduce((sum, t) => sum + t.credits.free_used + t.credits.paid_used, 0),
            total_credits_remaining: tenants.reduce((sum, t) => sum + t.credits.balance_minutes, 0),
            total_calls: tenants.reduce((sum, t) => sum + t.usage.total_calls, 0),
            total_minutes: tenants.reduce((sum, t) => sum + t.usage.total_minutes, 0),
            total_function_calls: tenants.reduce((sum, t) => sum + t.usage.total_function_calls, 0),
            total_cost_usd: tenants.reduce((sum, t) => sum + t.costs.total_cost_usd, 0)
        };

        res.json({
            success: true,
            summary,
            tenants: tenants.sort((a, b) => {
                // Sort by recent activity (most active first)
                return b.usage.recent_7d_calls - a.usage.recent_7d_calls;
            })
        });
    } catch (error) {
        console.error('❌ Error fetching tenants:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/tenants/amount-resolution/mismatches
 */
router.get('/amount-resolution/mismatches', requireTenantsAccess, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
        if (!db.db) {
            return res.json({ success: true, mismatches: [], count: 0 });
        }
        const mismatches = db.db
            .prepare(
                `SELECT id, patient_id, appointment_id, session_id, quoted_amount, charged_amount,
                        source, status, details_json, created_at
                 FROM amount_resolution_log
                 WHERE quoted_amount IS NOT NULL
                   AND charged_amount IS NOT NULL
                   AND ABS(quoted_amount - charged_amount) > 0.009
                 ORDER BY created_at DESC
                 LIMIT ?`
            )
            .all(limit);
        res.json({ success: true, mismatches, count: mismatches.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/tenants/pms-health
 */
router.get('/pms-health', requireTenantsAccess, async (req, res) => {
    try {
        const { getPmsHealthSummary } = require('../services/pms');
        const clinics = tenantHealth.getActiveClinics(false);
        const rows = clinics.map((c) => ({
            clinic_id: c.clinic_id,
            name: c.name,
            ...getPmsHealthSummary(c.clinic_id)
        }));
        res.json({ success: true, tenants: rows, count: rows.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/tenants/:clinicId/pms
 */
router.get('/:clinicId/pms', requireTenantsAccess, async (req, res) => {
    try {
        const { getClinicPmsSettings, maskPmsConfigForApi, PmsHub } = require('../services/pms');
        const clinicId = req.params.clinicId;
        const settings = getClinicPmsSettings(clinicId);
        if (!settings) {
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        }
        const hub = PmsHub.tryForClinic(clinicId);
        const health = hub ? await hub.healthCheck() : null;
        res.json({
            success: true,
            clinic_id: clinicId,
            pms_type: settings.pms_type,
            pms_enabled: settings.pms_enabled,
            pms_connected_at: settings.pms_connected_at,
            pms_last_sync_at: settings.pms_last_sync_at,
            pms_last_error: settings.pms_last_error,
            config: maskPmsConfigForApi(settings.pms_config),
            health,
            ...getPmsHealthSummary(clinicId)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/admin/tenants/:clinicId/pms
 */
router.put('/:clinicId/pms', requireTenantsAccess, async (req, res) => {
    try {
        const {
            updateClinicPms,
            encryptPmsConfig,
            getClinicPmsSettings,
            PmsHub
        } = require('../services/pms');
        const clinicId = req.params.clinicId;
        const { pms_type, pms_enabled, config } = req.body || {};
        const updates = {};
        if (pms_type !== undefined) updates.pms_type = pms_type;
        if (pms_enabled !== undefined) updates.pms_enabled = pms_enabled ? 1 : 0;
        if (config !== undefined) {
            updates.pms_config = encryptPmsConfig(config);
            updates.pms_connected_at = new Date().toISOString();
        }
        updateClinicPms(clinicId, updates);
        const settings = getClinicPmsSettings(clinicId);
        const hub = settings?.pms_enabled ? PmsHub.tryForClinic(clinicId) : null;
        const health = hub ? await hub.healthCheck() : null;
        res.json({ success: true, clinic_id: clinicId, settings, health });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/tenants/:clinicId/phi-export — tenant PHI bundle for offboarding
 */
router.get('/:clinicId/phi-export', requireTenantsAccess, async (req, res) => {
    try {
        const clinicId = req.params.clinicId;
        const clinic = db.db
          ? db.db.prepare('SELECT clinic_id, name FROM clinics WHERE clinic_id = ?').get(clinicId)
          : null;
        if (!clinic) {
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        }

        const { buildTenantPhiExport } = require('../services/tenant-phi-export-service');
        const bundle = buildTenantPhiExport(clinicId);
        if (!bundle) {
            return res.status(404).json({ success: false, error: 'Export failed — tenant not found' });
        }

        try {
            if (typeof db.logHipaaAccess === 'function') {
                db.logHipaaAccess({
                    user_id: req.adminSession?.email || 'admin',
                    resource_type: 'TenantPhiExport',
                    resource_id: clinicId,
                    action: 'phi_export',
                    ip_address: req.ip || null
                });
            }
        } catch (_) { /* non-fatal */ }

        res.setHeader('Content-Disposition', `attachment; filename="phi-export-${clinicId}.json"`);
        res.json({ success: true, ...bundle });
    } catch (error) {
        console.error('❌ Error exporting tenant PHI:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get detailed tenant usage and credits
 * GET /api/admin/tenants/:clinicId
 */
router.get('/:clinicId', requireTenantsAccess, async (req, res) => {
    try {
        const clinicId = req.params.clinicId;
        const customerId = resolveTenantCustomerId(clinicId);
        const clinic = await db.getClinicById(clinicId);

        if (!clinic) {
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        }

        const credits = (customerId && db.getCustomerCredits(customerId)) || {
            credits_balance_minutes: 0,
            free_credits_allocated: 0,
            free_credits_used: 0,
            paid_credits_purchased: 0,
            paid_credits_used: 0,
            free_credits_expires_at: null
        };

        const calls = db.db.prepare(`
            SELECT * FROM voice_call_log 
            WHERE customer_id = ? OR clinic_id = ?
            ORDER BY created_at DESC
        `).all(customerId || '__none__', clinicId);

        const functionCalls = customerId
          ? db.db.prepare(`
            SELECT * FROM function_call_log 
            WHERE customer_id = ? 
            ORDER BY created_at DESC
        `).all(customerId)
          : [];

        const errors = customerId
          ? db.db.prepare(`
            SELECT * FROM error_log 
            WHERE customer_id = ? 
            ORDER BY created_at DESC
            LIMIT 50
        `).all(customerId)
          : [];

        // Calculate detailed metrics
        const totalMinutes = calls.reduce((sum, c) => {
            return sum + (c.call_duration_minutes || (c.call_duration_seconds || 0) / 60);
        }, 0);

        // Group by time period
        const now = new Date();
        const periods = {
            last_24h: { start: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
            last_7d: { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
            last_30d: { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }
        };

        Object.keys(periods).forEach(period => {
            const periodCalls = calls.filter(c => new Date(c.created_at) >= periods[period].start);
            periods[period].calls = periodCalls.length;
            periods[period].minutes = Math.round(periodCalls.reduce((sum, c) => {
                return sum + (c.call_duration_minutes || (c.call_duration_seconds || 0) / 60);
            }, 0) * 100) / 100;
            periods[period].function_calls = functionCalls.filter(f => 
                new Date(f.created_at) >= periods[period].start
            ).length;
        });

        // Function call breakdown
        const functionBreakdown = {};
        functionCalls.forEach(f => {
            const name = f.function_name || 'unknown';
            if (!functionBreakdown[name]) {
                functionBreakdown[name] = { total: 0, successful: 0, failed: 0 };
            }
            functionBreakdown[name].total++;
            if (f.success === 1) {
                functionBreakdown[name].successful++;
            } else {
                functionBreakdown[name].failed++;
            }
        });

        // Get phone numbers
        const phoneNumbers = db.getClinicPhoneNumbers(clinicId) || [];

        const billing = tenantHealth.enrichTenantRow(clinic);
        const deleteOptions = tenantDelete.getDeleteOptions(clinic);
        let eligibilityUsage = { checks_today: 0, checks_month: 0, daily_cap: 50 };
        let eligibilityAlert = null;
        let payerPreflight = [];
        if (customerId) {
          try {
            const { getUsageForCustomer } = require('../services/eligibility-usage-service');
            const { checkEligibilityUsageAlert } = require('../services/eligibility-usage-alerts');
            eligibilityUsage = getUsageForCustomer(customerId);
            const tier = billing.plan_tier || 'practice';
            eligibilityAlert = checkEligibilityUsageAlert(customerId, tier);
          } catch (_) {}
        }
        try {
          const { assessPayerReadiness } = require('../services/payer-preflight-service');
          payerPreflight = assessPayerReadiness(db, { clinicId, customerId });
        } catch (_) {}
        let tenantFlags = null;
        try {
          const { getTenantFlags } = require('../services/tenant-flags-service');
          tenantFlags = getTenantFlags(clinicId);
        } catch (_) {}

        res.json({
            success: true,
            delete_options: deleteOptions,
            tenant: {
                clinic_id: clinic.clinic_id,
                name: clinic.name,
                company_name: billing.company_name,
                slug: clinic.slug,
                email: clinic.email,
                phone_number: clinic.phone_number,
                subscription_status: billing.subscription_status,
                trial_status: billing.trial_status,
                trial_expires_at: billing.trial_expires_at,
                onboarding_state: billing.onboarding_state,
                plan_tier: billing.plan_tier,
                minutes_remaining: billing.minutes_remaining,
                phone_numbers: phoneNumbers.map(p => ({
                    phone_number: p.phone_number,
                    is_primary: p.is_primary === 1
                })),
                retell_agent_id: clinic.retell_agent_id,
                retell_agent_status: clinic.retell_agent_status,
                is_active: clinic.is_active === 1,
                archived_at: clinic.archived_at || null,
                created_at: clinic.created_at,
                updated_at: clinic.updated_at
            },
            credits: {
                balance_minutes: credits.credits_balance_minutes || 0,
                free_allocated: credits.free_credits_allocated || 0,
                free_used: credits.free_credits_used || 0,
                free_remaining: Math.max(0, (credits.free_credits_allocated || 0) - (credits.free_credits_used || 0)),
                paid_purchased: credits.paid_credits_purchased || 0,
                paid_used: credits.paid_credits_used || 0,
                paid_remaining: Math.max(0, (credits.paid_credits_purchased || 0) - (credits.paid_credits_used || 0)),
                expires_at: credits.free_credits_expires_at || null
            },
            usage: {
                total_calls: calls.length,
                total_minutes: Math.round(totalMinutes * 100) / 100,
                total_function_calls: functionCalls.length,
                successful_function_calls: functionCalls.filter(f => f.success === 1).length,
                failed_function_calls: functionCalls.filter(f => f.success === 0).length,
                total_errors: errors.length,
                by_period: periods,
                function_breakdown: functionBreakdown
            },
            costs: {
                twilio_cost_usd: Math.round(totalMinutes * 0.013 * 100) / 100,
                retell_cost_usd: Math.round(totalMinutes * 0.02 * 100) / 100,
                total_cost_usd: Math.round(totalMinutes * 0.033 * 100) / 100
            },
            recent_calls: calls.slice(0, 20),
            recent_function_calls: functionCalls.slice(0, 20),
            recent_errors: errors.slice(0, 20),
            eligibility_usage: eligibilityUsage,
            eligibility_alert: eligibilityAlert,
            payer_preflight: payerPreflight,
            tenant_flags: tenantFlags
        });
    } catch (error) {
        console.error('❌ Error fetching tenant details:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Allocate credits to a tenant
 * POST /api/admin/tenants/:clinicId/credits
 * Body: { credits: number, type: 'free' | 'paid' }
 */
router.post('/:clinicId/credits', requireTenantsAccess, async (req, res) => {
    try {
        const clinicId = req.params.clinicId;
        const customerId = resolveTenantCustomerId(clinicId);
        const { credits, type = 'free' } = req.body;

        if (!credits || credits < 1) {
            return res.status(400).json({
                success: false,
                error: 'Invalid credits amount'
            });
        }

        const clinic = await db.getClinicById(clinicId);
        if (!clinic) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found'
            });
        }

        if (!customerId) {
            return res.status(400).json({
                success: false,
                error: 'No SaaS customer linked to this clinic'
            });
        }

        db.allocateFreeCredits(customerId, credits);

        console.log(`✅ Admin allocated ${credits} ${type} credits to tenant ${clinicId} (customer ${customerId})`);

        res.json({
            success: true,
            message: `Successfully allocated ${credits} ${type} credits`,
            credits_allocated: credits,
            type
        });
    } catch (error) {
        console.error('❌ Error allocating credits:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/admin/tenants/:clinicId
 * Body: { mode?: 'soft'|'hard', confirm_slug: string, force?: boolean }
 */
router.delete('/:clinicId', requireTenantDelete, express.json(), async (req, res) => {
    try {
        const clinicId = req.params.clinicId;
        const clinic = await db.getClinicById(clinicId);
        if (!clinic) {
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        }

        const confirmSlug = (req.body?.confirm_slug || req.query.confirm_slug || '').trim();
        if (!confirmSlug || confirmSlug !== clinic.slug) {
            return res.status(400).json({
                success: false,
                error: 'confirm_slug must match tenant slug',
            });
        }

        const mode = (req.body?.mode || req.query.mode || 'soft').toLowerCase();
        const deletedBy = req.adminSession ? 'admin_session' : 'admin';
        const force = req.body?.force === true || req.query.force === '1';

        let result;
        if (mode === 'hard') {
            result = tenantDelete.hardDelete(clinicId, deletedBy, { force });
        } else if (mode === 'soft') {
            result = tenantDelete.softDelete(clinicId, deletedBy);
        } else {
            return res.status(400).json({ success: false, error: 'mode must be soft or hard' });
        }

        res.json({
            success: true,
            ...result,
            message: result.mode === 'hard'
                ? `Tenant "${result.clinic_name}" permanently removed`
                : result.already_archived
                    ? `Tenant "${clinic.name}" was already archived`
                    : `Tenant "${result.clinic_name}" archived (data retained for audit)`,
        });
    } catch (error) {
        if (error.code === 'HARD_DELETE_BLOCKED') {
            return res.status(409).json({ success: false, error: error.message });
        }
        console.error('❌ Error deleting tenant:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

