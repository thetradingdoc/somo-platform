/**
 * USAGE MONITOR ROUTES
 * API endpoints for viewing tenant usage and billing
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const UsageMonitor = require('../services/usage-monitor');
const { requireAdminAuth } = require('../middleware/admin-auth');

// Middleware to get customer from session
function getCustomerFromSession(req) {
  const sessionId = req.cookies?.customer_session;
  if (!sessionId) return null;
  
  const session = db.getCustomerSession(sessionId);
  if (!session) return null;
  
  return db.getCustomer(session.customer_id);
}

/**
 * GET /api/usage/current
 * Get current month usage for authenticated tenant
 */
router.get('/current', (req, res) => {
  try {
    const customer = getCustomerFromSession(req);
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const usage = UsageMonitor.getMonthlyUsage(customer.id, customer.merchant_id, year, month);
    const credits = UsageMonitor.getCreditBalance(customer.id);
    
    if (!usage) {
      return res.status(500).json({ success: false, error: 'Failed to get usage data' });
    }

    res.json({
      success: true,
      usage: usage,
      credits: credits
    });
  } catch (error) {
    console.error('❌ Error getting current usage:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/usage/monthly/:year/:month
 * Get usage for specific month
 */
router.get('/monthly/:year/:month', (req, res) => {
  try {
    const customer = getCustomerFromSession(req);
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ success: false, error: 'Invalid year or month' });
    }

    const usage = UsageMonitor.getMonthlyUsage(customer.id, customer.merchant_id, year, month);
    const credits = UsageMonitor.getCreditBalance(customer.id);
    
    if (!usage) {
      return res.status(500).json({ success: false, error: 'Failed to get usage data' });
    }

    res.json({
      success: true,
      usage: usage,
      credits: credits
    });
  } catch (error) {
    console.error('❌ Error getting monthly usage:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/usage/credits
 * Get current credit balance for authenticated tenant
 * Query param: customer_id (for admin access)
 */
router.get('/credits', (req, res) => {
  try {
    let customerId = null;
    
    // Check if customer_id is provided (for admin access)
    if (req.query.customer_id) {
      customerId = req.query.customer_id;
    } else {
      // Otherwise, get from session
      const customer = getCustomerFromSession(req);
      if (!customer) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }
      customerId = customer.id;
    }

    const credits = UsageMonitor.getCreditBalance(customerId);

    res.json({
      success: true,
      credits: credits
    });
  } catch (error) {
    console.error('❌ Error getting credit balance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/usage/billing/current
 * Get current month billing breakdown
 */
router.get('/billing/current', (req, res) => {
  try {
    const customer = getCustomerFromSession(req);
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const billing = UsageMonitor.calculateMonthlyBilling(customer.id, customer.merchant_id, year, month);
    
    if (!billing) {
      return res.status(500).json({ success: false, error: 'Failed to calculate billing' });
    }

    res.json({
      success: true,
      billing: billing
    });
  } catch (error) {
    console.error('❌ Error getting current billing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/usage/billing/:year/:month
 * Get billing for specific month
 */
router.get('/billing/:year/:month', (req, res) => {
  try {
    const customer = getCustomerFromSession(req);
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ success: false, error: 'Invalid year or month' });
    }

    const billing = UsageMonitor.calculateMonthlyBilling(customer.id, customer.merchant_id, year, month);
    
    if (!billing) {
      return res.status(500).json({ success: false, error: 'Failed to calculate billing' });
    }

    res.json({
      success: true,
      billing: billing
    });
  } catch (error) {
    console.error('❌ Error getting monthly billing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/usage/generate-billing
 * Generate monthly billing for all tenants (Admin only) — A-1: require admin auth
 * Body: { year, month }
 */
router.post('/generate-billing', requireAdminAuth, (req, res) => {
  try {
    const { year, month } = req.body;

    if (!year || !month) {
      return res.status(400).json({ success: false, error: 'Year and month required' });
    }

    const results = UsageMonitor.generateMonthlyBillingForAll(year, month);

    res.json({
      success: true,
      message: `Generated billing for ${results.length} tenants`,
      results: results
    });
  } catch (error) {
    console.error('❌ Error generating billing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/usage-monitor/analytics
 * Get credit usage history and analytics
 */
router.get('/analytics', (req, res) => {
  try {
    const customer = getCustomerFromSession(req);
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const days = parseInt(req.query.days) || 30;
    const history = db.getCreditUsageHistory(customer.id, days);
    const credits = db.getCustomerCredits(customer.id);

    // Calculate trends
    const totalMinutesUsed = history.reduce((sum, h) => sum + (h.voice_minutes_used || 0), 0);
    const totalFreeUsed = history.reduce((sum, h) => sum + (h.free_credits_used || 0), 0);
    const totalOverage = history.reduce((sum, h) => sum + (h.overage_voice_minutes || 0), 0);
    const avgDailyUsage = history.length > 0 ? totalMinutesUsed / history.length : 0;

    res.json({
      success: true,
      analytics: {
        history: history,
        summary: {
          totalMinutesUsed,
          totalFreeUsed,
          totalOverage,
          avgDailyUsage: Math.round(avgDailyUsage * 10) / 10,
          daysTracked: history.length
        },
        currentCredits: credits ? {
          balance: credits.credits_balance_minutes,
          freeRemaining: credits.free_credits_allocated - credits.free_credits_used,
          paidRemaining: credits.paid_credits_purchased - credits.paid_credits_used,
          freeExpiresAt: credits.free_credits_expires_at
        } : null
      }
    });
  } catch (error) {
    console.error('❌ Error getting analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/usage-monitor/credit-packages
 * Get available credit purchase packages
 */
router.get('/credit-packages', (req, res) => {
  try {
    const packages = [
      {
        id: 'starter',
        name: 'Starter Pack',
        credits: 500,
        price: 49.99,
        pricePerMinute: 0.10,
        description: 'Perfect for small practices'
      },
      {
        id: 'professional',
        name: 'Professional Pack',
        credits: 1500,
        price: 119.99,
        pricePerMinute: 0.08,
        description: 'Best value for growing practices',
        popular: true
      },
      {
        id: 'enterprise',
        name: 'Enterprise Pack',
        credits: 5000,
        price: 299.99,
        pricePerMinute: 0.06,
        description: 'Maximum savings for high-volume practices'
      }
    ];

    res.json({
      success: true,
      packages: packages
    });
  } catch (error) {
    console.error('❌ Error getting credit packages:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/usage-monitor/check-low-credits
 * Check and send low credit alerts (for cron job)
 * Requires admin secret or can be called internally
 */
router.post('/check-low-credits', (req, res) => {
  try {
    // Simple admin check - can be enhanced
    const adminSecret = req.headers['x-admin-secret'] || req.body.admin_secret;
    if (adminSecret !== process.env.ADMIN_PORTAL_SECRET) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Expire old free credits first
    const expired = db.expireFreeCredits();
    
    // Get customers needing alerts
    const customersNeedingAlerts = db.getCustomersNeedingLowCreditAlert();
    const EmailService = require('../services/email-service');
    
    const alertsSent = [];
    const alertsFailed = [];

    // Send alerts (async but don't wait)
    Promise.all(customersNeedingAlerts.map(async (customer) => {
      try {
        const merchant = db.getMerchant(customer.merchant_id);
        const subdomain = merchant?.subdomain;
        
        await EmailService.sendLowCreditAlert(
          customer.email,
          customer.name || 'Valued Customer',
          customer.credits_balance_minutes,
          subdomain
        );
        
        db.markLowCreditAlertSent(customer.id);
        alertsSent.push({ customerId: customer.id, email: customer.email });
      } catch (error) {
        console.error(`❌ Failed to send alert to ${customer.email}:`, error);
        alertsFailed.push({ customerId: customer.id, email: customer.email, error: error.message });
      }
    })).catch(err => {
      console.error('❌ Error in alert sending:', err);
    });

    res.json({
      success: true,
      message: `Processed ${customersNeedingAlerts.length} customers`,
      expired: expired.length,
      alertsSent: alertsSent.length,
      alertsFailed: alertsFailed.length,
      details: {
        expired,
        alertsSent,
        alertsFailed
      }
    });
  } catch (error) {
    console.error('❌ Error checking low credits:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

