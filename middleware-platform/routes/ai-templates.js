/**
 * AI TEMPLATE GENERATOR API ROUTES
 * 
 * Handles AI-powered template generation, optimization, and variations
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const AITemplateGenerator = require('../services/platform/ai-template-generator-service');
const { requireAdminAuth } = require('../middleware/admin-auth');
const rateLimit = require('express-rate-limit');

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50 // 50 requests per minute (AI calls can be expensive)
});

/**
 * POST /api/ai/templates/generate
 * Generate a new template using AI
 */
router.post('/generate', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { description, type, tone, purpose, includeVariables, maxLength, merchant_id } = req.body;

    if (!description) {
      return res.status(400).json({
        success: false,
        error: 'Description is required'
      });
    }

    if (!AITemplateGenerator.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'AI template generator is not available. Please configure GROQ_API_KEY.'
      });
    }

    const result = await AITemplateGenerator.generateTemplate(description, {
      type: type || 'email',
      tone: tone || 'professional',
      purpose: purpose || 'follow-up',
      includeVariables: includeVariables !== false,
      maxLength: maxLength || (type === 'sms' ? 160 : 500)
    });

    // Optionally save the template
    if (merchant_id && req.body.save) {
      const template = db.createTemplate({
        merchant_id: merchant_id,
        name: req.body.name || `AI Generated: ${description.substring(0, 50)}`,
        type: result.template.type,
        subject: result.template.subject,
        content: result.template.content,
        variables: result.template.variables
      });

      result.template.id = template.lastInsertRowid?.toString() || template.id;
      result.template.saved = true;
    }

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('❌ AI template generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate template',
      message: error.message
    });
  }
});

/**
 * POST /api/ai/templates/:id/optimize
 * Optimize an existing template using AI
 */
router.post('/:id/optimize', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { focusAreas, apply } = req.body;

    if (!AITemplateGenerator.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'AI template generator is not available. Please configure GROQ_API_KEY.'
      });
    }

    const result = await AITemplateGenerator.optimizeTemplate(id, focusAreas || []);

    // Optionally apply the optimization
    if (apply === true) {
      const template = db.getTemplate(id);
      if (template) {
        db.updateTemplate(id, template.merchant_id, {
          subject: result.optimized.subject,
          content: result.optimized.content
        });
        result.applied = true;
      }
    }

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('❌ AI template optimization error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to optimize template',
      message: error.message
    });
  }
});

/**
 * POST /api/ai/templates/:id/variations
 * Generate variations of a template
 */
router.post('/:id/variations', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { count = 3 } = req.body;

    if (!AITemplateGenerator.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'AI template generator is not available. Please configure GROQ_API_KEY.'
      });
    }

    const result = await AITemplateGenerator.generateVariations(id, count);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('❌ AI template variations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate variations',
      message: error.message
    });
  }
});

/**
 * POST /api/ai/templates/:id/suggestions
 * Get performance suggestions for a template
 */
router.post('/:id/suggestions', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { performanceData } = req.body;

    if (!AITemplateGenerator.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'AI template generator is not available. Please configure GROQ_API_KEY.'
      });
    }

    const result = await AITemplateGenerator.getPerformanceSuggestions(id, performanceData || {});

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('❌ AI template suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get suggestions',
      message: error.message
    });
  }
});

/**
 * GET /api/ai/templates/status
 * Check if AI template generator is available
 */
router.get('/status', requireAdminAuth, adminLimiter, (req, res) => {
  res.json({
    success: true,
    available: AITemplateGenerator.isAvailable(),
    message: AITemplateGenerator.isAvailable() 
      ? 'AI template generator is ready' 
      : 'AI template generator is not available. Configure GROQ_API_KEY to enable.'
  });
});

module.exports = router;

