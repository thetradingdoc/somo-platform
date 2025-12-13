/**
 * ADMIN TENANT MONITORING ROUTES
 * Monitor usage, credits, and agent activity for all tenants (clinics)
 */

const express = require('express');
const db = require('../database');

const router = express.Router();

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
router.get('/', async (req, res) => {
    try {
        // Get all clinics
        const clinics = db.db.prepare('SELECT * FROM clinics ORDER BY created_at DESC').all();

        // Get all tenants with usage and credits
        const tenants = await Promise.all(clinics.map(async (clinic) => {
            const clinicId = clinic.clinic_id;

            // Get credits (using clinic_id as customer_id for now)
            const credits = db.getCustomerCredits(clinicId) || {
                credits_balance_minutes: 0,
                free_credits_allocated: 0,
                free_credits_used: 0,
                paid_credits_purchased: 0,
                paid_credits_used: 0
            };

            // Get voice calls (using clinic_id as customer_id)
            const calls = db.db.prepare(`
                SELECT * FROM voice_call_log 
                WHERE customer_id = ? 
                ORDER BY created_at DESC
            `).all(clinicId);

            // Get function calls
            const functionCalls = db.db.prepare(`
                SELECT * FROM function_call_log 
                WHERE customer_id = ? 
                ORDER BY created_at DESC
            `).all(clinicId);

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

            return {
                clinic_id: clinicId,
                name: clinic.name,
                slug: clinic.slug,
                email: clinic.email,
                phone_number: clinic.phone_number,
                phone_numbers: phoneNumbers.map(p => p.phone_number),
                retell_agent_id: clinic.retell_agent_id,
                retell_agent_status: clinic.retell_agent_status,
                is_active: clinic.is_active === 1,
                created_at: clinic.created_at,
                updated_at: clinic.updated_at,
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
 * Get detailed tenant usage and credits
 * GET /api/admin/tenants/:clinicId
 */
router.get('/:clinicId', async (req, res) => {
    try {
        const clinicId = req.params.clinicId;
        const clinic = await db.getClinicById(clinicId);

        if (!clinic) {
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        }

        // Get credits
        const credits = db.getCustomerCredits(clinicId) || {
            credits_balance_minutes: 0,
            free_credits_allocated: 0,
            free_credits_used: 0,
            paid_credits_purchased: 0,
            paid_credits_used: 0,
            free_credits_expires_at: null
        };

        // Get all voice calls
        const calls = db.db.prepare(`
            SELECT * FROM voice_call_log 
            WHERE customer_id = ? 
            ORDER BY created_at DESC
        `).all(clinicId);

        // Get all function calls
        const functionCalls = db.db.prepare(`
            SELECT * FROM function_call_log 
            WHERE customer_id = ? 
            ORDER BY created_at DESC
        `).all(clinicId);

        // Get errors
        const errors = db.db.prepare(`
            SELECT * FROM error_log 
            WHERE customer_id = ? 
            ORDER BY created_at DESC
            LIMIT 50
        `).all(clinicId);

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

        res.json({
            success: true,
            tenant: {
                clinic_id: clinic.clinic_id,
                name: clinic.name,
                slug: clinic.slug,
                email: clinic.email,
                phone_number: clinic.phone_number,
                phone_numbers: phoneNumbers.map(p => ({
                    phone_number: p.phone_number,
                    is_primary: p.is_primary === 1
                })),
                retell_agent_id: clinic.retell_agent_id,
                retell_agent_status: clinic.retell_agent_status,
                is_active: clinic.is_active === 1,
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
            recent_errors: errors.slice(0, 20)
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
router.post('/:clinicId/credits', async (req, res) => {
    try {
        const clinicId = req.params.clinicId;
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

        // Allocate credits (using clinic_id as customer_id)
        if (type === 'free') {
            db.allocateFreeCredits(clinicId, credits);
        } else {
            // For paid credits, we'd need a different function
            // For now, just allocate as free
            db.allocateFreeCredits(clinicId, credits);
        }

        console.log(`✅ Admin allocated ${credits} ${type} credits to tenant ${clinicId}`);

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

module.exports = router;

