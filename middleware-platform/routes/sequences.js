/**
 * SEQUENCES API ROUTES
 * 
 * Handles CRUD operations for sequences and sequence executions
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const SequenceEngineService = require('../services/platform/sequence-engine-service');
const { requireAdminAuth } = require('../middleware/admin-auth');
const rateLimit = require('express-rate-limit');

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100 // 100 requests per minute
});

/**
 * GET /api/sequences
 * Get all sequences (optionally filtered by merchant_id)
 */
router.get('/', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { merchant_id, enabled } = req.query;
    const sequences = db.getSequences(merchant_id || null, enabled === 'true' ? true : enabled === 'false' ? false : null);

    res.json({
      success: true,
      sequences
    });
  } catch (error) {
    console.error('❌ Get sequences error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sequences',
      message: error.message
    });
  }
});

/**
 * GET /api/sequences/:id
 * Get a specific sequence
 */
router.get('/:id', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const sequence = db.getSequence(id);

    if (!sequence) {
      return res.status(404).json({
        success: false,
        error: 'Sequence not found'
      });
    }

    res.json({
      success: true,
      sequence
    });
  } catch (error) {
    console.error('❌ Get sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sequence',
      message: error.message
    });
  }
});

/**
 * POST /api/sequences
 * Create a new sequence
 */
router.post('/', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { name, description, steps, merchant_id, enabled } = req.body;

    if (!name || !steps || !Array.isArray(steps)) {
      return res.status(400).json({
        success: false,
        error: 'Name and steps (array) are required'
      });
    }

    const sequenceResult = db.createSequence({
      name,
      description,
      steps,
      merchant_id: merchant_id || null,
      enabled: enabled !== undefined ? enabled : true
    });

    res.json({
      success: true,
      sequence: db.getSequence(sequenceResult.id)
    });
  } catch (error) {
    console.error('❌ Create sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create sequence',
      message: error.message
    });
  }
});

/**
 * PUT /api/sequences/:id
 * Update a sequence
 */
router.put('/:id', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, steps, enabled } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (steps !== undefined) updates.steps = steps;
    if (enabled !== undefined) updates.enabled = enabled;

    const result = db.updateSequence(id, null, updates);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Sequence not found'
      });
    }

    res.json({
      success: true,
      sequence: db.getSequence(id)
    });
  } catch (error) {
    console.error('❌ Update sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update sequence',
      message: error.message
    });
  }
});

/**
 * DELETE /api/sequences/:id
 * Delete a sequence
 */
router.delete('/:id', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = db.deleteSequence(id);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Sequence not found'
      });
    }

    res.json({
      success: true,
      message: 'Sequence deleted'
    });
  } catch (error) {
    console.error('❌ Delete sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete sequence',
      message: error.message
    });
  }
});

/**
 * POST /api/sequences/:id/start
 * Start a sequence for a lead
 */
router.post('/:id/start', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { lead_id, metadata } = req.body;

    if (!lead_id) {
      return res.status(400).json({
        success: false,
        error: 'lead_id is required'
      });
    }

    const execution = await SequenceEngineService.startSequence(id, lead_id, metadata);

    res.json({
      success: true,
      execution
    });
  } catch (error) {
    console.error('❌ Start sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start sequence',
      message: error.message
    });
  }
});

/**
 * GET /api/sequences/executions
 * Get sequence executions (optionally filtered)
 */
router.get('/executions/list', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { sequence_id, lead_id, status } = req.query;
    const executions = db.getSequenceExecutions(sequence_id || null, lead_id || null, status || null);

    res.json({
      success: true,
      executions
    });
  } catch (error) {
    console.error('❌ Get executions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get executions',
      message: error.message
    });
  }
});

/**
 * GET /api/sequences/executions/:id
 * Get a specific execution
 */
router.get('/executions/:id', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const execution = db.getSequenceExecution(id);

    if (!execution) {
      return res.status(404).json({
        success: false,
        error: 'Execution not found'
      });
    }

    res.json({
      success: true,
      execution
    });
  } catch (error) {
    console.error('❌ Get execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get execution',
      message: error.message
    });
  }
});

/**
 * POST /api/sequences/executions/:id/pause
 * Pause a sequence execution
 */
router.post('/executions/:id/pause', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = SequenceEngineService.pauseSequence(id);

    res.json({
      success: true,
      message: 'Sequence paused'
    });
  } catch (error) {
    console.error('❌ Pause sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to pause sequence',
      message: error.message
    });
  }
});

/**
 * POST /api/sequences/executions/:id/resume
 * Resume a paused sequence
 */
router.post('/executions/:id/resume', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    await SequenceEngineService.resumeSequence(id);

    res.json({
      success: true,
      message: 'Sequence resumed'
    });
  } catch (error) {
    console.error('❌ Resume sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resume sequence',
      message: error.message
    });
  }
});

/**
 * POST /api/sequences/executions/:id/stop
 * Stop a sequence execution
 */
router.post('/executions/:id/stop', requireAdminAuth, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = SequenceEngineService.stopSequence(id);

    res.json({
      success: true,
      message: 'Sequence stopped'
    });
  } catch (error) {
    console.error('❌ Stop sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop sequence',
      message: error.message
    });
  }
});

module.exports = router;

