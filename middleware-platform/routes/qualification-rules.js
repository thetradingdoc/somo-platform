/**
 * QUALIFICATION RULES API ROUTES
 * 
 * Handles CRUD operations for configurable lead qualification rules
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const LeadIntelligenceService = require('../services/lead-intelligence-service');
const { requireAdminAuth } = require('../middleware/admin-auth');
const rateLimit = require('express-rate-limit');

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100 // 100 requests per minute
});

/**
 * GET /api/qualification-rules
 * Get all qualification rules (optionally filtered by merchant_id)
 */
router.get('/', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { merchant_id, enabled } = req.query;
    const rules = db.getQualificationRules(merchant_id || null, enabled === 'true' ? true : enabled === 'false' ? false : null);

    res.json({
      success: true,
      rules
    });
  } catch (error) {
    console.error('❌ Get qualification rules error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get qualification rules',
      message: error.message
    });
  }
});

/**
 * GET /api/qualification-rules/:id
 * Get a specific qualification rule
 */
router.get('/:id', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const rule = db.getQualificationRule(id);

    if (!rule) {
      return res.status(404).json({
        success: false,
        error: 'Qualification rule not found'
      });
    }

    res.json({
      success: true,
      rule
    });
  } catch (error) {
    console.error('❌ Get qualification rule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get qualification rule',
      message: error.message
    });
  }
});

/**
 * POST /api/qualification-rules
 * Create a new qualification rule
 */
router.post('/', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { name, description, rules, merchant_id, enabled, priority } = req.body;

    if (!name || !rules || !Array.isArray(rules)) {
      return res.status(400).json({
        success: false,
        error: 'Name and rules (array) are required'
      });
    }

    // Validate rules structure
    for (const rule of rules) {
      if (!rule.field || !rule.operator || rule.value === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Each rule must have field, operator, and value'
        });
      }
    }

    const ruleResult = db.createQualificationRule({
      name,
      description,
      rules,
      merchant_id: merchant_id || null,
      enabled: enabled !== undefined ? enabled : true,
      priority: priority || 5
    });

    res.json({
      success: true,
      rule: db.getQualificationRule(ruleResult.id)
    });
  } catch (error) {
    console.error('❌ Create qualification rule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create qualification rule',
      message: error.message
    });
  }
});

/**
 * PUT /api/qualification-rules/:id
 * Update a qualification rule
 */
router.put('/:id', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, rules, enabled, priority } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (rules !== undefined) {
      // Validate rules structure
      if (!Array.isArray(rules)) {
        return res.status(400).json({
          success: false,
          error: 'Rules must be an array'
        });
      }
      for (const rule of rules) {
        if (!rule.field || !rule.operator || rule.value === undefined) {
          return res.status(400).json({
            success: false,
            error: 'Each rule must have field, operator, and value'
          });
        }
      }
      updates.rules = rules;
    }
    if (enabled !== undefined) updates.enabled = enabled;
    if (priority !== undefined) updates.priority = priority;

    const result = db.updateQualificationRule(id, null, updates);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Qualification rule not found'
      });
    }

    res.json({
      success: true,
      rule: db.getQualificationRule(id)
    });
  } catch (error) {
    console.error('❌ Update qualification rule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update qualification rule',
      message: error.message
    });
  }
});

/**
 * DELETE /api/qualification-rules/:id
 * Delete a qualification rule
 */
router.delete('/:id', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = db.deleteQualificationRule(id);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Qualification rule not found'
      });
    }

    res.json({
      success: true,
      message: 'Qualification rule deleted'
    });
  } catch (error) {
    console.error('❌ Delete qualification rule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete qualification rule',
      message: error.message
    });
  }
});

/**
 * POST /api/qualification-rules/test
 * Test qualification rules against a lead
 */
router.post('/test', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { lead_id, rules } = req.body;

    if (!lead_id && !rules) {
      return res.status(400).json({
        success: false,
        error: 'Either lead_id or rules (array) is required'
      });
    }

    let lead;
    if (lead_id) {
      lead = db.getLead(lead_id);
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: 'Lead not found'
        });
      }
    } else {
      // Use provided lead data
      lead = req.body.lead || {};
    }

    let rulesToTest;
    if (rules && Array.isArray(rules)) {
      // Test provided rules
      rulesToTest = rules.map(rule => ({
        id: 'test',
        name: 'Test Rule',
        rules: Array.isArray(rule.rules) ? rule.rules : [rule],
        enabled: true,
        priority: rule.priority || 5
      }));
    } else {
      // Test all active rules
      rulesToTest = db.getQualificationRules(null, true);
    }

    // Test each rule
    const results = rulesToTest.map(rule => {
      const qualificationResult = LeadIntelligenceService.shouldAutoQualify(lead, null);
      return {
        rule_id: rule.id,
        rule_name: rule.name,
        matched: qualificationResult.qualified && qualificationResult.matchedRule?.id === rule.id,
        reason: qualificationResult.reason
      };
    });

    // Overall qualification result
    const overallResult = LeadIntelligenceService.shouldAutoQualify(lead, null);

    res.json({
      success: true,
      lead: {
        id: lead.id || 'test',
        clinic_name: lead.clinic_name,
        lead_score: lead.lead_score || 0,
        has_phone: !!(lead.clinic_phone && lead.clinic_phone.trim()),
        has_email: !!(lead.clinic_email && lead.clinic_email.trim())
      },
      overall_qualified: overallResult.qualified,
      overall_reason: overallResult.reason,
      matched_rule: overallResult.matchedRule,
      rule_results: results
    });
  } catch (error) {
    console.error('❌ Test qualification rules error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test qualification rules',
      message: error.message
    });
  }
});

module.exports = router;

