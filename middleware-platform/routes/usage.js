/**
 * Usage Tracking API Routes
 * Endpoints for viewing usage and costs
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const UsageTracker = require('../services/platform/usage-tracker');

/**
 * Get usage summary for a customer
 * GET /api/usage/:customer_id
 */
router.get('/:customer_id', async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { start_date, end_date } = req.query;
    
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end_date || new Date().toISOString().split('T')[0];
    
    const summary = UsageTracker.getUsageSummary(customer_id, startDate, endDate);
    
    res.json({
      success: true,
      summary
    });
  } catch (error) {
    console.error('❌ Error getting usage summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get API usage logs for a customer
 * GET /api/usage/:customer_id/api-calls
 */
router.get('/:customer_id/api-calls', async (req, res) => {
  try {
    const { customer_id } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const logs = db.getAPIUsageByCustomer(customer_id, limit);
    
    res.json({
      success: true,
      logs,
      count: logs.length
    });
  } catch (error) {
    console.error('❌ Error getting API usage logs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get voice call logs for a customer
 * GET /api/usage/:customer_id/voice-calls
 */
router.get('/:customer_id/voice-calls', async (req, res) => {
  try {
    const { customer_id } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const logs = db.getVoiceCallsByCustomer(customer_id, limit);
    
    res.json({
      success: true,
      logs,
      count: logs.length
    });
  } catch (error) {
    console.error('❌ Error getting voice call logs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get function call logs for a customer
 * GET /api/usage/:customer_id/function-calls
 */
router.get('/:customer_id/function-calls', async (req, res) => {
  try {
    const { customer_id } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const logs = db.getFunctionCallsByCustomer(customer_id, limit);
    
    res.json({
      success: true,
      logs,
      count: logs.length
    });
  } catch (error) {
    console.error('❌ Error getting function call logs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get cost breakdown for a customer
 * GET /api/usage/:customer_id/costs
 */
router.get('/:customer_id/costs', async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { start_date, end_date } = req.query;
    
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end_date || new Date().toISOString().split('T')[0];
    
    const summary = UsageTracker.getUsageSummary(customer_id, startDate, endDate);
    const cost = UsageTracker.calculateCost(customer_id, summary.metrics);
    
    res.json({
      success: true,
      period: { start: startDate, end: endDate },
      usage: summary,
      cost
    });
  } catch (error) {
    console.error('❌ Error getting costs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Trigger usage aggregation for a customer
 * POST /api/usage/:customer_id/aggregate
 */
router.post('/:customer_id/aggregate', async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { date } = req.body;
    
    const result = await UsageTracker.aggregateDailyUsage(customer_id, date);
    
    res.json(result);
  } catch (error) {
    console.error('❌ Error aggregating usage:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

