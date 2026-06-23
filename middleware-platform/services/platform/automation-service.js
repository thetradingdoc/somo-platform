/**
 * Automation Service
 * Handles automation rule execution and template rendering
 */

const db = require('../../database');
const { v4: uuidv4 } = require('uuid');

class AutomationService {
  /**
   * Check and execute automation rules for a trigger
   */
  async checkAndExecuteRules(trigger, context = {}) {
    try {
      const { merchant_id, customer_id } = context;

      if (!merchant_id) {
        console.warn('⚠️  Automation: No merchant_id in context, skipping');
        return;
      }

      // Get enabled rules for this trigger
      const rules = db.getAutomationRules(merchant_id);
      const matchingRules = rules.filter(rule =>
        rule.trigger === trigger &&
        rule.enabled === 1
      );

      if (matchingRules.length === 0) {
        console.log(`📋 Automation: No rules found for trigger "${trigger}"`);
        return;
      }

      console.log(`🤖 Automation: Found ${matchingRules.length} rule(s) for trigger "${trigger}"`);

      // Execute each matching rule
      for (const rule of matchingRules) {
        try {
          await this.executeRule(rule, context);
        } catch (error) {
          console.error(`❌ Automation: Failed to execute rule ${rule.id}:`, error);

          // Log error to message history for debugging
          try {
            db.createMessageHistory({
              id: uuidv4(),
              merchant_id,
              customer_id: context.customer_id || null,
              type: 'error',
              recipient: 'system',
              content: `Automation rule ${rule.id} failed: ${error.message}`,
              status: 'failed',
              error_message: error.stack || error.message,
              sent_at: new Date().toISOString()
            });
          } catch (logError) {
            console.error('Failed to log automation error:', logError);
          }

          // Continue with other rules even if one fails
        }
      }
    } catch (error) {
      console.error('❌ Automation: Error checking rules:', error);
    }
  }

  /**
   * Execute a single automation rule
   */
  async executeRule(rule, context = {}) {
    const { merchant_id, customer_id, customer, order, checkout } = context;

    console.log(`⚙️  Automation: Executing rule ${rule.id} (${rule.action})`);

    // Parse conditions
    let conditions = null;
    if (rule.conditions) {
      try {
        conditions = typeof rule.conditions === 'string'
          ? JSON.parse(rule.conditions)
          : rule.conditions;
      } catch (e) {
        console.warn('⚠️  Automation: Failed to parse conditions:', e);
      }
    }

    // Check conditions if any
    if (conditions && !this.checkConditions(conditions, context)) {
      console.log(`⏭️  Automation: Rule ${rule.id} conditions not met, skipping`);
      return;
    }

    // Get template if needed
    let template = null;
    if (rule.template_id) {
      template = db.getTemplate(rule.template_id);
      if (!template || template.merchant_id !== merchant_id) {
        console.warn(`⚠️  Automation: Template ${rule.template_id} not found or doesn't belong to merchant`);
        return;
      }
    }

    // Execute action
    switch (rule.action) {
      case 'send_email':
        await this.sendEmail(rule, template, context);
        break;

      case 'send_sms':
        await this.sendSMS(rule, template, context);
        break;

      case 'call_customer':
        await this.callCustomer(rule, context);
        break;

      default:
        console.warn(`⚠️  Automation: Unknown action "${rule.action}"`);
    }
  }

  /**
   * Check if conditions are met
   */
  checkConditions(conditions, context) {
    // Simple condition checking - can be extended
    if (conditions.order_total_min && context.order) {
      if (!context.order.total_amount || context.order.total_amount < conditions.order_total_min) {
        return false;
      }
    }

    if (conditions.order_total_max && context.order) {
      if (!context.order.total_amount || context.order.total_amount > conditions.order_total_max) {
        return false;
      }
    }

    // Add more condition checks as needed
    return true;
  }

  /**
   * Render template with context variables
   */
  renderTemplate(template, context = {}) {
    const { customer, order, checkout, merchant } = context;

    const variables = {
      customer_name: customer?.name || customer?.email || 'Customer',
      customer_email: customer?.email || '',
      customer_phone: customer?.phone_number || '',
      order_id: order?.id || checkout?.id || '',
      order_total: order?.total_amount || checkout?.total_amount || '0',
      order_status: order?.status || checkout?.status || '',
      merchant_name: merchant?.name || 'Your Business',
      merchant_email: merchant?.email || '',
      ...context.variables // Allow additional variables from context
    };

    let rendered = template;
    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      rendered = rendered.replace(regex, String(variables[key] || ''));
    });

    return rendered;
  }

  /**
   * Send email action
   */
  async sendEmail(rule, template, context) {
    const { customer, merchant_id, customer_id } = context;

    if (!customer || !customer.email) {
      console.warn('⚠️  Automation: No customer email for send_email action');
      return;
    }

    if (!template) {
      console.warn('⚠️  Automation: No template for send_email action');
      return;
    }

    try {
      const EmailService = require('../platform/email-service');

      const subject = this.renderTemplate(template.subject || '', context);
      const content = this.renderTemplate(template.content, context);

      await EmailService.sendEmail({
        to: customer.email,
        subject,
        html: content.replace(/\n/g, '<br>'),
        text: content
      });

      // Log to message history
      db.createMessageHistory({
        id: uuidv4(),
        merchant_id,
        customer_id: customer_id || customer.id,
        type: 'email',
        recipient: customer.email,
        subject,
        content,
        status: 'sent',
        sent_at: new Date().toISOString()
      });

      console.log(`✅ Automation: Email sent to ${customer.email}`);
    } catch (error) {
      console.error('❌ Automation: Failed to send email:', error);

      // Log failure
      db.createMessageHistory({
        id: uuidv4(),
        merchant_id,
        customer_id: customer_id || customer.id,
        type: 'email',
        recipient: customer.email,
        subject: template.subject || '',
        content: template.content,
        status: 'failed',
        error_message: error.message
      });
    }
  }

  /**
   * Send SMS action
   */
  async sendSMS(rule, template, context) {
    const { customer, merchant_id, customer_id } = context;

    if (!customer || !customer.phone_number) {
      console.warn('⚠️  Automation: No customer phone for send_sms action');
      return;
    }

    if (!template) {
      console.warn('⚠️  Automation: No template for send_sms action');
      return;
    }

    try {
      const SMSService = require('../platform/sms-service');

      const content = this.renderTemplate(template.content, context);

      const result = await SMSService.sendSMS(customer.phone_number, content);

      // Log to message history
      db.createMessageHistory({
        id: uuidv4(),
        merchant_id,
        customer_id: customer_id || customer.id,
        type: 'sms',
        recipient: customer.phone_number,
        content,
        status: 'sent',
        provider_id: result.messageSid || null,
        sent_at: new Date().toISOString()
      });

      console.log(`✅ Automation: SMS sent to ${customer.phone_number}`);
    } catch (error) {
      console.error('❌ Automation: Failed to send SMS:', error);

      // Log failure
      db.createMessageHistory({
        id: uuidv4(),
        merchant_id,
        customer_id: customer_id || customer.id,
        type: 'sms',
        recipient: customer.phone_number,
        content: template.content,
        status: 'failed',
        error_message: error.message
      });
    }
  }

  /**
   * Call customer action
   */
  async callCustomer(rule, context) {
    const { customer, merchant_id } = context;

    if (!customer || !customer.phone_number) {
      console.warn('⚠️  Automation: No customer phone for call_customer action');
      return;
    }

    try {
      const RetellService = require('../voice/retell-service');
      const merchant = db.getMerchant(merchant_id);

      if (!merchant) {
        throw new Error('Merchant not found');
      }

      // Get Retell agent ID
      const clinic = db.getClinicBySlug(merchant.subdomain || '');
      const retellAgentId = clinic?.retell_agent_id || process.env.RETELL_AGENT_ID;

      if (!retellAgentId) {
        throw new Error('Voice agent not configured');
      }

      const fromNumber = process.env.TWILIO_PHONE_NUMBER;
      if (!fromNumber) {
        throw new Error('Twilio phone number not configured');
      }

      const retellService = new RetellService();
      await retellService.createOutboundCall(
        retellAgentId,
        fromNumber,
        customer.phone_number,
        {
          override_agent_id: retellAgentId
        }
      );

      console.log(`✅ Automation: Call initiated to ${customer.phone_number}`);
    } catch (error) {
      console.error('❌ Automation: Failed to initiate call:', error);
    }
  }
}

module.exports = new AutomationService();

