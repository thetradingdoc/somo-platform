const express = require('express');
const router = express.Router();
const db = require('../database');
const constants = require('../utils/constants');
const RetellService = require('../services/retell-service');
const { hasValidSession } = require('../middleware/admin-auth');
const { optionalCustomerAuth } = require('../middleware/customer-auth');
const { updateAgentLifecycleState } = require('../services/agent-lifecycle');
const { ensureCustomerRetellAgent } = require('../services/ensure-retell-agent');
const {
  getOnboardingState,
  transitionState,
  resolveOnboardingDestination
} = require('../services/voice-onboarding-state');
const {
  resolveCallOpeners,
  resolvePracticeDisplayName
} = require('../services/call-opener-resolver');
const {
  saveAndSyncVoiceSettings,
  normalizeSettingsRow
} = require('../services/voice-settings-sync');
const { resolveVoiceMerchantId } = require('../services/operator-tenant-bootstrap');

const retellService = new RetellService();

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

    if (!merchantId && req.customer) {
        merchantId = resolveVoiceMerchantId(db, req.customer) || merchantId;
    }

    if (req.customer && !merchantId && !customerId) {
        return { merchantId: null, customerId: null, tenantError: true };
    }

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

function getSessionCustomer(req) {
    if (req.customer) return req.customer;
    const sessionId = req.cookies?.customer_session;
    const session = sessionId ? db.getCustomerSession(sessionId) : null;
    return session ? db.getCustomer(session.customer_id) : null;
}

function parseSettingsRow(settings, { merchantId, customerId }) {
    const row = normalizeSettingsRow(settings) || {
        merchant_id: merchantId || (customerId ? db.customerVoiceSettingsMerchantKey(customerId) : null),
        customer_id: customerId || null,
        enabled: 1,
        greeting: null,
        inbound_greeting: null,
        after_hours_message: null,
        business_hours: null,
        retell_agent_id: null,
        outbound_opener: null,
        outbound_enabled: false,
        outbound_quiet_hours: null,
        outbound_allowed_types: [],
        settings_version: 1,
        sync_status: 'synced',
        synced_at: null,
        last_sync_error: null,
        tone_preset: 'warm',
        prompt_synced_at: null
    };
    return row;
}

async function loadSettingsBundle(ctx) {
    const { merchantId, customerId } = ctx;
    const settings = db.getVoiceAgentSettingsForProvider({ merchantId, customerId });
    const row = parseSettingsRow(settings, { merchantId, customerId });
    const customer = customerId ? db.getCustomer(customerId) : null;
    if (customer?.prompt_synced_at) {
        row.prompt_synced_at = customer.prompt_synced_at;
    }
    if (!row.retell_agent_id && customer?.retell_agent_id) {
        row.retell_agent_id = customer.retell_agent_id;
    }
    return { row, customer };
}

router.get('/onboarding', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const customer = getSessionCustomer(req);
        if (!customer) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const destination = resolveOnboardingDestination(customer);
        return res.json({
            success: true,
            onboarding_state: getOnboardingState(customer),
            destination,
            voice_setup_completed_at: customer.voice_setup_completed_at || null
        });
    } catch (error) {
        console.error('Voice onboarding GET error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.post('/onboarding/activation-shown', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const customer = getSessionCustomer(req);
        if (!customer) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const state = getOnboardingState(customer);
        if (state === 'terms_accepted') {
            transitionState(db, customer.id, 'activation_shown');
        }
        const refreshed = db.getCustomer(customer.id);
        return res.json({
            success: true,
            onboarding_state: getOnboardingState(refreshed),
            destination: resolveOnboardingDestination(refreshed)
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.post('/onboarding/wizard-started', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const customer = getSessionCustomer(req);
        if (!customer) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const step = parseInt(req.body?.wizard_step, 10) || 1;
        transitionState(db, customer.id, 'voice_setup_incomplete', { wizard_step: step });
        const refreshed = db.getCustomer(customer.id);
        return res.json({
            success: true,
            onboarding_state: getOnboardingState(refreshed),
            destination: resolveOnboardingDestination(refreshed)
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.get('/preview', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const ctx = resolveVoiceSettingsContext(req);
        if (ctx.tenantError || (!ctx.merchantId && !ctx.customerId)) {
            return res.status(400).json({ success: false, error: 'tenant_required' });
        }
        const { row, customer } = await loadSettingsBundle(ctx);
        const practiceName = resolvePracticeDisplayName(db, {
            customerId: ctx.customerId,
            merchantId: ctx.merchantId,
            customer
        });

        const draft = { ...row };
        if (req.query.greeting) draft.greeting = String(req.query.greeting);
        if (req.query.outbound_opener) draft.outbound_opener = String(req.query.outbound_opener);
        if (req.query.outbound_enabled !== undefined) {
            draft.outbound_enabled = req.query.outbound_enabled === '1' || req.query.outbound_enabled === 'true';
        }
        if (req.query.tone_preset) draft.tone_preset = String(req.query.tone_preset);

        const openers = resolveCallOpeners({
            settings: draft,
            customer,
            practiceName
        });

        return res.json({
            success: true,
            preview: openers,
            practice_name: practiceName,
            sync_status: row.sync_status || 'synced',
            synced_at: row.synced_at || row.prompt_synced_at || null
        });
    } catch (error) {
        console.error('Voice preview GET error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.get('/settings', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const ctx = resolveVoiceSettingsContext(req);
        if (ctx.tenantError) {
            return res.status(400).json({
                success: false,
                error: 'tenant_required',
                message: 'Unable to resolve provider for voice settings.'
            });
        }
        const { merchantId, customerId } = ctx;
        if (!merchantId && !customerId) {
            return res.status(400).json({
                success: false,
                error: 'tenant_required',
                message: 'Unable to resolve provider for voice settings.'
            });
        }

        const { row, customer } = await loadSettingsBundle(ctx);

        let retellError = null;
        if (customerId && !row.retell_agent_id) {
            const ensure = await ensureCustomerRetellAgent(db, customerId, { retellService });
            if (ensure.agentId) {
                row.retell_agent_id = ensure.agentId;
            } else if (ensure.error) {
                retellError = ensure.error;
            }
        }

        return res.json({
            success: true,
            settings: row,
            retell_agent_id: row.retell_agent_id || null,
            retell_error: retellError
        });
    } catch (error) {
        console.error('Voice agent settings GET error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

async function handleSettingsSave(req, res) {
    const ctx = resolveVoiceSettingsContext(req);
    if (ctx.tenantError) {
        return res.status(400).json({
            success: false,
            error: 'tenant_required',
            message: 'Unable to resolve provider for voice settings.'
        });
    }
    const { merchantId, customerId } = ctx;
    if (!merchantId && !customerId) {
        return res.status(400).json({
            success: false,
            error: 'tenant_required',
            message: 'Unable to resolve provider for voice settings.'
        });
    }

    const body = req.body || {};
    const {
        retell_agent_id = null,
        enabled = true,
        greeting = null,
        inbound_greeting = null,
        after_hours_message = null,
        business_hours = null,
        outbound_opener = null,
        outbound_enabled = undefined,
        outbound_quiet_hours = null,
        outbound_allowed_types = null,
        tone_preset = null,
        settings_version = null
    } = body;

    const safeEnabled = !!enabled;
    const normalizedHours = business_hours && typeof business_hours === 'object' ? business_hours : null;
    const resolvedGreeting = greeting ?? inbound_greeting ?? null;

    let agentId = retell_agent_id || (customerId && db.getCustomer(customerId)?.retell_agent_id) || null;
    let retellEnsure = null;
    if (!agentId && customerId) {
        retellEnsure = await ensureCustomerRetellAgent(db, customerId, { retellService });
        if (retellEnsure.agentId) agentId = retellEnsure.agentId;
    }

    const settingsPatch = {
        retell_agent_id: agentId,
        enabled: safeEnabled,
        greeting: resolvedGreeting,
        after_hours_message,
        business_hours: normalizedHours
    };
    if (outbound_opener !== null) settingsPatch.outbound_opener = outbound_opener;
    if (outbound_enabled !== undefined) settingsPatch.outbound_enabled = !!outbound_enabled;
    if (outbound_quiet_hours !== null) settingsPatch.outbound_quiet_hours = outbound_quiet_hours;
    if (outbound_allowed_types !== null) settingsPatch.outbound_allowed_types = outbound_allowed_types;
    if (tone_preset) settingsPatch.tone_preset = tone_preset;

    try {
        const syncResult = await saveAndSyncVoiceSettings(db, {
            merchantId,
            customerId,
            settingsPatch,
            retellService,
            expectedVersion: settings_version
        });

        if (customerId) {
            updateAgentLifecycleState(customerId, {
                enabled: safeEnabled,
                kelly: safeEnabled ? 'active' : 'paused',
                retell: safeEnabled ? 'active' : 'paused'
            });
        }

        return res.json({
            success: true,
            message: 'Voice agent settings saved and synced with voice provider',
            retell_agent_id: syncResult.retell_agent_id || null,
            retell_created: retellEnsure?.created || false,
            merchant_id: merchantId || null,
            customer_id: customerId || null,
            settings_version: syncResult.settings_version,
            sync_status: syncResult.sync_status,
            synced_at: syncResult.synced_at,
            prompt_synced_at: syncResult.synced_at
        });
    } catch (error) {
        if (error.code === 'settings_conflict') {
            return res.status(409).json({
                success: false,
                error: 'settings_conflict',
                message: error.message,
                current_version: error.current_version
            });
        }
        if (error.code === 'retell_sync_failed') {
            return res.status(502).json({
                success: false,
                error: 'retell_sync_failed',
                message: error.message
            });
        }
        throw error;
    }
}

router.post('/settings', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        return await handleSettingsSave(req, res);
    } catch (error) {
        console.error('Voice agent settings POST error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.patch('/settings', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        return await handleSettingsSave(req, res);
    } catch (error) {
        console.error('Voice agent settings PATCH error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.post('/setup-complete', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const customer = getSessionCustomer(req);
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

        const markLive = req.body?.mark_live === true;
        transitionState(db, customer.id, markLive ? 'live' : 'voice_setup_complete', {
            wizard_step: 5,
            setup_completed: true
        });

        const refreshed = db.getCustomer(customer.id);
        return res.json({
            success: true,
            message: 'Voice setup marked complete',
            onboarding_state: getOnboardingState(refreshed),
            destination: resolveOnboardingDestination(refreshed)
        });
    } catch (error) {
        console.error('Voice setup complete error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

module.exports = router;
