const express = require('express');
const router = express.Router();
const db = require('../database');
const constants = require('../utils/constants');
const RetellService = require('../services/retell-service');
const { hasValidSession } = require('../middleware/admin-auth');
const { optionalCustomerAuth } = require('../middleware/customer-auth');
const { updateAgentLifecycleState } = require('../services/agent-lifecycle');

const retellService = new RetellService();

/**
 * Resolve merchant + customer for voice settings.
 * Authenticated customers without merchant_id must NOT fall back to default subdomain.
 */
function resolveVoiceSettingsContext(req) {
    let merchantId = req.query.merchant_id || req.body?.merchant_id || null;
    let customerId = req.customer?.id || req.body?.customer_id || null;

    if (!merchantId && req.customer?.merchant_id) {
        merchantId = req.customer.merchant_id;
    }

    if (!merchantId && req.tenant && req.tenant.merchant) {
        merchantId = req.tenant.merchant.id;
    } else if (!merchantId && req.tenant && req.tenant.clinic && req.tenant.clinic.merchant_id) {
        merchantId = req.tenant.clinic.merchant_id;
    }

    if (!merchantId && !customerId && req.customer) {
        customerId = req.customer.id;
    }

    // Unauthenticated / unresolved only — never use default shop for logged-in SaaS owner
    if (!merchantId && !customerId && !req.customer) {
        const defaultSubdomain = constants.TENANTS.DEFAULT_SUBDOMAIN || 'akin-dunbar';
        const defaultMerchant = db.getMerchantBySubdomain(defaultSubdomain);
        if (defaultMerchant) {
            merchantId = defaultMerchant.id;
        }
    }

    return { merchantId, customerId };
}

function requireVoiceSettingsAccess(req, res, next) {
    if (hasValidSession(req) || req.customer) return next();
    return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Sign in to access voice agent settings.'
    });
}

function parseSettingsRow(settings, { merchantId, customerId }) {
    const row = settings || {
        merchant_id: merchantId || (customerId ? db.customerVoiceSettingsMerchantKey(customerId) : null),
        customer_id: customerId || null,
        enabled: 1,
        greeting: null,
        after_hours_message: null,
        business_hours: null,
        retell_agent_id: null,
        prompt_synced_at: null
    };
    if (row.business_hours && typeof row.business_hours === 'string') {
        try {
            row.business_hours = JSON.parse(row.business_hours);
        } catch (_) {
            row.business_hours = null;
        }
    }
    return row;
}

router.get('/settings', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const { merchantId, customerId } = resolveVoiceSettingsContext(req);
        if (!merchantId && !customerId) {
            return res.status(400).json({
                success: false,
                error: 'tenant_required',
                message: 'Unable to resolve provider for voice settings.'
            });
        }

        const settings = db.getVoiceAgentSettingsForProvider({ merchantId, customerId });
        const row = parseSettingsRow(settings, { merchantId, customerId });
        const customer = customerId ? db.getCustomer(customerId) : req.customer;
        if (customer?.prompt_synced_at) {
            row.prompt_synced_at = customer.prompt_synced_at;
        }

        return res.json({
            success: true,
            settings: row
        });
    } catch (error) {
        console.error('Voice agent settings GET error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.post('/settings', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const { merchantId, customerId } = resolveVoiceSettingsContext(req);
        if (!merchantId && !customerId) {
            return res.status(400).json({
                success: false,
                error: 'tenant_required',
                message: 'Unable to resolve provider for voice settings.'
            });
        }

        const {
            retell_agent_id = null,
            enabled = true,
            greeting = null,
            after_hours_message = null,
            business_hours = null
        } = req.body || {};

        const safeEnabled = !!enabled;
        const normalizedHours = business_hours && typeof business_hours === 'object'
            ? business_hours
            : null;

        const agentId = retell_agent_id ||
            (customerId && db.getCustomer(customerId)?.retell_agent_id) ||
            null;

        if (agentId) {
            try {
                const result = await retellService.applyAgentSettings({
                    agentId,
                    enabled: safeEnabled,
                    greeting,
                    business_hours: normalizedHours,
                    after_hours_message
                });
                if (result && result.success === false) {
                    return res.status(502).json({
                        success: false,
                        error: 'retell_sync_failed',
                        message: result.error || 'Voice provider rejected settings update'
                    });
                }
            } catch (retellError) {
                console.error('Retell applyAgentSettings failed:', retellError.message);
                return res.status(502).json({
                    success: false,
                    error: 'retell_sync_failed',
                    message: retellError.message || 'Could not update voice provider'
                });
            }
        }

        db.upsertVoiceAgentSettings(merchantId, {
            retell_agent_id: agentId,
            enabled: safeEnabled,
            greeting,
            after_hours_message,
            business_hours: normalizedHours
        }, customerId);

        const syncedAt = new Date().toISOString();
        if (customerId) {
            db.updateCustomer(customerId, { prompt_synced_at: syncedAt });
            updateAgentLifecycleState(customerId, {
                enabled: safeEnabled,
                kelly: safeEnabled ? 'active' : 'paused',
                retell: safeEnabled ? 'active' : 'paused'
            });
        }

        return res.json({
            success: true,
            message: agentId
                ? 'Voice agent settings saved and synced with voice provider'
                : 'Voice agent settings saved (no Retell agent linked)',
            merchant_id: merchantId || null,
            customer_id: customerId || null,
            prompt_synced_at: syncedAt
        });
    } catch (error) {
        console.error('Voice agent settings POST error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.post('/setup-complete', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        let customer = req.customer;
        if (!customer) {
            const sessionId = req.cookies?.customer_session;
            const session = sessionId ? db.getCustomerSession(sessionId) : null;
            customer = session ? db.getCustomer(session.customer_id) : null;
        }
        if (!customer) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const updates = {
            voice_setup_completed_at: new Date().toISOString()
        };
        if (!customer.custom_prompt) {
            try {
                const VoicePromptTemplates = require('../services/voice-prompt-templates');
                const defaultPrompt = VoicePromptTemplates.getDefaultCustomPrompt(customer);
                if (defaultPrompt) {
                    updates.custom_prompt = defaultPrompt;
                }
            } catch (_) {}
        }
        db.updateCustomer(customer.id, updates);
        return res.json({ success: true, message: 'Voice setup marked complete' });
    } catch (error) {
        console.error('Voice setup complete error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

module.exports = router;
