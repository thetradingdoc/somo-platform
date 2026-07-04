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
  resolveOnboardingDestination,
  setServerOnboardingMeta
} = require('../services/voice-onboarding-state');
const {
  buildOnboardingResponse,
  resolveOnboardingBlockers
} = require('../services/onboarding-blockers-service');
const { resolveVoiceAgentStatus } = require('../services/nameplate-status-service');
const {
  resolveCallOpeners,
  resolvePracticeDisplayName
} = require('../services/call-opener-resolver');
const {
  saveAndSyncVoiceSettings,
  normalizeSettingsRow
} = require('../services/voice-settings-sync');
const { resolveVoiceMerchantId } = require('../services/operator-tenant-bootstrap');
const {
  normalizeLanguageConfig,
  PRESET_LABELS,
  parseSupportedLanguages
} = require('../services/tenant-language-config');
const {
  resolveTenantVoiceConfig,
  resolveClinicForCustomer,
  syncVoiceHoursToClinic
} = require('../services/tenant-voice-config');

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

function resolveClinicForCustomerLocal(customerId, clinicIdHint = null) {
    return resolveClinicForCustomer(db, customerId, clinicIdHint);
}

function enrichSettingsRow(row, { customerId, clinicId } = {}) {
    const out = { ...row };
    const lang = normalizeLanguageConfig({
        language_mode: out.language_mode,
        supported_languages: out.supported_languages
    });
    out.language_mode = lang.language_mode;
    out.supported_languages = lang.supported_languages;
    out.language_preset_labels = PRESET_LABELS;
    const clinic = resolveClinicForCustomerLocal(customerId, clinicId || out.clinic_id);
    out.transfer_number = clinic?.transfer_number || null;
    out.overflow_phone = clinic?.overflow_phone || null;
    out.overflow_enabled = out.overflow_enabled !== 0 && out.overflow_enabled !== false;
    out.porting_status = out.porting_status || 'not_started';
    out.clinic_id = clinic?.clinic_id || out.clinic_id || null;
    out.clinic_email = clinic?.email || null;
    out.npi = clinic?.npi || null;
    return out;
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
    return { row: enrichSettingsRow(row, { customerId, clinicId: row.clinic_id }), customer };
}

router.get('/onboarding', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const customer = getSessionCustomer(req);
        if (!customer) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        return res.json({ success: true, ...buildOnboardingResponse(db, customer) });
    } catch (error) {
        console.error('Voice onboarding GET error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.get('/onboarding/blockers', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const customer = getSessionCustomer(req);
        if (!customer) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const { blockers, checklist } = resolveOnboardingBlockers(db, customer);
        return res.json({ success: true, blockers, checklist });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.post('/onboarding/connect', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const customer = getSessionCustomer(req);
        if (!customer) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const body = req.body || {};
        const metaPatch = {};
        if (body.pms_selection) metaPatch.pms_selection = String(body.pms_selection);
        if (body.wizard_step != null) metaPatch.wizard_step = parseInt(body.wizard_step, 10) || 1;

        const state = getOnboardingState(customer);
        transitionState(db, customer.id, state === 'signup_started' ? 'voice_setup_incomplete' : state, metaPatch);
        if (body.pms_selection === 'somo') {
            setServerOnboardingMeta(db, customer.id, { calendar_connection: 'somo' });
        }
        const refreshed = db.getCustomer(customer.id);
        return res.json({ success: true, ...buildOnboardingResponse(db, refreshed) });
    } catch (error) {
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
            destination: resolveOnboardingDestination(refreshed, db)
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
        const metaPatch = { wizard_step: step };
        if (req.body?.pms_selection) metaPatch.pms_selection = String(req.body.pms_selection);
        transitionState(db, customer.id, 'voice_setup_incomplete', metaPatch);
        if (req.body?.pms_selection === 'somo') {
            setServerOnboardingMeta(db, customer.id, { calendar_connection: 'somo' });
        }
        const refreshed = db.getCustomer(customer.id);
        return res.json({
            success: true,
            ...buildOnboardingResponse(db, refreshed)
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
            live_opener: openers.activeOpener,
            practice_name: practiceName,
            sync_status: row.sync_status || 'synced',
            synced_at: row.synced_at || row.prompt_synced_at || null
        });
    } catch (error) {
        console.error('Voice preview GET error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.post('/preview/tts', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const text = String(req.body?.text || req.query?.text || '').trim().slice(0, 1500);
        if (!text) {
            return res.status(400).json({ success: false, error: 'text required' });
        }
        if (!process.env.OPENAI_API_KEY) {
            return res.json({ success: true, tts_available: false, text });
        }
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const voice = process.env.WEB_VOICE_TTS_VOICE || 'alloy';
        const model = process.env.WEB_VOICE_TTS_MODEL || 'gpt-4o-mini-tts';
        const tts = await openai.audio.speech.create({ model, voice, input: text });
        const buf = Buffer.from(await tts.arrayBuffer());
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buf);
    } catch (error) {
        console.error('Voice preview TTS error:', error);
        return res.status(500).json({ success: false, error: 'tts_failed', message: error.message });
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
        settings_version = null,
        clinic_id = null,
        language_mode = null,
        supported_languages = null,
        transfer_number = null,
        overflow_phone = null,
        overflow_enabled = undefined,
        porting_status = null,
        clinic_email = null,
        coverage_mode = null,
        coverage_hours = null,
        after_hours_action = null,
        ai_disclosure_enabled = undefined,
        voice_reply_suppress_enabled = undefined,
        npi = null
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
    if (tone_preset) {
        const ALLOWED_TONES = ['warm', 'warm_confident', 'professional', 'concise'];
        settingsPatch.tone_preset = ALLOWED_TONES.includes(String(tone_preset))
            ? String(tone_preset)
            : 'warm';
    }

    const langConfig = normalizeLanguageConfig({
        language_mode,
        supported_languages
    });
    settingsPatch.language_mode = langConfig.language_mode;
    settingsPatch.supported_languages = langConfig.supported_languages;

    if (coverage_mode !== null) {
      const allowedModes = ['full_replacement', 'coverage'];
      settingsPatch.coverage_mode = allowedModes.includes(String(coverage_mode))
        ? String(coverage_mode)
        : 'full_replacement';
    }
    if (coverage_hours !== null && typeof coverage_hours === 'object') {
      settingsPatch.coverage_hours = coverage_hours;
    }
    if (after_hours_action !== null) {
      const allowedActions = ['message_only', 'transfer', 'voicemail'];
      settingsPatch.after_hours_action = allowedActions.includes(String(after_hours_action))
        ? String(after_hours_action)
        : 'message_only';
    }
    if (ai_disclosure_enabled !== undefined) {
      settingsPatch.ai_disclosure_enabled = ai_disclosure_enabled ? 1 : 0;
    }
    if (voice_reply_suppress_enabled !== undefined) {
      settingsPatch.voice_reply_suppress_enabled = voice_reply_suppress_enabled ? 1 : 0;
    }

    const resolvedClinicId = clinic_id || req.query.clinic_id || null;
    const clinic = resolveClinicForCustomerLocal(customerId, resolvedClinicId);
    if (transfer_number !== null && clinic?.clinic_id) {
        db.updateClinic(clinic.clinic_id, { transfer_number: String(transfer_number).trim() || null });
    }
    if (overflow_phone !== null && clinic?.clinic_id) {
        db.updateClinic(clinic.clinic_id, { overflow_phone: String(overflow_phone).trim() || null });
    }
    if (overflow_enabled !== undefined) {
      settingsPatch.overflow_enabled = overflow_enabled ? 1 : 0;
    }
    if (porting_status !== null) {
      const allowedPorting = ['not_started', 'requested', 'in_progress', 'complete'];
      const ps = String(porting_status).trim();
      if (allowedPorting.includes(ps)) settingsPatch.porting_status = ps;
    }
    if (clinic_email !== null && clinic?.clinic_id) {
        db.updateClinic(clinic.clinic_id, { email: String(clinic_email).trim() || null });
    }
    if (npi !== null && clinic?.clinic_id) {
        const npiDigits = String(npi).replace(/\D/g, '').slice(0, 10);
        if (npiDigits.length === 10) {
            db.updateClinic(clinic.clinic_id, { npi: npiDigits });
        }
    }
    if (normalizedHours && clinic?.clinic_id) {
        syncVoiceHoursToClinic(db, clinic.clinic_id, normalizedHours);
    }

    try {
        const syncResult = await saveAndSyncVoiceSettings(db, {
            merchantId,
            customerId,
            clinicId: resolvedClinicId || clinic?.clinic_id || null,
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

        const { merchantId, customerId } = resolveVoiceSettingsContext(req);
        const tenantConfig = resolveTenantVoiceConfig(db, {
            customerId: customerId || customer.id,
            merchantId: merchantId || customer.merchant_id
        });
        if (!tenantConfig.config_status?.ready) {
            return res.status(400).json({
                success: false,
                error: 'config_incomplete',
                message: 'Complete required voice setup before going live.',
                config_status: tenantConfig.config_status
            });
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

router.get('/config-status', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const { merchantId, customerId } = resolveVoiceSettingsContext(req);
        const clinicId = req.query.clinic_id || null;
        const config = resolveTenantVoiceConfig(db, { merchantId, customerId, clinicId });
        return res.json({
            success: true,
            config_status: config.config_status,
            clinic_id: config.clinic_id,
            customer_id: config.customer_id,
            language_mode: config.language_mode,
            supported_languages: config.supported_languages,
            transfer_number: config.transfer_number,
            retell_agent_id: config.retell_agent_id,
            prompt_profile_id: config.prompt_profile_id,
            clinic_email: config.clinic_email
        });
    } catch (error) {
        console.error('Voice config-status error:', error);
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

function parseEventPayload(raw) {
    if (!raw) return {};
    try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {
        return {};
    }
}

function buildTranscriptExcerpt(dbModule, callId) {
    if (!callId || !dbModule?.listKellyCallEvents) return null;
    const events = dbModule.listKellyCallEvents({ session_id: callId, limit: 100 });
    const parts = [];
    for (const ev of events) {
        const payload = parseEventPayload(ev.payload_json);
        const text = payload.user_text || payload.transcript || payload.assistant_text || payload.text;
        if (text) parts.push(String(text).trim());
    }
    if (!parts.length) return null;
    return parts.join(' ').slice(0, 500);
}

router.get('/status', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const customer = getSessionCustomer(req);
        if (!customer) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const status = resolveVoiceAgentStatus(db, customer);
        return res.json({ success: true, ...status });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

router.get('/test-call/latest', optionalCustomerAuth, requireVoiceSettingsAccess, async (req, res) => {
    try {
        const customer = getSessionCustomer(req);
        if (!customer) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        let call = null;
        if (db.db) {
            call = db.db
                .prepare(
                    `SELECT * FROM voice_call_log WHERE customer_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`
                )
                .get(customer.id);
        }
        if (!call) {
            return res.json({
                success: false,
                transcript_excerpt: null,
                call_at: null,
                duration_ms: null
            });
        }
        const durationMs = call.call_duration_seconds
            ? Math.round(Number(call.call_duration_seconds) * 1000)
            : null;
        return res.json({
            success: true,
            call_id: call.call_id,
            transcript_excerpt: buildTranscriptExcerpt(db, call.call_id),
            call_at: call.created_at,
            duration_ms: durationMs
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

module.exports = router;
