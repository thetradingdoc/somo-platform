/**
 * ADMIN ROUTES
 * Dashboard API to view merchants, transactions, and analytics
 * NOW INCLUDES VOICE COMMERCE SUPPORT
 */

const express = require('express');
const db = require('../database');

const router = express.Router();

/**
 * Get dashboard overview
 * GET /api/admin/dashboard
 * 
 * Returns stats from all platforms: ACP, AP2, and Voice
 */
router.get('/dashboard', (req, res) => {
    try {
        const merchants = db.getAllMerchants();
        const transactions = db.getAllTransactions();
        const ap2Transactions = db.getAllAP2Transactions();
        const voiceCheckouts = db.getAllVoiceCheckouts();

        // Calculate revenue by platform
        const acpRevenue = transactions
            .filter(t => t.platform === 'acp' && t.status === 'completed')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        const ap2Revenue = ap2Transactions
            .filter(t => t.status === 'completed')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        const voiceRevenue = voiceCheckouts
            .filter(v => v.status === 'completed')
            .reduce((sum, v) => sum + (v.amount || 0), 0);

        // Combine all transactions for recent display
        const allTransactions = [];

        // Add ACP transactions
        transactions.forEach(t => {
            allTransactions.push({
                id: t.id,
                merchant_id: t.merchant_id,
                platform: t.platform,
                customer_email: t.customer_email,
                amount: t.amount,
                status: t.status,
                created_at: t.created_at,
                source: 'acp'
            });
        });

        // Add Voice transactions
        voiceCheckouts
            .filter(v => v.status === 'completed' || v.status === 'pending')
            .forEach(v => {
                allTransactions.push({
                    id: v.id,
                    merchant_id: v.merchant_id,
                    platform: 'voice',
                    customer_email: v.customer_email || v.customer_phone,
                    amount: v.amount,
                    status: v.status,
                    created_at: v.created_at,
                    source: 'voice'
                });
            });

        // Sort by date (most recent first) and take top 20
        allTransactions.sort((a, b) => {
            return new Date(b.created_at) - new Date(a.created_at);
        });
        const recentTransactions = allTransactions.slice(0, 20);

        // Calculate comprehensive stats
        const stats = {
            total_merchants: merchants.length,
            active_merchants: merchants.filter(m => m.status === 'active').length,
            total_transactions:
                transactions.length +
                ap2Transactions.length +
                voiceCheckouts.filter(v => v.status === 'completed').length,
            completed_transactions:
                transactions.filter(t => t.status === 'completed').length +
                ap2Transactions.filter(t => t.status === 'completed').length +
                voiceCheckouts.filter(v => v.status === 'completed').length,
            pending_transactions:
                transactions.filter(t => t.status === 'pending').length +
                ap2Transactions.filter(t => t.status === 'pending').length +
                voiceCheckouts.filter(v => v.status === 'pending').length,
            total_revenue: (acpRevenue + ap2Revenue + voiceRevenue).toFixed(2),
            platforms: {
                acp: {
                    transactions: transactions.filter(t => t.platform === 'acp').length,
                    completed: transactions.filter(t => t.platform === 'acp' && t.status === 'completed').length,
                    revenue: acpRevenue.toFixed(2)
                },
                ap2: {
                    transactions: ap2Transactions.length,
                    completed: ap2Transactions.filter(t => t.status === 'completed').length,
                    revenue: ap2Revenue.toFixed(2)
                },
                voice: {
                    transactions: voiceCheckouts.length,
                    completed: voiceCheckouts.filter(v => v.status === 'completed').length,
                    pending: voiceCheckouts.filter(v => v.status === 'pending').length,
                    revenue: voiceRevenue.toFixed(2)
                }
            }
        };

        // Enrich recent transactions with merchant names
        const enrichedTransactions = recentTransactions.map(t => {
            const merchant = db.getMerchant(t.merchant_id);
            return {
                ...t,
                merchant_name: merchant ? merchant.name : 'Unknown'
            };
        });

        res.json({
            success: true,
            stats,
            recent_transactions: enrichedTransactions,
            merchants: merchants.map(m => ({
                id: m.id,
                name: m.name,
                status: m.status,
                enabled_platforms: JSON.parse(m.enabled_platforms),
                api_url: m.api_url,
                created_at: m.created_at
            }))
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get all transactions (all platforms)
 * GET /api/admin/transactions
 */
router.get('/transactions', (req, res) => {
    try {
        const transactions = db.getAllTransactions();
        const voiceCheckouts = db.getAllVoiceCheckouts();

        // Combine all transactions
        const allTransactions = [];

        // Add regular transactions
        transactions.forEach(t => {
            const merchant = db.getMerchant(t.merchant_id);
            allTransactions.push({
                ...t,
                merchant_name: merchant ? merchant.name : 'Unknown',
                source: 'transaction'
            });
        });

        // Add voice checkouts
        voiceCheckouts.forEach(v => {
            const merchant = db.getMerchant(v.merchant_id);
            allTransactions.push({
                id: v.id,
                merchant_id: v.merchant_id,
                merchant_name: merchant ? merchant.name : 'Unknown',
                platform: 'voice',
                customer_email: v.customer_email || v.customer_phone,
                amount: v.amount,
                status: v.status,
                created_at: v.created_at,
                product_id: v.product_id,
                product_name: v.product_name,
                quantity: v.quantity,
                source: 'voice'
            });
        });

        // Sort by date
        allTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json({
            success: true,
            count: allTransactions.length,
            transactions: allTransactions
        });
    } catch (error) {
        console.error('Transactions fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get all active deliveries across all merchants
 * GET /api/admin/deliveries
 * Returns all orders with delivery tracking information
 */
router.get('/deliveries', (req, res) => {
    try {
        const allOrders = db.getAllOrders();
        
        // Filter for orders with delivery tracking
        const deliveries = allOrders
            .filter(order => 
                order.delivery_status && 
                order.delivery_status !== 'pending' &&
                order.delivery_status !== 'cancelled'
            )
            .map(order => {
                const merchant = db.getMerchant(order.merchant_id);
                return {
                    ...order,
                    merchant_name: merchant ? merchant.name : 'Unknown',
                    has_location: !!(order.current_latitude && order.current_longitude),
                    distance_to_delivery: null // Will be calculated if both locations available
                };
            })
            .sort((a, b) => {
                // Sort by: active deliveries first, then by last update
                const aActive = a.delivery_status === 'out_for_delivery' || a.delivery_status === 'in_transit';
                const bActive = b.delivery_status === 'out_for_delivery' || b.delivery_status === 'in_transit';
                
                if (aActive !== bActive) {
                    return aActive ? -1 : 1;
                }
                
                const aTime = a.last_location_update ? new Date(a.last_location_update) : new Date(0);
                const bTime = b.last_location_update ? new Date(b.last_location_update) : new Date(0);
                return bTime - aTime;
            });

        // Group by status
        const byStatus = {
            active: deliveries.filter(d => d.delivery_status === 'out_for_delivery' || d.delivery_status === 'in_transit'),
            delivered: deliveries.filter(d => d.delivery_status === 'delivered'),
            other: deliveries.filter(d => !['out_for_delivery', 'in_transit', 'delivered'].includes(d.delivery_status))
        };

        res.json({
            success: true,
            count: deliveries.length,
            active: byStatus.active.length,
            delivered: byStatus.delivered.length,
            deliveries: deliveries,
            by_status: byStatus
        });
    } catch (error) {
        console.error('❌ Error fetching deliveries:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get delivery analytics
 * GET /api/admin/deliveries/analytics
 * Returns delivery metrics and statistics
 */
router.get('/deliveries/analytics', (req, res) => {
    try {
        const allOrders = db.getAllOrders();
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Filter orders with delivery tracking
        const deliveries = allOrders.filter(order => 
            order.delivery_status && 
            order.delivery_status !== 'pending' &&
            order.delivery_status !== 'cancelled'
        );

        // Calculate metrics
        const totalDeliveries = deliveries.length;
        const activeDeliveries = deliveries.filter(d => 
            d.delivery_status === 'out_for_delivery' || d.delivery_status === 'in_transit'
        ).length;
        const completedDeliveries = deliveries.filter(d => 
            d.delivery_status === 'delivered'
        ).length;

        // Time-based metrics
        const recentDeliveries = deliveries.filter(d => {
            const created = new Date(d.created_at);
            return created >= oneDayAgo;
        });

        const weeklyDeliveries = deliveries.filter(d => {
            const created = new Date(d.created_at);
            return created >= oneWeekAgo;
        });

        const monthlyDeliveries = deliveries.filter(d => {
            const created = new Date(d.created_at);
            return created >= oneMonthAgo;
        });

        // Calculate average delivery time (for completed orders)
        const completedWithTimes = deliveries
            .filter(d => d.delivery_status === 'delivered' && d.created_at && d.completed_at)
            .map(d => {
                const created = new Date(d.created_at);
                const completed = new Date(d.completed_at);
                return (completed - created) / (1000 * 60); // minutes
            });

        const avgDeliveryTimeMinutes = completedWithTimes.length > 0
            ? completedWithTimes.reduce((sum, time) => sum + time, 0) / completedWithTimes.length
            : 0;

        // Auto-confirmation rate
        const autoConfirmed = deliveries.filter(d => {
            // Check if delivery was auto-confirmed (would need to check transaction logs)
            // For now, estimate based on delivery_status and timing
            return d.delivery_status === 'delivered' && d.last_location_update && d.completed_at;
        }).length;

        const autoConfirmRate = completedDeliveries > 0
            ? (autoConfirmed / completedDeliveries) * 100
            : 0;

        // Location update frequency
        const ordersWithUpdates = deliveries.filter(d => d.last_location_update);
        const avgUpdateFrequency = ordersWithUpdates.length > 0
            ? ordersWithUpdates.length / totalDeliveries * 100
            : 0;

        // By merchant
        const byMerchant = {};
        deliveries.forEach(d => {
            const merchantId = d.merchant_id;
            if (!byMerchant[merchantId]) {
                const merchant = db.getMerchant(merchantId);
                byMerchant[merchantId] = {
                    merchant_id: merchantId,
                    merchant_name: merchant ? merchant.name : 'Unknown',
                    total: 0,
                    active: 0,
                    completed: 0
                };
            }
            byMerchant[merchantId].total++;
            if (d.delivery_status === 'out_for_delivery' || d.delivery_status === 'in_transit') {
                byMerchant[merchantId].active++;
            }
            if (d.delivery_status === 'delivered') {
                byMerchant[merchantId].completed++;
            }
        });

        res.json({
            success: true,
            metrics: {
                total_deliveries: totalDeliveries,
                active_deliveries: activeDeliveries,
                completed_deliveries: completedDeliveries,
                recent_24h: recentDeliveries.length,
                recent_7d: weeklyDeliveries.length,
                recent_30d: monthlyDeliveries.length,
                avg_delivery_time_minutes: Math.round(avgDeliveryTimeMinutes),
                auto_confirm_rate_percent: Math.round(autoConfirmRate * 10) / 10,
                location_update_coverage_percent: Math.round(avgUpdateFrequency * 10) / 10
            },
            by_merchant: Object.values(byMerchant),
            time_periods: {
                last_24h: recentDeliveries.length,
                last_7d: weeklyDeliveries.length,
                last_30d: monthlyDeliveries.length
            }
        });
    } catch (error) {
        console.error('❌ Error fetching delivery analytics:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get transaction details
 * GET /api/admin/transactions/:id
 */
router.get('/transactions/:id', (req, res) => {
    try {
        // Try to find in regular transactions first
        let transaction = db.getTransaction(req.params.id);
        let isVoice = false;

        // If not found, try voice checkouts
        if (!transaction) {
            transaction = db.getVoiceCheckout(req.params.id);
            isVoice = true;
        }

        if (!transaction) {
            return res.status(404).json({
                success: false,
                error: 'Transaction not found'
            });
        }

        const merchant = db.getMerchant(transaction.merchant_id);

        // Format response based on transaction type
        const responseData = {
            ...transaction,
            merchant_name: merchant ? merchant.name : 'Unknown',
            merchant_api_url: merchant ? merchant.api_url : null,
            platform: isVoice ? 'voice' : transaction.platform,
            transaction_type: isVoice ? 'voice_checkout' : 'standard'
        };

        // Add voice-specific fields if applicable
        if (isVoice) {
            responseData.customer_phone = transaction.customer_phone;
            responseData.product_name = transaction.product_name;
            responseData.quantity = transaction.quantity;
            responseData.payment_token = transaction.payment_token;
        }

        res.json({
            success: true,
            transaction: responseData
        });
    } catch (error) {
        console.error('Transaction details error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get all merchants with enriched data
 * GET /api/admin/merchants
 */
router.get('/merchants', (req, res) => {
    try {
        const merchants = db.getAllMerchants();

        const enrichedMerchants = merchants.map(m => {
            const transactions = db.getAllTransactions()
                .filter(t => t.merchant_id === m.id);

            const voiceCheckouts = db.getVoiceCheckoutsByMerchant(m.id);

            const syncedProducts = db.getSyncedProducts(m.id, 'acp');

            // Calculate total revenue across all platforms
            const acpRevenue = transactions
                .filter(t => t.status === 'completed')
                .reduce((sum, t) => sum + (t.amount || 0), 0);

            const voiceRevenue = voiceCheckouts
                .filter(v => v.status === 'completed')
                .reduce((sum, v) => sum + (v.amount || 0), 0);

            return {
                ...m,
                enabled_platforms: JSON.parse(m.enabled_platforms),
                transaction_count: transactions.length + voiceCheckouts.filter(v => v.status === 'completed').length,
                voice_checkouts: voiceCheckouts.length,
                product_count: syncedProducts.length,
                total_revenue: (acpRevenue + voiceRevenue).toFixed(2),
                platform_breakdown: {
                    acp: {
                        transactions: transactions.filter(t => t.platform === 'acp').length,
                        revenue: transactions
                            .filter(t => t.platform === 'acp' && t.status === 'completed')
                            .reduce((sum, t) => sum + (t.amount || 0), 0)
                            .toFixed(2)
                    },
                    voice: {
                        transactions: voiceCheckouts.length,
                        completed: voiceCheckouts.filter(v => v.status === 'completed').length,
                        revenue: voiceRevenue.toFixed(2)
                    }
                }
            };
        });

        res.json({
            success: true,
            count: enrichedMerchants.length,
            merchants: enrichedMerchants
        });
    } catch (error) {
        console.error('Merchants fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get merchant details with all transactions
 * GET /api/admin/merchants/:id
 */
router.get('/merchants/:id', (req, res) => {
    try {
        const merchant = db.getMerchant(req.params.id);

        if (!merchant) {
            return res.status(404).json({
                success: false,
                error: 'Merchant not found'
            });
        }

        const transactions = db.getAllTransactions()
            .filter(t => t.merchant_id === merchant.id);

        const voiceCheckouts = db.getVoiceCheckoutsByMerchant(merchant.id);

        const syncedProducts = db.getSyncedProducts(merchant.id, 'acp');

        // Calculate revenue
        const acpRevenue = transactions
            .filter(t => t.status === 'completed')
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        const voiceRevenue = voiceCheckouts
            .filter(v => v.status === 'completed')
            .reduce((sum, v) => sum + (v.amount || 0), 0);

        // Combine recent transactions
        const allRecentTransactions = [
            ...transactions.slice(0, 5),
            ...voiceCheckouts.filter(v => v.status === 'completed').slice(0, 5)
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 10);

        res.json({
            success: true,
            merchant: {
                ...merchant,
                enabled_platforms: JSON.parse(merchant.enabled_platforms),
                transaction_count: transactions.length + voiceCheckouts.filter(v => v.status === 'completed').length,
                voice_checkouts_count: voiceCheckouts.length,
                product_count: syncedProducts.length,
                total_revenue: (acpRevenue + voiceRevenue).toFixed(2)
            },
            recent_transactions: allRecentTransactions,
            voice_checkouts: voiceCheckouts.slice(0, 10),
            products: syncedProducts.map(sp => JSON.parse(sp.product_data)).slice(0, 20)
        });
    } catch (error) {
        console.error('Merchant details error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get voice-specific analytics
 * GET /api/admin/voice/analytics
 */
router.get('/voice/analytics', (req, res) => {
    try {
        const voiceCheckouts = db.getAllVoiceCheckouts();

        const analytics = {
            total_checkouts: voiceCheckouts.length,
            completed: voiceCheckouts.filter(v => v.status === 'completed').length,
            pending: voiceCheckouts.filter(v => v.status === 'pending').length,
            failed: voiceCheckouts.filter(v => v.status === 'failed').length,
            total_revenue: voiceCheckouts
                .filter(v => v.status === 'completed')
                .reduce((sum, v) => sum + (v.amount || 0), 0)
                .toFixed(2),
            average_order_value: voiceCheckouts.length > 0
                ? (voiceCheckouts
                    .filter(v => v.status === 'completed')
                    .reduce((sum, v) => sum + (v.amount || 0), 0) /
                    voiceCheckouts.filter(v => v.status === 'completed').length)
                    .toFixed(2)
                : '0.00',
            conversion_rate: voiceCheckouts.length > 0
                ? ((voiceCheckouts.filter(v => v.status === 'completed').length / voiceCheckouts.length) * 100).toFixed(2) + '%'
                : '0%'
        };

        res.json({
            success: true,
            analytics,
            recent_checkouts: voiceCheckouts.slice(0, 20)
        });
    } catch (error) {
        console.error('Voice analytics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get all customers
 * GET /api/admin/customers
 */
router.get('/customers', (req, res) => {
    try {
        const customers = db.db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all();
        res.json({
            success: true,
            customers: customers
        });
    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get incomplete signups
 * GET /api/admin/incomplete-signups
 */
router.get('/incomplete-signups', (req, res) => {
    try {
        const incomplete = db.db.prepare(`
            SELECT * FROM incomplete_signups 
            WHERE is_completed = 0 
            ORDER BY signup_started_at DESC
        `).all();
        res.json({
            success: true,
            incomplete_signups: incomplete
        });
    } catch (error) {
        console.error('Get incomplete signups error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Allocate credits to a customer
 * POST /api/admin/customers/:customer_id/credits
 * Body: { credits: number }
 */
router.post('/customers/:customer_id/credits', (req, res) => {
    try {
        const { customer_id } = req.params;
        const { credits } = req.body;

        if (!credits || credits < 1) {
            return res.status(400).json({
                success: false,
                error: 'Invalid credits amount'
            });
        }

        const customer = db.getCustomer(customer_id);
        if (!customer) {
            return res.status(404).json({
                success: false,
                error: 'Customer not found'
            });
        }

        // Allocate free credits
        db.allocateFreeCredits(customer_id, credits);

        console.log(`✅ Admin allocated ${credits} credits to customer ${customer_id}`);

        res.json({
            success: true,
            message: `Successfully allocated ${credits} credits`,
            credits_allocated: credits
        });
    } catch (error) {
        console.error('Allocate credits error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;