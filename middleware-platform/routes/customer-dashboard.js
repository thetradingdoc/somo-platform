/**
 * CUSTOMER DASHBOARD ROUTES
 * 
 * Tenant-scoped endpoints for customer dashboard data
 * All data is filtered by customer_id from session
 */

const express = require('express');
const db = require('../database');
const { authLimiter } = require('../middleware/rate-limiter');

const router = express.Router();

/**
 * Helper to get customer from session
 */
function getCustomerFromSession(req) {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
        return null;
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
        return null;
    }

    return db.getCustomer(session.customer_id);
}

/**
 * GET /api/customer/dashboard/stats
 * Get dashboard stats scoped to this customer
 */
router.get('/stats', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Please sign in.'
            });
        }

        // Get voice calls for this customer
        const calls = db.db.prepare(`
            SELECT * FROM voice_call_log 
            WHERE customer_id = ? 
            ORDER BY created_at DESC
        `).all(customer.id);

        const totalCalls = calls.length;
        const today = new Date().toISOString().split('T')[0];
        const callsToday = calls.filter(c => c.created_at && c.created_at.startsWith(today)).length;

        // Calculate call costs
        const callCosts = calls.reduce((sum, call) => {
            return sum + (call.total_cost_usd || 0);
        }, 0);
        const costsToday = calls.filter(c => c.created_at && c.created_at.startsWith(today))
            .reduce((sum, call) => sum + (call.total_cost_usd || 0), 0);

        // Get appointments for this customer
        const appointments = db.db.prepare(`
            SELECT * FROM appointments 
            WHERE customer_id = ? 
            ORDER BY start_time DESC
        `).all(customer.id);

        const upcomingAppointments = appointments.filter(a => {
            const startTime = new Date(a.start_time || `${a.date}T${a.time}:00`);
            return startTime > new Date() && a.status !== 'cancelled';
        });

        // Get revenue from voice checkouts scoped to this customer's merchant
        // Use merchant_id directly from voice_checkouts table (more efficient)
        const merchantId = customer.merchant_id;
        let checkouts = [];
        if (merchantId) {
            checkouts = db.db.prepare(`
                SELECT * FROM voice_checkouts 
                WHERE merchant_id = ?
                ORDER BY created_at DESC
            `).all(merchantId);
        }

        const todayRevenue = checkouts
            .filter(c => c.created_at && c.created_at.startsWith(today) && c.status === 'completed')
            .reduce((sum, c) => sum + (c.amount || 0), 0); // Use 'amount' not 'total'

        res.json({
            success: true,
            stats: {
                total: {
                    calls: totalCalls
                },
                today: {
                    calls: callsToday,
                    revenue: todayRevenue,
                    orders: checkouts.filter(c => c.created_at && c.created_at.startsWith(today) && c.status === 'completed').length
                },
                priority: {
                    cases: upcomingAppointments.filter(a => a.status === 'scheduled').length
                },
                costs: {
                    today: costsToday,
                    total: callCosts
                }
            }
        });
    } catch (error) {
        console.error('❌ Get dashboard stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get dashboard stats',
            message: error.message
        });
    }
});

/**
 * GET /api/customer/dashboard/appointments
 * Get appointments scoped to this customer
 */
router.get('/appointments', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Please sign in.'
            });
        }

        const { status, limit = 50 } = req.query;

        // Scope appointments by customer_id if column exists, otherwise by merchant_id via clinic
        let query;
        const params = [];

        // Check if customer_id column exists in appointments table
        const tableInfo = db.db.prepare("PRAGMA table_info(appointments)").all();
        const hasCustomerId = tableInfo.some(col => col.name === 'customer_id');

        if (hasCustomerId && customer.id) {
            // Use customer_id if available
            query = 'SELECT * FROM appointments WHERE customer_id = ?';
            params.push(customer.id);
        } else if (customer.merchant_id) {
            // Fallback: scope via clinic_id -> merchant_id relationship
            query = `SELECT a.* FROM appointments a
                     LEFT JOIN clinics c ON a.clinic_id = c.clinic_id
                     WHERE c.merchant_id = ?`;
            params.push(customer.merchant_id);
        } else {
            // No merchant_id - return empty
            query = 'SELECT * FROM appointments WHERE 1=0';
        }

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        query += ' ORDER BY start_time DESC';

        if (limit) {
            query += ' LIMIT ?';
            params.push(parseInt(limit, 10));
        }

        const appointments = db.db.prepare(query).all(...params);

        res.json({
            success: true,
            appointments,
            count: appointments.length
        });
    } catch (error) {
        console.error('❌ Get appointments error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get appointments',
            message: error.message
        });
    }
});

/**
 * GET /api/customer/dashboard/appointments/upcoming
 * Get upcoming appointments scoped to this customer
 */
router.get('/appointments/upcoming', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Please sign in.'
            });
        }

        const { limit = 10 } = req.query;
        const now = new Date().toISOString();

        // Scope appointments by customer_id if column exists, otherwise by merchant_id via clinic
        let appointments;
        const tableInfo = db.db.prepare("PRAGMA table_info(appointments)").all();
        const hasCustomerId = tableInfo.some(col => col.name === 'customer_id');

        if (hasCustomerId && customer.id) {
            // Use customer_id if available
            appointments = db.db.prepare(`
                SELECT * FROM appointments 
                WHERE customer_id = ? 
                AND start_time > ? 
                AND status != 'cancelled'
                ORDER BY start_time ASC
                LIMIT ?
            `).all(customer.id, now, parseInt(limit, 10));
        } else if (customer.merchant_id) {
            // Fallback: scope via clinic_id -> merchant_id relationship
            appointments = db.db.prepare(`
                SELECT a.* FROM appointments a
                LEFT JOIN clinics c ON a.clinic_id = c.clinic_id
                WHERE c.merchant_id = ?
                AND a.start_time > ? 
                AND a.status != 'cancelled'
                ORDER BY a.start_time ASC
                LIMIT ?
            `).all(customer.merchant_id, now, parseInt(limit, 10));
        } else {
            appointments = [];
        }

        res.json({
            success: true,
            appointments,
            count: appointments.length
        });
    } catch (error) {
        console.error('❌ Get upcoming appointments error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get upcoming appointments',
            message: error.message
        });
    }
});

/**
 * GET /api/customer/dashboard/calls
 * Get voice calls scoped to this customer
 */
router.get('/calls', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Please sign in.'
            });
        }

        const { limit = 50, status } = req.query;

        let query = 'SELECT * FROM voice_call_log WHERE customer_id = ?';
        const params = [customer.id];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC';

        if (limit) {
            query += ' LIMIT ?';
            params.push(parseInt(limit, 10));
        }

        const calls = db.db.prepare(query).all(...params);

        res.json({
            success: true,
            calls,
            count: calls.length
        });
    } catch (error) {
        console.error('❌ Get calls error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get calls',
            message: error.message
        });
    }
});

/**
 * GET /api/customer/dashboard/agent/stats
 * Get agent stats scoped to this customer
 */
router.get('/agent/stats', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Please sign in.'
            });
        }

        // Get calls for this customer
        const calls = db.db.prepare(`
            SELECT * FROM voice_call_log 
            WHERE customer_id = ? 
            ORDER BY created_at DESC
        `).all(customer.id);

        const today = new Date().toISOString().split('T')[0];
        const callsToday = calls.filter(c => c.created_at && c.created_at.startsWith(today));

        const durationsToday = callsToday
            .map(c => c.call_duration_seconds)
            .filter((d) => d != null && d > 0);
        const avgDurationSecondsToday = durationsToday.length
            ? Math.round(durationsToday.reduce((a, b) => a + b, 0) / durationsToday.length)
            : 0;

        let apptsBookedToday = 0;
        try {
            const bookedRows = db.db.prepare(`
                SELECT COUNT(*) AS cnt FROM function_call_log
                WHERE customer_id = ?
                  AND function_name = 'schedule_appointment'
                  AND success = 1
                  AND created_at >= ?
            `).get(customer.id, `${today}T00:00:00`);
            apptsBookedToday = bookedRows?.cnt || 0;
        } catch (_) {}

        if (apptsBookedToday === 0 && customer.merchant_id) {
            try {
                const clinicRow = db.db.prepare(
                    'SELECT clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1'
                ).get(customer.merchant_id);
                if (clinicRow?.clinic_id) {
                    const apptRow = db.db.prepare(`
                        SELECT COUNT(*) AS cnt FROM appointments
                        WHERE clinic_id = ?
                          AND date(created_at) = date('now', 'localtime')
                    `).get(clinicRow.clinic_id);
                    apptsBookedToday = apptRow?.cnt || 0;
                }
            } catch (_) {}
        }

        const hasOutcomeCol = db.db.prepare('PRAGMA table_info(voice_call_log)').all()
            .some((c) => c.name === 'outcome');

        const VoiceAgentRuntime = require('../services/voice/voice-agent-runtime');

        const recentCalls = calls.slice(0, 10).map(call => {
            let outcome = hasOutcomeCol ? call.outcome : null;
            if (!outcome) {
                if (call.status === 'completed') outcome = 'info';
                else outcome = 'info';
            }
            let openerUsed = call.opener_used || null;
            let direction = call.direction || null;
            if (!openerUsed && call.call_id && db.db) {
                try {
                    const ev = db.db.prepare(`
                      SELECT payload_json FROM kelly_call_events
                      WHERE call_id = ? AND event_type = 'call_opener_used'
                      ORDER BY created_at DESC LIMIT 1
                    `).get(call.call_id);
                    if (ev?.payload_json) {
                        const payload = JSON.parse(ev.payload_json);
                        openerUsed = payload.opener_text || openerUsed;
                        direction = direction || payload.direction || null;
                    }
                } catch (_) {}
            }
            let openerMatch = null;
            if (openerUsed && customer.merchant_id) {
                try {
                    const settings = db.getVoiceAgentSettingsForProvider({
                        merchantId: customer.merchant_id,
                        customerId: customer.id
                    });
                    const expected =
                        direction === 'outbound' ? settings?.outbound_opener : settings?.greeting;
                    if (expected) openerMatch = String(expected).trim() === String(openerUsed).trim();
                } catch (_) {}
            }
            return {
                id: call.id,
                call_id: call.call_id,
                status: call.status,
                outcome,
                direction,
                opener_used: openerUsed,
                opener_match: openerMatch,
                duration: call.call_duration_seconds,
                duration_seconds: call.call_duration_seconds,
                cost: call.total_cost_usd || 0,
                created_at: call.created_at,
                caller_label: VoiceAgentRuntime.formatCallerLabelFromCallRow(call)
            };
        });

        res.json({
            success: true,
            stats: {
                total_calls: calls.length,
                calls_today: callsToday.length,
                avg_duration_seconds_today: avgDurationSecondsToday,
                appts_booked_today: apptsBookedToday,
                total_cost: calls.reduce((sum, c) => sum + (c.total_cost_usd || 0), 0),
                cost_today: callsToday.reduce((sum, c) => sum + (c.total_cost_usd || 0), 0)
            },
            recent_calls: recentCalls
        });
    } catch (error) {
        console.error('❌ Get agent stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get agent stats',
            message: error.message
        });
    }
});

module.exports = router;


