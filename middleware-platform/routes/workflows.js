/**
 * WORKFLOW API
 * 
 * Enhanced workflow endpoints with AI actions and testing
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const SequenceEngineService = require('../services/platform/sequence-engine-service');
const LeadIntelligenceService = require('../services/platform/lead-intelligence-service');
const AITemplateGeneratorService = require('../services/platform/ai-template-generator-service');
const { requireAdminAuth } = require('../middleware/admin-auth');
const { adminLimiter } = require('../middleware/rate-limiter');

/**
 * POST /api/admin/workflows/:id/test
 * Test a workflow/sequence with a sample lead
 */
router.post('/:id/test', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { lead_id, sample_lead } = req.body;

    // Get the sequence/workflow
    const sequence = db.getSequence(id);
    if (!sequence) {
      return res.status(404).json({
        success: false,
        error: 'Workflow not found'
      });
    }

    // Use provided lead_id or create test lead
    let testLead;
    if (lead_id) {
      testLead = db.getLead(lead_id);
      if (!testLead) {
        return res.status(404).json({
          success: false,
          error: 'Lead not found'
        });
      }
    } else if (sample_lead) {
      // Create temporary test lead
      testLead = {
        id: 'test-' + Date.now(),
        ...sample_lead,
        clinic_name: sample_lead.clinic_name || 'Test Clinic',
        clinic_email: sample_lead.clinic_email || 'test@example.com',
        clinic_phone: sample_lead.clinic_phone || '+15555555555',
        lead_score: sample_lead.lead_score || 50,
        pipeline_stage: sample_lead.pipeline_stage || 'new'
      };
    } else {
      // Default test lead
      testLead = {
        id: 'test-' + Date.now(),
        clinic_name: 'Test Clinic',
        clinic_email: 'test@example.com',
        clinic_phone: '+15555555555',
        lead_score: 60,
        pipeline_stage: 'new',
        location: 'NY',
        specialty: 'General'
      };
    }

    // Simulate workflow execution
    // getSequence already parses steps_json into steps, but handle both cases
    let steps = sequence.steps;
    if (!steps && sequence.steps_json) {
      steps = typeof sequence.steps_json === 'string' ? JSON.parse(sequence.steps_json) : sequence.steps_json;
    }
    if (!steps || !Array.isArray(steps)) {
      steps = [];
    }
    
    const executionResults = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const result = {
        step_index: i,
        step_type: step.type,
        status: 'pending',
        output: null,
        error: null
      };

      try {
        switch (step.type) {
          case 'email':
            result.status = 'simulated';
            result.output = {
              to: testLead.clinic_email,
              subject: step.subject || 'Test Email',
              template_used: step.template_id || null
            };
            break;

          case 'sms':
            result.status = 'simulated';
            result.output = {
              to: testLead.clinic_phone,
              template_used: step.template_id || null
            };
            break;

          case 'call':
            result.status = 'simulated';
            result.output = {
              to: testLead.clinic_phone,
              call_type: 'outbound'
            };
            break;

          case 'wait':
            result.status = 'simulated';
            result.output = {
              delay_hours: step.delay || 0
            };
            break;

          case 'condition':
            result.status = 'evaluated';
            const conditionMet = evaluateCondition(testLead, step.condition);
            result.output = {
              condition: step.condition,
              result: conditionMet,
              next_step: conditionMet ? step.if_true : step.if_false
            };
            break;

          default:
            result.status = 'skipped';
            result.output = { message: 'Unknown step type' };
        }

        executionResults.push(result);

        // If condition step and condition not met, skip to if_false step
        if (step.type === 'condition' && step.condition && !result.output.result) {
          if (step.if_false !== undefined && step.if_false !== null) {
            i = step.if_false - 1; // -1 because loop will increment
          }
        }
        // If condition step and condition met, jump to if_true step
        else if (step.type === 'condition' && step.condition && result.output.result) {
          if (step.if_true !== undefined && step.if_true !== null) {
            i = step.if_true - 1; // -1 because loop will increment
          }
        }

      } catch (error) {
        result.status = 'error';
        result.error = error.message;
        executionResults.push(result);
        break; // Stop execution on error
      }
    }

    res.json({
      success: true,
      workflow_id: id,
      workflow_name: sequence.name,
      test_lead: {
        id: testLead.id,
        clinic_name: testLead.clinic_name,
        clinic_email: testLead.clinic_email,
        clinic_phone: testLead.clinic_phone,
        lead_score: testLead.lead_score
      },
      execution_results: executionResults,
      summary: {
        total_steps: steps.length,
        executed_steps: executionResults.filter(r => r.status !== 'skipped').length,
        successful_steps: executionResults.filter(r => r.status === 'simulated' || r.status === 'evaluated').length,
        errors: executionResults.filter(r => r.status === 'error').length
      }
    });

  } catch (error) {
    console.error('❌ Test workflow error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test workflow',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/workflows/:id/execute-ai-action
 * Execute an AI action for a workflow step
 */
router.post('/:id/execute-ai-action', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { step_index, lead_id, ai_action, parameters } = req.body;

    const sequence = db.getSequence(id);
    if (!sequence) {
      return res.status(404).json({
        success: false,
        error: 'Workflow not found'
      });
    }

    const lead = db.getLead(lead_id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    // getSequence already parses steps_json into steps, but handle both cases
    let steps = sequence.steps;
    if (!steps && sequence.steps_json) {
      steps = typeof sequence.steps_json === 'string' ? JSON.parse(sequence.steps_json) : sequence.steps_json;
    }
    if (!steps || !Array.isArray(steps)) {
      return res.status(400).json({
        success: false,
        error: 'Workflow has no steps'
      });
    }
    
    const step = steps[step_index];

    if (!step || step.type !== 'ai' || !step.ai_action) {
      return res.status(400).json({
        success: false,
        error: 'Invalid AI action step'
      });
    }

    let result;

    switch (ai_action || step.ai_action) {
      case 'generate_message':
        if (!AITemplateGeneratorService.isAvailable()) {
          return res.status(503).json({
            success: false,
            error: 'AI Template Generator is not available (GROQ_API_KEY not configured)'
          });
        }

        const messageType = parameters?.type || 'email';
        const description = parameters?.description || `Personalized ${messageType} for ${lead.clinic_name}`;
        
        const generatedTemplate = await AITemplateGeneratorService.generateTemplate(
          sequence.merchant_id || null,
          messageType,
          description,
          ['{{lead.name}}', '{{lead.clinic_name}}', '{{lead.location}}']
        );

        result = {
          ai_action: 'generate_message',
          template: generatedTemplate,
          personalized_content: replaceVariables(generatedTemplate.content, lead)
        };
        break;

      case 'qualify_lead':
        const qualificationResult = LeadIntelligenceService.shouldAutoQualify(lead, sequence.merchant_id);
        result = {
          ai_action: 'qualify_lead',
          qualified: qualificationResult.qualified,
          reason: qualificationResult.reason,
          matched_rule: qualificationResult.matchedRule || null
        };
        break;

      case 'update_score':
        LeadIntelligenceService.updateLeadScore(lead.id);
        const updatedLead = db.getLead(lead.id);
        result = {
          ai_action: 'update_score',
          old_score: lead.lead_score || 0,
          new_score: updatedLead.lead_score || 0
        };
        break;

      case 'best_time':
        // Simple heuristic: suggest best contact time based on location/timezone
        // In production, this could use ML or historical data
        const suggestedTime = suggestBestContactTime(lead);
        result = {
          ai_action: 'best_time',
          suggested_time: suggestedTime,
          timezone: 'UTC-5' // Default, could be calculated from location
        };
        break;

      default:
        return res.status(400).json({
          success: false,
          error: `Unknown AI action: ${ai_action || step.ai_action}`
        });
    }

    res.json({
      success: true,
      workflow_id: id,
      step_index: step_index,
      lead_id: lead_id,
      result: result
    });

  } catch (error) {
    console.error('❌ Execute AI action error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute AI action',
      message: error.message
    });
  }
});

/**
 * Helper function to evaluate conditions
 */
function evaluateCondition(lead, condition) {
  if (!condition) return true;

  const { field, operator, value } = condition;
  const leadValue = lead[field];

  switch (operator) {
    case 'eq':
      return leadValue == value;
    case 'ne':
    case 'neq':
      return leadValue != value;
    case 'gt':
      return leadValue > value;
    case 'gte':
      return leadValue >= value;
    case 'lt':
      return leadValue < value;
    case 'lte':
      return leadValue <= value;
    case 'contains':
      return String(leadValue || '').toLowerCase().includes(String(value).toLowerCase());
    case 'not_contains':
      return !String(leadValue || '').toLowerCase().includes(String(value).toLowerCase());
    case 'starts_with':
      return String(leadValue || '').toLowerCase().startsWith(String(value).toLowerCase());
    case 'ends_with':
      return String(leadValue || '').toLowerCase().endsWith(String(value).toLowerCase());
    default:
      return false;
  }
}

/**
 * Helper function to replace variables in content
 */
function replaceVariables(content, lead) {
  if (!content) return content;

  return content
    .replace(/\{\{lead\.name\}\}/g, lead.clinic_name || '')
    .replace(/\{\{lead\.clinic_name\}\}/g, lead.clinic_name || '')
    .replace(/\{\{lead\.location\}\}/g, lead.location || '')
    .replace(/\{\{lead\.phone\}\}/g, lead.clinic_phone || '')
    .replace(/\{\{lead\.email\}\}/g, lead.clinic_email || '')
    .replace(/\{\{lead\.score\}\}/g, (lead.lead_score || 0).toString());
}

/**
 * Helper function to suggest best contact time
 */
function suggestBestContactTime(lead) {
  // Simple heuristic: suggest 10 AM - 2 PM in their timezone
  // In production, use ML or historical data
  return {
    time_of_day: '10:00 AM - 2:00 PM',
    day_of_week: 'Tuesday - Thursday',
    reason: 'Best response rates based on industry data'
  };
}

module.exports = router;

