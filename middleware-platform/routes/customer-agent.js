/**
 * CUSTOMER AGENT ROUTES
 * 
 * Allows customers to manage their voice agent settings, including prompt customization
 */

const express = require('express');
const db = require('../database');
const RetellService = require('../services/retell-service');
const { authLimiter } = require('../middleware/rate-limiter');

const router = express.Router();
const retellService = new RetellService();

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

        // If no custom prompt, generate default
        if (!currentPrompt) {
            currentPrompt = retellService.generateClinicPrompt({
                name: customer.company_name || customer.name || 'Your Clinic',
                description: 'a healthcare practice',
                business_hours: 'Monday-Friday, 9 AM - 5 PM',
                phone_number: customer.twilio_phone_number || '',
                address: ''
            });
        }

        res.json({
            success: true,
            prompt: currentPrompt,
            agent_id: customer.retell_agent_id,
            agent_name: agentData?.agent_name || null,
            has_custom_prompt: !!customer.custom_prompt,
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

        // Basic validation - ensure critical functions are mentioned
        const promptLower = prompt.toLowerCase();
        const hasAppointment = promptLower.includes('appointment') || promptLower.includes('schedule');
        const hasInsurance = promptLower.includes('insurance') || promptLower.includes('eligibility');

        if (!hasAppointment && !hasInsurance) {
            return res.status(400).json({
                success: false,
                error: 'Prompt should include instructions for appointment booking or insurance verification. Please review your prompt.',
                warning: true
            });
        }

        // Update customer's custom prompt in database
        db.updateCustomer(customer.id, {
            custom_prompt: prompt.trim(),
            prompt_updated_at: new Date().toISOString()
        });

        // Update Retell agent if exists
        if (customer.retell_agent_id) {
            try {
                const updateResult = await retellService.updateAgent(customer.retell_agent_id, {
                    system_prompt: prompt.trim(),
                    agent_name: `${customer.company_name || customer.name || 'Clinic'} Voice Assistant`
                });

                if (!updateResult.success) {
                    console.error('⚠️  Failed to update Retell agent:', updateResult.error);
                    // Still return success since we saved to database
                    return res.json({
                        success: true,
                        message: 'Prompt saved to database. Retell agent update failed - please try again.',
                        warning: true,
                        prompt: prompt.trim()
                    });
                }
            } catch (error) {
                console.error('⚠️  Error updating Retell agent:', error.message);
                return res.json({
                    success: true,
                    message: 'Prompt saved to database. Retell agent update failed - please try again.',
                    warning: true,
                    prompt: prompt.trim()
                });
            }
        }

        res.json({
            success: true,
            message: 'Prompt updated successfully',
            prompt: prompt.trim()
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

