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

        // Get revenue from voice checkouts (if any)
        const checkouts = db.db.prepare(`
            SELECT * FROM voice_checkouts 
            WHERE clinic_id IN (
                SELECT clinic_id FROM clinics WHERE merchant_id = (
                    SELECT id FROM merchants WHERE id = ?
                )
            )
            ORDER BY created_at DESC
        `).all(customer.id);

        const todayRevenue = checkouts
            .filter(c => c.created_at && c.created_at.startsWith(today) && c.status === 'completed')
            .reduce((sum, c) => sum + (c.total || 0), 0);

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

        let query = 'SELECT * FROM appointments WHERE customer_id = ?';
        const params = [customer.id];

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

        const appointments = db.db.prepare(`
            SELECT * FROM appointments 
            WHERE customer_id = ? 
            AND start_time > ? 
            AND status != 'cancelled'
            ORDER BY start_time ASC
            LIMIT ?
        `).all(customer.id, now, parseInt(limit, 10));

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

        // Get recent calls (last 10)
        const recentCalls = calls.slice(0, 10).map(call => ({
            id: call.id,
            call_id: call.call_id,
            status: call.status,
            duration: call.call_duration_seconds,
            cost: call.total_cost_usd || 0,
            created_at: call.created_at
        }));

        res.json({
            success: true,
            stats: {
                total_calls: calls.length,
                calls_today: callsToday.length,
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


