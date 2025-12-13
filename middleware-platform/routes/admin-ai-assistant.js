/**
 * Admin AI Assistant Routes
 * Handles AI chat assistant for admin portal
 */

const express = require('express');
const { requireAdminAuth } = require('../middleware/admin-auth');
const { adminLimiter } = require('../middleware/rate-limiter');
const AdminAIAssistantService = require('../services/admin-ai-assistant-service');

const router = express.Router();

/**
 * POST /api/admin/ai/chat
 * Chat with AI assistant
 */
router.post('/chat', requireAdminAuth, adminLimiter, express.json(), async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    const response = await AdminAIAssistantService.processMessage(message.trim(), conversationHistory);

    res.json({
      success: true,
      ...response
    });
  } catch (error) {
    console.error('Admin AI chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process message',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/ai/suggestions
 * Get AI suggestions (action queue)
 */
router.get('/suggestions', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    // TODO: Implement action queue suggestions
    // For now, return empty suggestions
    res.json({
      success: true,
      suggestions: []
    });
  } catch (error) {
    console.error('Admin AI suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get suggestions',
      message: error.message
    });
  }
});

module.exports = router;

