/**
 * CUSTOMER AGENT ROUTES
 * 
 * Allows customers to manage their voice agent settings, including prompt customization
 */

const express = require('express');
const db = require('../database');
const RetellService = require('../services/retell-service');
const { authLimiter } = require('../middleware/rate-limiter');
const constants = require('../utils/constants');

const router = express.Router();
const retellService = new RetellService();
const { ensureCustomerRetellAgent } = require('../services/ensure-retell-agent');

/**
 * Helper to determine tenant type (shop vs clinic)
 */
function getTenantType(customer) {
    if (!customer || !customer.merchant_id) {
        return 'clinic'; // Default to clinic
    }

    const merchant = db.getMerchant(customer.merchant_id);
    if (!merchant) {
        return 'clinic'; // Default to clinic if merchant not found
    }

    // Use tenant_type field if available (preferred)
    if (merchant.tenant_type) {
        return merchant.tenant_type;
    }
    
    // Backward compatibility: check subdomain
    if (merchant.subdomain === constants.TENANTS.DEFAULT_SUBDOMAIN) {
        return 'shop';
    }

    return 'clinic'; // Default to clinic
}

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
 * GET /api/customer/agent/prompt
 * Get current voice agent prompt
 */
router.get('/prompt', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Please sign in.'
            });
        }

        // Get current prompt from Retell agent if exists
        let currentPrompt = null;
        let agentData = null;

        if (customer.retell_agent_id) {
            try {
                const agentResult = await retellService.getAgent(customer.retell_agent_id);
                if (agentResult.success && agentResult.agent_data) {
                    agentData = agentResult.agent_data;
                    currentPrompt = agentData.general_prompt || agentData.system_prompt || null;
                }
            } catch (error) {
                console.warn('⚠️  Could not fetch agent from Retell:', error.message);
            }
        }

        // If no custom prompt, generate default based on tenant type
        if (!currentPrompt) {
            const tenantType = getTenantType(customer);
            
            if (tenantType === 'shop') {
                // Load shop prompt
                currentPrompt = retellService.loadShopPrompt();
            } else {
                // Load clinic prompt
            currentPrompt = retellService.generateClinicPrompt({
                name: customer.company_name || customer.name || 'Your Clinic',
                description: 'a healthcare practice',
                business_hours: 'Monday-Friday, 9 AM - 5 PM',
                phone_number: customer.twilio_phone_number || '',
                address: ''
            });
        }
        }

        const tenantType = getTenantType(customer);

        res.json({
            success: true,
            prompt: currentPrompt,
            agent_id: customer.retell_agent_id,
            agent_name: agentData?.agent_name || null,
            has_custom_prompt: !!customer.custom_prompt,
            prompt_synced_at: customer.prompt_synced_at || customer.prompt_updated_at || null,
            tenant_type: tenantType, // 'shop' or 'clinic'
            can_edit: true // All customers can edit for now
        });
    } catch (error) {
        console.error('❌ Get prompt error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get prompt',
            message: error.message
        });
    }
});

/**
 * PUT /api/customer/agent/prompt
 * Update voice agent prompt
 */
router.put('/prompt', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Please sign in.'
            });
        }

        const { prompt } = req.body;
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Prompt is required and must be a non-empty string'
            });
        }

        // Validate prompt length
        if (prompt.length > 10000) {
            return res.status(400).json({
                success: false,
                error: 'Prompt is too long. Maximum 10,000 characters.'
            });
        }

        // Basic validation - ensure critical functions are mentioned (tenant-aware)
        const tenantType = getTenantType(customer);
        const promptLower = prompt.toLowerCase();

        if (tenantType === 'shop') {
            // Shop tenant validation: should have product/order related content
            const hasProduct = promptLower.includes('product') || promptLower.includes('item');
            const hasOrder = promptLower.includes('order') || promptLower.includes('checkout') || promptLower.includes('purchase');

            if (!hasProduct && !hasOrder) {
                return res.status(400).json({
                    success: false,
                    error: 'Prompt should include instructions for product search or order management. Please review your prompt.',
                    warning: true
                });
            }
        } else {
            // Clinic tenant validation: should have appointment/insurance content
        const hasAppointment = promptLower.includes('appointment') || promptLower.includes('schedule');
        const hasInsurance = promptLower.includes('insurance') || promptLower.includes('eligibility');

        if (!hasAppointment && !hasInsurance) {
            return res.status(400).json({
                success: false,
                error: 'Prompt should include instructions for appointment booking or insurance verification. Please review your prompt.',
                warning: true
            });
            }
        }

        const trimmed = prompt.trim();
        const agentName = tenantType === 'shop'
            ? `${customer.company_name || customer.name || 'Shop'} Voice Commerce Assistant`
            : `${customer.company_name || customer.name || 'Clinic'} Voice Assistant`;

        let retellEnsure = null;
        let workingCustomer = customer;
        if (!workingCustomer.retell_agent_id) {
            retellEnsure = await ensureCustomerRetellAgent(db, workingCustomer.id, { retellService });
            if (retellEnsure.agentId) {
                workingCustomer = db.getCustomer(workingCustomer.id);
            }
        }

        // Retell first (runtime SSOT), then DB cache
        if (workingCustomer.retell_agent_id) {
            try {
                const updateResult = await retellService.updateAgent(workingCustomer.retell_agent_id, {
                    general_prompt: trimmed,
                    agent_name: agentName
                });

                if (!updateResult.success) {
                    console.error('⚠️  Failed to update Retell agent:', updateResult.error);
                    return res.status(502).json({
                        success: false,
                        error: 'retell_sync_failed',
                        message: 'Could not update voice provider. Prompt was not saved.',
                        details: updateResult.error
                    });
                }
            } catch (error) {
                console.error('⚠️  Error updating Retell agent:', error.message);
                return res.status(502).json({
                    success: false,
                    error: 'retell_sync_failed',
                    message: 'Could not update voice provider. Prompt was not saved.',
                    details: error.message
                });
            }
        }

        const syncedAt = new Date().toISOString();
        db.updateCustomer(customer.id, {
            custom_prompt: trimmed,
            prompt_updated_at: syncedAt,
            prompt_synced_at: syncedAt
        });

        const retellLinked = !!workingCustomer.retell_agent_id;
        let message = retellLinked
            ? 'Prompt updated and synced with voice provider'
            : 'Prompt saved (no Retell agent linked yet)';
        if (!retellLinked && retellEnsure?.error) {
            message = `Prompt saved (Retell unavailable: ${retellEnsure.error})`;
        }

        res.json({
            success: true,
            message,
            retell_agent_id: workingCustomer.retell_agent_id || null,
            retell_created: retellEnsure?.created || false,
            retell_error: retellLinked ? null : (retellEnsure?.error || null),
            prompt_synced_at: syncedAt,
            prompt: trimmed
        });
    } catch (error) {
        console.error('❌ Update prompt error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update prompt',
            message: error.message
        });
    }
});

/**
 * GET /api/customer/agent/status
 * Get agent status and configuration
 */
router.get('/status', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        let agentStatus = 'not_configured';
        let agentData = null;

        if (customer.retell_agent_id) {
            try {
                const agentResult = await retellService.getAgent(customer.retell_agent_id);
                if (agentResult.success) {
                    agentStatus = 'active';
                    agentData = agentResult.agent_data;
                } else {
                    agentStatus = 'error';
                }
            } catch (error) {
                agentStatus = 'error';
            }
        }

        res.json({
            success: true,
            agent_status: agentStatus,
            agent_id: customer.retell_agent_id,
            phone_number: customer.twilio_phone_number,
            agent_data: agentData
        });
    } catch (error) {
        console.error('❌ Get agent status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get agent status',
            message: error.message
        });
    }
});

module.exports = router;

