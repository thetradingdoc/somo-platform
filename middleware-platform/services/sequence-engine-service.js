/**
 * SEQUENCE ENGINE SERVICE
 * 
 * Handles execution of multi-step automation sequences for leads
 * 
 * Features:
 * - Execute sequence steps (email, SMS, call, wait, conditional)
 * - Track sequence progress
 * - Handle delays between steps
 * - Conditional branching
 * - Automatic progression
 */

const db = require('../database');
const EmailService = require('./email-service');
const SMSService = require('./sms-service');
const RetellServiceClass = require('./retell-service');

class SequenceEngineService {
  /**
   * Start a sequence for a lead
   */
  static async startSequence(sequenceId, leadId, metadata = {}) {
    const sequence = db.getSequence(sequenceId);
    if (!sequence) {
      throw new Error(`Sequence not found: ${sequenceId}`);
    }

    if (!sequence.enabled) {
      throw new Error(`Sequence is disabled: ${sequenceId}`);
    }

    const lead = db.getLead(leadId);
    if (!lead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    // Check if sequence already running for this lead
    const existing = db.getSequenceExecutions(null, leadId, 'active');
    if (existing.length > 0) {
      // Option: Pause existing or skip
      console.log(`⚠️  Sequence already running for lead ${leadId}, skipping`);
      return existing[0];
    }

    // Create execution record
    const executionResult = db.createSequenceExecution({
      sequence_id: sequenceId,
      lead_id: leadId,
      current_step: 0,
      status: 'active',
      metadata: {
        ...metadata,
        started_at: new Date().toISOString()
      }
    });

    const executionId = executionResult.id;

    // Execute first step
    await this.executeNextStep(executionId, sequence, lead);

    // Return the full execution object
    return db.getSequenceExecution(executionId);
  }

  /**
   * Execute the next step in a sequence
   */
  static async executeNextStep(executionId, sequence = null, lead = null) {
    const execution = db.getSequenceExecution(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (execution.status !== 'active') {
      console.log(`Execution ${executionId} is not active (status: ${execution.status})`);
      return null;
    }

    // Load sequence if not provided
    if (!sequence) {
      sequence = db.getSequence(execution.sequence_id);
      if (!sequence) {
        throw new Error(`Sequence not found: ${execution.sequence_id}`);
      }
    }

    // Load lead if not provided
    if (!lead) {
      lead = db.getLead(execution.lead_id);
      if (!lead) {
        throw new Error(`Lead not found: ${execution.lead_id}`);
      }
    }

    const steps = sequence.steps || [];
    if (execution.current_step >= steps.length) {
      // Sequence completed
      db.updateSequenceExecution(executionId, {
        status: 'completed',
        completed_at: new Date().toISOString()
      });

      // Create activity
      db.createLeadActivity({
        lead_id: execution.lead_id,
        activity_type: 'sequence',
        activity_subject: `Sequence completed: ${sequence.name}`,
        activity_description: `Completed ${steps.length} steps`,
        metadata: JSON.stringify({ sequence_id: sequence.id, execution_id: executionId })
      });

      return { completed: true };
    }

    const currentStep = steps[execution.current_step];
    if (!currentStep) {
      console.error(`Invalid step index: ${execution.current_step}`);
      return;
    }

    console.log(`📋 Executing step ${execution.current_step + 1}/${steps.length}: ${currentStep.type}`);

    try {
      // Execute step based on type
      const result = await this.executeStep(currentStep, lead, sequence, execution);

      // Move to next step
      const nextStepIndex = execution.current_step + 1;

      // Check if we need to wait before next step
      if (nextStepIndex < steps.length) {
        const nextStep = steps[nextStepIndex];
        const delay = nextStep.delay || 0; // delay in hours

        if (delay > 0) {
          // Schedule next step (in a real implementation, use a job queue)
          console.log(`⏰ Scheduling next step in ${delay} hours`);
          // For now, we'll just update the execution and a background job will pick it up
          // In production, use a proper job queue like Bull or similar
        }

        // Parse existing metadata if it's a string
        let existingMetadata = execution.metadata || {};
        if (typeof existingMetadata === 'string') {
          try {
            existingMetadata = JSON.parse(existingMetadata);
          } catch (e) {
            existingMetadata = {};
          }
        }

        db.updateSequenceExecution(executionId, {
          current_step: nextStepIndex,
          metadata: {
            ...existingMetadata,
            last_step_executed_at: new Date().toISOString(),
            last_step_result: result
          }
        });

        // If no delay, execute immediately
        if (delay === 0) {
          // Recursively call next step (with a small delay to avoid stack overflow)
          setImmediate(() => {
            this.executeNextStep(executionId).catch(err => {
              console.error(`Error executing next step:`, err);
            });
          });
        }
      } else {
        // Sequence completed
        db.updateSequenceExecution(executionId, {
          status: 'completed',
          completed_at: new Date().toISOString()
        });
      }

      return result;
    } catch (error) {
      console.error(`Error executing step ${execution.current_step}:`, error);
      
      // Create activity for error
      db.createLeadActivity({
        lead_id: execution.lead_id,
        activity_type: 'sequence',
        activity_subject: `Sequence error: ${sequence.name}`,
        activity_description: `Error in step ${execution.current_step + 1}: ${error.message}`,
        metadata: JSON.stringify({ 
          sequence_id: sequence.id, 
          execution_id: executionId,
          error: error.message 
        })
      });

      // Optionally pause sequence on error
      // db.updateSequenceExecution(executionId, { status: 'paused' });
      
      throw error;
    }
  }

  /**
   * Execute a single step
   */
  static async executeStep(step, lead, sequence, execution) {
    switch (step.type) {
      case 'email':
        return await this.executeEmailStep(step, lead);
      
      case 'sms':
        return await this.executeSMSStep(step, lead);
      
      case 'call':
        return await this.executeCallStep(step, lead);
      
      case 'wait':
        // Wait steps are handled by the delay in executeNextStep
        return { skipped: true, reason: 'wait_step' };
      
      case 'condition':
        // Conditional branching (future enhancement)
        return await this.executeConditionStep(step, lead, sequence, execution);
      
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  /**
   * Execute email step
   */
  static async executeEmailStep(step, lead) {
    if (!lead.clinic_email) {
      throw new Error('Lead has no email address');
    }

    const templateId = step.template_id;
    let subject = step.subject;
    let content = step.content;

    // Load template if provided
    if (templateId) {
      const template = db.getTemplate(templateId);
      if (template) {
        subject = template.subject || subject;
        content = template.content || content;
      }
    }

    // Replace variables in content
    content = this.replaceVariables(content, lead);
    subject = this.replaceVariables(subject || '', lead);

    // Send email
    const result = await EmailService.sendEmail({
      to: lead.clinic_email,
      subject: subject || 'Follow-up',
      html: content
    });

    // Create activity
    db.createLeadActivity({
      lead_id: lead.id,
      activity_type: 'email',
      activity_subject: subject || 'Email sent',
      activity_description: `Email sent via sequence`,
      metadata: JSON.stringify({
        template_id: templateId,
        email_result: result
      })
    });

    return { sent: true, type: 'email', recipient: lead.clinic_email };
  }

  /**
   * Execute SMS step
   */
  static async executeSMSStep(step, lead) {
    if (!lead.clinic_phone) {
      throw new Error('Lead has no phone number');
    }

    const templateId = step.template_id;
    let content = step.content;

    // Load template if provided
    if (templateId) {
      const template = db.getTemplate(templateId);
      if (template && template.content) {
        content = template.content;
      }
    }

    // Replace variables
    content = this.replaceVariables(content, lead);

    // Send SMS
    const result = await SMSService.sendSMS(lead.clinic_phone, content);

    // Create activity
    db.createLeadActivity({
      lead_id: lead.id,
      activity_type: 'sms',
      activity_subject: 'SMS sent',
      activity_description: `SMS sent via sequence`,
      metadata: JSON.stringify({
        template_id: templateId,
        sms_result: result
      })
    });

    return { sent: true, type: 'sms', recipient: lead.clinic_phone };
  }

  /**
   * Execute call step
   */
  static async executeCallStep(step, lead) {
    if (!lead.clinic_phone) {
      throw new Error('Lead has no phone number');
    }

    // Initiate outbound call using Retell
    // Note: This would use the sales agent configured in Retell
    const retellAgentId = process.env.RETELL_SALES_AGENT_ID;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    
    if (!retellAgentId) {
      throw new Error('Retell sales agent not configured');
    }

    if (!fromNumber) {
      throw new Error('Twilio phone number not configured');
    }

    try {
      const retellService = new RetellServiceClass();
      const result = await retellService.createOutboundCall(
        retellAgentId,
        fromNumber,
        lead.clinic_phone,
        {
          metadata: {
            lead_id: lead.id,
            sequence_step: 'call'
          },
          lead_id: lead.id,
          clinic_name: lead.clinic_name,
          call_type: 'sequence_automation'
        }
      );

      // Create activity
      db.createLeadActivity({
        lead_id: lead.id,
        activity_type: 'call',
        activity_subject: 'Outbound call initiated',
        activity_description: `Call initiated via sequence`,
        metadata: JSON.stringify({
          call_id: result.call_id,
          retell_result: result
        })
      });

      return { initiated: true, type: 'call', call_id: result.call_id };
    } catch (error) {
      console.error('Error initiating call:', error);
      throw error;
    }
  }

  /**
   * Execute condition step (conditional branching)
   */
  static async executeConditionStep(step, lead, sequence, execution) {
    // Simple condition evaluation
    // Future: Support more complex conditions
    const condition = step.condition || {};
    const field = condition.field;
    const operator = condition.operator; // eq, ne, gt, lt, contains, etc.
    const value = condition.value;

    let result = false;

    if (field === 'lead_score') {
      const leadScore = lead.lead_score || 0;
      result = this.evaluateCondition(leadScore, operator, value);
    } else if (field === 'is_qualified') {
      result = this.evaluateCondition(lead.is_qualified ? 1 : 0, operator, value ? 1 : 0);
    } else if (field === 'has_email') {
      result = this.evaluateCondition(lead.clinic_email ? 1 : 0, operator, 1);
    } else if (field === 'has_phone') {
      result = this.evaluateCondition(lead.clinic_phone ? 1 : 0, operator, 1);
    }

    // If condition is true, jump to step index in step.if_true
    // If false, jump to step index in step.if_false
    if (result && step.if_true !== undefined) {
      db.updateSequenceExecution(execution.id, {
        current_step: step.if_true
      });
    } else if (!result && step.if_false !== undefined) {
      db.updateSequenceExecution(execution.id, {
        current_step: step.if_false
      });
    }

    return { condition_result: result };
  }

  /**
   * Evaluate a condition
   */
  static evaluateCondition(left, operator, right) {
    switch (operator) {
      case 'eq':
        return left == right;
      case 'ne':
        return left != right;
      case 'gt':
        return left > right;
      case 'gte':
        return left >= right;
      case 'lt':
        return left < right;
      case 'lte':
        return left <= right;
      case 'contains':
        return String(left).includes(String(right));
      default:
        return false;
    }
  }

  /**
   * Replace variables in content with lead data
   */
  static replaceVariables(content, lead) {
    if (!content) return content;

    return content
      .replace(/\{\{lead\.name\}\}/g, lead.clinic_name || '')
      .replace(/\{\{lead\.clinic_name\}\}/g, lead.clinic_name || '')
      .replace(/\{\{lead\.location\}\}/g, lead.location || '')
      .replace(/\{\{lead\.phone\}\}/g, lead.clinic_phone || '')
      .replace(/\{\{lead\.email\}\}/g, lead.clinic_email || '');
  }

  /**
   * Pause a sequence execution
   */
  static pauseSequence(executionId) {
    return db.updateSequenceExecution(executionId, {
      status: 'paused',
      paused_at: new Date().toISOString()
    });
  }

  /**
   * Resume a paused sequence
   */
  static resumeSequence(executionId) {
    const execution = db.getSequenceExecution(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (execution.status !== 'paused') {
      throw new Error(`Execution is not paused: ${execution.status}`);
    }

    db.updateSequenceExecution(executionId, {
      status: 'active',
      paused_at: null
    });

    // Continue execution
    return this.executeNextStep(executionId);
  }

  /**
   * Stop a sequence execution
   */
  static stopSequence(executionId) {
    return db.updateSequenceExecution(executionId, {
      status: 'stopped',
      completed_at: new Date().toISOString()
    });
  }
}

module.exports = SequenceEngineService;

