/**
 * Automation API
 * Manages automation rules, templates, and message history
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireCustomerAuth } = require('../middleware/customer-auth');
const { v4: uuidv4 } = require('uuid');

/**
 * Render template with variables
 */
function renderTemplate(template, variables = {}) {
  let rendered = template;
  Object.keys(variables).forEach(key => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(regex, variables[key] || '');
  });
  return rendered;
}

// ============================================
// TEMPLATES
// ============================================

/**
 * GET /api/automation/templates
 * Get templates for merchant
 */
router.get('/templates', requireCustomerAuth, (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const { type } = req.query;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    const templates = db.getTemplates(merchantId, type || null);

    // Parse variables JSON
    const parsedTemplates = templates.map(t => ({
      ...t,
      variables: t.variables ? JSON.parse(t.variables) : []
    }));

    res.json({
      templates: parsedTemplates
    });
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({
      error: `Failed to get templates: ${error.message}`
    });
  }
});

/**
 * POST /api/automation/templates
 * Create a new template
 */
router.post('/templates', requireCustomerAuth, (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const { name, type, subject, content, variables } = req.body;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    if (!name || !type || !content) {
      return res.status(400).json({
        error: 'Name, type, and content are required'
      });
    }

    if (!['email', 'sms'].includes(type)) {
      return res.status(400).json({
        error: 'Type must be "email" or "sms"'
      });
    }

    const template = db.createTemplate({
      id: uuidv4(),
      merchant_id: merchantId,
      name,
      type,
      subject: subject || null,
      content,
      variables: variables || []
    });

    res.json({
      success: true,
      template: {
        ...template,
        variables: template.variables ? JSON.parse(template.variables) : []
      }
    });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({
      error: `Failed to create template: ${error.message}`
    });
  }
});

/**
 * PUT /api/automation/templates/:id
 * Update a template
 */
router.put('/templates/:id', requireCustomerAuth, (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const { id } = req.params;
    const updates = req.body;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    // Verify template belongs to merchant
    const template = db.getTemplate(id);
    if (!template || template.merchant_id !== merchantId) {
      return res.status(404).json({
        error: 'Template not found'
      });
    }

    // Parse variables if provided
    if (updates.variables && typeof updates.variables === 'object') {
      updates.variables = JSON.stringify(updates.variables);
    }

    const result = db.updateTemplate(id, merchantId, updates);

    if (result.changes === 0) {
      return res.status(404).json({
        error: 'Template not found or no changes made'
      });
    }

    const updated = db.getTemplate(id);
    res.json({
      success: true,
      template: {
        ...updated,
        variables: updated.variables ? JSON.parse(updated.variables) : []
      }
    });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({
      error: `Failed to update template: ${error.message}`
    });
  }
});

/**
 * DELETE /api/automation/templates/:id
 * Delete a template
 */
router.delete('/templates/:id', requireCustomerAuth, (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const { id } = req.params;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    // Verify template belongs to merchant
    const template = db.getTemplate(id);
    if (!template || template.merchant_id !== merchantId) {
      return res.status(404).json({
        error: 'Template not found'
      });
    }

    db.deleteTemplate(id, merchantId);

    res.json({
      success: true
    });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({
      error: `Failed to delete template: ${error.message}`
    });
  }
});

// ============================================
// AUTOMATION RULES
// ============================================

/**
 * GET /api/automation/rules
 * Get automation rules for merchant
 */
router.get('/rules', requireCustomerAuth, (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    const rules = db.getAutomationRules(merchantId);

    // Parse conditions JSON
    const parsedRules = rules.map(r => ({
      ...r,
      enabled: r.enabled === 1,
      conditions: r.conditions ? JSON.parse(r.conditions) : null
    }));

    res.json({
      rules: parsedRules
    });
  } catch (error) {
    console.error('Get rules error:', error);
    res.status(500).json({
      error: `Failed to get rules: ${error.message}`
    });
  }
});

/**
 * POST /api/automation/rules
 * Create a new automation rule
 */
router.post('/rules', requireCustomerAuth, (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const { trigger, action, template_id, enabled, conditions } = req.body;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    if (!trigger || !action) {
      return res.status(400).json({
        error: 'Trigger and action are required'
      });
    }

    // Verify template belongs to merchant if provided
    if (template_id) {
      const template = db.getTemplate(template_id);
      if (!template || template.merchant_id !== merchantId) {
        return res.status(404).json({
          error: 'Template not found'
        });
      }
    }

    const rule = db.createAutomationRule({
      id: uuidv4(),
      merchant_id: merchantId,
      trigger,
      action,
      template_id: template_id || null,
      enabled: enabled !== undefined ? enabled : true,
      conditions: conditions || null
    });

    res.json({
      success: true,
      rule: {
        ...rule,
        enabled: rule.enabled === 1,
        conditions: rule.conditions ? JSON.parse(rule.conditions) : null
      }
    });
  } catch (error) {
    console.error('Create rule error:', error);
    res.status(500).json({
      error: `Failed to create rule: ${error.message}`
    });
  }
});

/**
 * PUT /api/automation/rules/:id
 * Update an automation rule
 */
router.put('/rules/:id', requireCustomerAuth, (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const { id } = req.params;
    const updates = req.body;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    // Verify rule belongs to merchant
    const rules = db.getAutomationRules(merchantId);
    const rule = rules.find(r => r.id === id);
    if (!rule) {
      return res.status(404).json({
        error: 'Rule not found'
      });
    }

    // Parse conditions if provided
    if (updates.conditions && typeof updates.conditions === 'object') {
      updates.conditions = JSON.stringify(updates.conditions);
    }

    // Handle enabled boolean
    if (updates.enabled !== undefined) {
      updates.enabled = updates.enabled ? 1 : 0;
    }

    const result = db.updateAutomationRule(id, merchantId, updates);

    if (result.changes === 0) {
      return res.status(404).json({
        error: 'Rule not found or no changes made'
      });
    }

    const updatedRules = db.getAutomationRules(merchantId);
    const updated = updatedRules.find(r => r.id === id);
    res.json({
      success: true,
      rule: {
        ...updated,
        enabled: updated.enabled === 1,
        conditions: updated.conditions ? JSON.parse(updated.conditions) : null
      }
    });
  } catch (error) {
    console.error('Update rule error:', error);
    res.status(500).json({
      error: `Failed to update rule: ${error.message}`
    });
  }
});

/**
 * DELETE /api/automation/rules/:id
 * Delete an automation rule
 */
router.delete('/rules/:id', requireCustomerAuth, (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const { id } = req.params;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    // Verify rule belongs to merchant
    const rules = db.getAutomationRules(merchantId);
    const rule = rules.find(r => r.id === id);
    if (!rule) {
      return res.status(404).json({
        error: 'Rule not found'
      });
    }

    db.deleteAutomationRule(id, merchantId);

    res.json({
      success: true
    });
  } catch (error) {
    console.error('Delete rule error:', error);
    res.status(500).json({
      error: `Failed to delete rule: ${error.message}`
    });
  }
});

// ============================================
// MESSAGE HISTORY
// ============================================

/**
 * GET /api/automation/messages/history
 * Get message history for merchant
 */
router.get('/messages/history', requireCustomerAuth, (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const { type, status, customer_id, start_date, end_date, limit } = req.query;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    const filters = {
      type: type || null,
      status: status || null,
      customer_id: customer_id || null,
      start_date: start_date || null,
      end_date: end_date || null,
      limit: limit ? parseInt(limit) : 50
    };

    const messages = db.getMessageHistory(merchantId, filters);

    res.json({
      messages
    });
  } catch (error) {
    console.error('Get message history error:', error);
    res.status(500).json({
      error: `Failed to get message history: ${error.message}`
    });
  }
});

// ============================================
// SEND MESSAGES (Manual)
// ============================================

/**
 * POST /api/automation/send-email
 * Send an email manually
 */
router.post('/send-email', requireCustomerAuth, async (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const { recipient, subject, content, customer_id } = req.body;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    if (!recipient || !subject || !content) {
      return res.status(400).json({
        error: 'Recipient, subject, and content are required'
      });
    }

    // Send email
    const EmailService = require('../services/platform/email-service');
    await EmailService.sendEmail({
      to: recipient,
      subject,
      html: content.replace(/\n/g, '<br>'),
      text: content
    });

    // Log to message history
    db.createMessageHistory({
      id: uuidv4(),
      merchant_id: merchantId,
      customer_id: customer_id || null,
      type: 'email',
      recipient,
      subject,
      content,
      status: 'sent',
      sent_at: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('Send email error:', error);

    // Log failure to message history
    try {
      db.createMessageHistory({
        id: uuidv4(),
        merchant_id: req.customer?.merchant_id,
        customer_id: req.body.customer_id || null,
        type: 'email',
        recipient: req.body.recipient,
        subject: req.body.subject,
        content: req.body.content,
        status: 'failed',
        error_message: error.message
      });
    } catch (e) {
      console.error('Failed to log message history:', e);
    }

    res.status(500).json({
      error: `Failed to send email: ${error.message}`
    });
  }
});

/**
 * POST /api/automation/send-sms
 * Send an SMS manually
 */
router.post('/send-sms', requireCustomerAuth, async (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const { phone_number, content, customer_id } = req.body;

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    if (!phone_number || !content) {
      return res.status(400).json({
        error: 'Phone number and content are required'
      });
    }

    // Validate phone number
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        error: 'Invalid phone number format'
      });
    }

    // Send SMS
    const SMSService = require('../services/platform/sms-service');
    const result = await SMSService.sendSMS(phone_number, content);

    // Log to message history
    db.createMessageHistory({
      id: uuidv4(),
      merchant_id: merchantId,
      customer_id: customer_id || null,
      type: 'sms',
      recipient: phone_number,
      content,
      status: 'sent',
      provider_id: result.messageSid || null,
      sent_at: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'SMS sent successfully',
      messageSid: result.messageSid
    });
  } catch (error) {
    console.error('Send SMS error:', error);

    // Log failure to message history
    try {
      db.createMessageHistory({
        id: uuidv4(),
        merchant_id: req.customer?.merchant_id,
        customer_id: req.body.customer_id || null,
        type: 'sms',
        recipient: req.body.phone_number,
        content: req.body.content,
        status: 'failed',
        error_message: error.message
      });
    } catch (e) {
      console.error('Failed to log message history:', e);
    }

    res.status(500).json({
      error: `Failed to send SMS: ${error.message}`
    });
  }
});

module.exports = router;
module.exports.renderTemplate = renderTemplate;

