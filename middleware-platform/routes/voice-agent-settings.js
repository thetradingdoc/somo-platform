const express = require('express');
const router = express.Router();
const db = require('../database');
const constants = require('../utils/constants');
const RetellService = require('../services/retell-service');
const { requireAdminAuth } = require('../middleware/admin-auth');

const retellService = new RetellService();

function resolveMerchant(req) {
    let merchantId = req.query.merchant_id || req.body?.merchant_id || null;

    if (!merchantId && req.tenant && req.tenant.merchant) {
        merchantId = req.tenant.merchant.id;
    } else if (!merchantId && req.tenant && req.tenant.clinic && req.tenant.clinic.merchant_id) {
        merchantId = req.tenant.clinic.merchant_id;
    }

    if (!merchantId) {
        const defaultSubdomain = constants.TENANTS.DEFAULT_SUBDOMAIN || 'akin-dunbar';
        const defaultMerchant = db.getMerchantBySubdomain(defaultSubdomain);
        if (defaultMerchant) {
            merchantId = defaultMerchant.id;
        }
    }

    return merchantId;
}

router.get('/settings', requireAdminAuth, async (req, res) => {
    try {
        const merchantId = resolveMerchant(req);
        if (!merchantId) {
            return res.status(400).json({ success: false, error: 'merchant_id_required', message: 'Unable to resolve merchant.' });
        }

        const settings = db.getVoiceAgentSettings(merchantId) || {
            merchant_id: merchantId,
            enabled: 1,
            greeting: null,
            after_hours_message: null,
            business_hours: null,
            retell_agent_id: null
        };

        // Parse business hours if stored as string
        if (settings.business_hours && typeof settings.business_hours === 'string') {
            try {
                settings.business_hours = JSON.parse(settings.business_hours);
            } catch (_) {
                settings.business_hours = null;
            }
        }

        return res.json({ success: true, settings });
    } catch (error) {
        console.error('Voice agent settings GET error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.post('/settings', requireAdminAuth, async (req, res) => {
    try {
        const merchantId = resolveMerchant(req);
        if (!merchantId) {
            return res.status(400).json({ success: false, error: 'merchant_id_required', message: 'Unable to resolve merchant.' });
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

        db.upsertVoiceAgentSettings(merchantId, {
            retell_agent_id,
            enabled: safeEnabled,
            greeting,
            after_hours_message,
            business_hours: normalizedHours
        });

        // Optional: attempt to push to Retell (best-effort)
        try {
            if (retell_agent_id) {
                await retellService.applyAgentSettings({
                    agentId: retell_agent_id,
                    enabled: safeEnabled,
                    greeting,
                    business_hours: normalizedHours,
                    after_hours_message
                });
            }
        } catch (retellError) {
            console.warn('Retell applyAgentSettings warning:', retellError.message);
        }

        return res.json({ success: true, message: 'Voice agent settings saved', merchant_id: merchantId });
    } catch (error) {
        console.error('Voice agent settings POST error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

module.exports = router;

