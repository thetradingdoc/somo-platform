/**
 * MERCHANT ROUTES
 * API for merchants to register and sync their products
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const crypto = require('crypto');
const db = require('../database');
const UniversalAdapter = require('../adapters/universal-adapter');
const { withProviderAliases, logAliasUsage } = require('../utils/naming-aliases');

const router = express.Router();

const ALLOWED_PLATFORMS = ['acp', 'ap2'];

/**
 * Safe JSON parse helper
 */
function safeParse(data) {
    if (!data) return null;
    if (typeof data === 'object') return data;

    try {
        const parsed = JSON.parse(data);
        // Check if we need to parse again (double-stringified)
        if (typeof parsed === 'string') {
            return JSON.parse(parsed);
        }
        return parsed;
    } catch (err) {
        return null;
    }
}

/**
 * Get merchant details (customer-facing, requires auth)
 * GET /api/merchant/me
 */
router.get('/me', async (req, res) => {
  try {
    logAliasUsage('merchant-me', req);
    // Get customer from session
    const cookies = req.headers.cookie || '';
    const sessionMatch = cookies.match(/customer_session=([^;]+)/);
    
    if (!sessionMatch) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const sessionId = sessionMatch[1];
    const session = require('../database').getCustomerSession(sessionId);
    
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }
    
    const customer = require('../database').getCustomer(session.customer_id);
    
    if (!customer || !customer.merchant_id) {
      return res.status(404).json({
        success: false,
        error: 'No merchant associated',
        message: 'Your account is not associated with a merchant. Please complete onboarding.'
      });
    }
    
    const merchant = require('../database').getMerchant(customer.merchant_id);
    
    if (!merchant) {
      return res.status(404).json({
        success: false,
        error: 'Merchant not found'
      });
    }
    
    // Parse enabled_platforms if it's a JSON string
    let enabledPlatforms = merchant.enabled_platforms;
    if (typeof enabledPlatforms === 'string') {
      try {
        enabledPlatforms = JSON.parse(enabledPlatforms);
      } catch (e) {
        enabledPlatforms = [];
      }
    }
    
    const payload = {
      success: true,
      merchant: {
        id: merchant.id,
        name: merchant.name,
        api_key: merchant.api_key, // Return full key for customer's own merchant
        api_url: merchant.api_url,
        webhook_url: merchant.webhook_url,
        enabled_platforms: enabledPlatforms,
        status: merchant.status,
        created_at: merchant.created_at
      }
    };
    return res.json(withProviderAliases({ ...payload, provider: payload.merchant }, merchant.id));
  } catch (error) {
    console.error('❌ Error getting merchant:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PATCH /api/merchant/me
 * Update merchant fields editable from settings.
 */
router.patch('/me', async (req, res) => {
  try {
    logAliasUsage('merchant-patch-me', req);
    const cookies = req.headers.cookie || '';
    const sessionMatch = cookies.match(/customer_session=([^;]+)/);
    if (!sessionMatch) return res.status(401).json({ success: false, error: 'Authentication required' });
    const session = require('../database').getCustomerSession(sessionMatch[1]);
    if (!session) return res.status(401).json({ success: false, error: 'Invalid session' });
    const customer = require('../database').getCustomer(session.customer_id);
    if (!customer?.merchant_id) return res.status(404).json({ success: false, error: 'No merchant associated' });
    const merchant = require('../database').getMerchant(customer.merchant_id);
    if (!merchant) return res.status(404).json({ success: false, error: 'Merchant not found' });

    const updates = {};
    if (typeof req.body?.name === 'string') updates.name = req.body.name.trim().slice(0, 200);
    if (typeof req.body?.webhook_url === 'string') {
      const v = req.body.webhook_url.trim();
      if (v) {
        try { new URL(v); } catch (_) { return res.status(400).json({ success: false, error: 'Invalid webhook URL' }); }
      }
      updates.webhook_url = v || null;
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: 'No editable fields provided' });
    }

    const setParts = [];
    const values = [];
    Object.entries(updates).forEach(([k, v]) => { setParts.push(`${k} = ?`); values.push(v); });
    values.push(merchant.id);
    db.db.prepare(`UPDATE merchants SET ${setParts.join(', ')} WHERE id = ?`).run(...values);

    const fresh = require('../database').getMerchant(merchant.id);
    const payload = {
      success: true,
      merchant: {
        id: fresh.id,
        name: fresh.name,
        api_key: fresh.api_key,
        api_url: fresh.api_url,
        webhook_url: fresh.webhook_url,
        enabled_platforms: fresh.enabled_platforms,
        status: fresh.status
      }
    };
    return res.json(withProviderAliases({ ...payload, provider: payload.merchant }, fresh.id));
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/merchant/me/regenerate-api-key
 * Regenerate merchant API key (invalidates previous key)
 */
router.post('/me/regenerate-api-key', async (req, res) => {
  try {
    logAliasUsage('merchant-regenerate-key', req);
    const cookies = req.headers.cookie || '';
    const sessionMatch = cookies.match(/customer_session=([^;]+)/);
    if (!sessionMatch) return res.status(401).json({ success: false, error: 'Authentication required' });
    const session = require('../database').getCustomerSession(sessionMatch[1]);
    if (!session) return res.status(401).json({ success: false, error: 'Invalid session' });
    const customer = require('../database').getCustomer(session.customer_id);
    if (!customer?.merchant_id) return res.status(404).json({ success: false, error: 'No merchant associated' });
    const merchant = require('../database').getMerchant(customer.merchant_id);
    if (!merchant) return res.status(404).json({ success: false, error: 'Merchant not found' });

    const newApiKey = `mk_${crypto.randomBytes(32).toString('hex')}`;
    db.db.prepare('UPDATE merchants SET api_key = ? WHERE id = ?').run(newApiKey, merchant.id);

    const fresh = require('../database').getMerchant(merchant.id);
    const payload = {
      success: true,
      message: 'API key regenerated. Update your applications with the new key.',
      merchant: {
        id: fresh.id,
        name: fresh.name,
        api_key: fresh.api_key,
        api_url: fresh.api_url,
        webhook_url: fresh.webhook_url,
        enabled_platforms: fresh.enabled_platforms,
        status: fresh.status
      }
    };
    return res.json(withProviderAliases({ ...payload, provider: payload.merchant }, fresh.id));
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/merchant/me/test-webhook
 * Send a test payload to the configured webhook URL
 */
router.post('/me/test-webhook', async (req, res) => {
  try {
    const cookies = req.headers.cookie || '';
    const sessionMatch = cookies.match(/customer_session=([^;]+)/);
    if (!sessionMatch) return res.status(401).json({ success: false, error: 'Authentication required' });
    const session = require('../database').getCustomerSession(sessionMatch[1]);
    if (!session) return res.status(401).json({ success: false, error: 'Invalid session' });
    const customer = require('../database').getCustomer(session.customer_id);
    if (!customer?.merchant_id) return res.status(404).json({ success: false, error: 'No merchant associated' });
    const merchant = require('../database').getMerchant(customer.merchant_id);
    if (!merchant) return res.status(404).json({ success: false, error: 'Merchant not found' });

    const webhookUrl = merchant.webhook_url;
    if (!webhookUrl || !webhookUrl.trim()) {
      return res.status(400).json({ success: false, error: 'No webhook URL configured. Please set a webhook URL first.' });
    }

    const testPayload = {
      type: 'test',
      event: 'webhook_test',
      timestamp: new Date().toISOString(),
      merchant_id: merchant.id,
      message: 'This is a test webhook from DocLittle settings. If you receive this, your webhook is configured correctly.'
    };

    const axiosRes = await axios.post(webhookUrl.trim(), testPayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
      validateStatus: () => true
    });

    if (axiosRes.status >= 200 && axiosRes.status < 300) {
      return res.json({
        success: true,
        message: `Test webhook sent. Endpoint returned ${axiosRes.status}.`,
        status: axiosRes.status
      });
    }

    return res.status(400).json({
      success: false,
      error: `Webhook endpoint returned ${axiosRes.status}. Check your server logs.`,
      status: axiosRes.status
    });
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return res.status(400).json({
        success: false,
        error: 'Could not reach webhook URL. Check that the URL is correct and your server is running.'
      });
    }
    return res.status(500).json({ success: false, error: error.message || 'Failed to send test webhook' });
  }
});

/**
 * Register a new merchant
 * POST /api/merchant/register
 */
router.post('/register', async (req, res) => {
    try {
        logAliasUsage('merchant-register', req);
        const { name, api_url, webhook_url, enabled_platforms } = req.body;

        if (!name || !api_url) {
            return res.status(400).json({
                success: false,
                error: 'Name and API URL are required'
            });
        }

        // Generate unique API key for merchant
        const apiKey = `mk_${crypto.randomBytes(32).toString('hex')}`;

        // sanitize incoming enabled platforms (whitelist)
        let platforms = ['acp']; // default
        if (Array.isArray(enabled_platforms) && enabled_platforms.length > 0) {
            platforms = enabled_platforms
                .map(p => String(p).toLowerCase().trim())
                .filter(p => ALLOWED_PLATFORMS.includes(p));
            if (platforms.length === 0) platforms = ['acp'];
        }

        const merchant = {
            id: uuidv4(),
            name,
            api_key: apiKey,
            api_url,
            webhook_url,
            enabled_platforms: platforms
        };

        db.createMerchant(merchant);

        const payload = {
            success: true,
            message: 'Merchant registered successfully',
            merchant: {
                id: merchant.id,
                name: merchant.name,
                api_key: apiKey,
                enabled_platforms: merchant.enabled_platforms
            }
        };
        res.json(withProviderAliases({ ...payload, provider: payload.merchant }, merchant.id));
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Sync merchant products to AI platforms
 * POST /api/merchant/sync
 */
router.post('/sync', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API key required'
            });
        }

        const merchant = db.getMerchantByApiKey(apiKey);

        if (!merchant) {
            return res.status(401).json({
                success: false,
                error: 'Invalid API key'
            });
        }

        // Fetch products from merchant's API (normalize trailing slash)
        const response = await axios.get(`${merchant.api_url.replace(/\/$/, '')}/api/products`);
        const merchantProducts = response.data.products || [];

        const syncResults = [];

        for (const product of merchantProducts) {
            // Convert to a universal internal format first
            const universalProduct = UniversalAdapter.toUniversalFormat(product);

            // Per-platform conversions
            const acpProduct = UniversalAdapter.toACPFormat(universalProduct);
            const ap2Product = UniversalAdapter.toAP2Format(universalProduct);

            // Store sync records for each enabled platform
            if (merchant.enabled_platforms.includes('acp')) {
                const syncAcp = {
                    id: uuidv4(),
                    merchant_id: merchant.id,
                    merchant_product_id: product.id,
                    platform: 'acp',
                    platform_product_id: acpProduct.id || product.id,
                    sync_status: 'synced',
                    product_data: acpProduct, // Pass object directly
                    universal_data: universalProduct // Pass object directly
                };
                db.syncProduct(syncAcp);
            }

            if (merchant.enabled_platforms.includes('ap2')) {
                const syncAp2 = {
                    id: uuidv4(),
                    merchant_id: merchant.id,
                    merchant_product_id: product.id,
                    platform: 'ap2',
                    platform_product_id: ap2Product.id || product.id,
                    sync_status: 'synced',
                    product_data: ap2Product, // Pass object directly
                    universal_data: universalProduct // Pass object directly
                };
                db.syncProduct(syncAp2);
            }

            syncResults.push({
                merchant_product_id: product.id,
                universal: universalProduct,
                acp: acpProduct,
                ap2: ap2Product
            });
        }

        res.json({
            success: true,
            message: `Synced ${syncResults.length} products (per-platform records created)`,
            products: syncResults,
            protocols_supported: merchant.enabled_platforms
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get merchant's synced products (admin API)
 * GET /api/merchant/products
 * Optional query param: ?platform=acp|ap2   (default acp)
 */
router.get('/products', (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];
        const requestedPlatform = (req.query.platform || 'acp').toLowerCase();

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API key required'
            });
        }

        const merchant = db.getMerchantByApiKey(apiKey);

        if (!merchant) {
            return res.status(401).json({
                success: false,
                error: 'Invalid API key'
            });
        }

        const platform = ALLOWED_PLATFORMS.includes(requestedPlatform) ? requestedPlatform : 'acp';

        const syncedProducts = db.getSyncedProducts(merchant.id, platform);
        const products = syncedProducts
            .map(sp => safeParse(sp.product_data))
            .filter(Boolean);

        res.json({
            success: true,
            merchant: merchant.name,
            platform,
            product_count: products.length,
            products
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;