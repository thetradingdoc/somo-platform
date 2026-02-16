/**
 * Research Bounties API
 * Pharma Data Requests for Impact-Weighted Escrow.
 * POST to create bounty, GET to list, PATCH to update fulfillment.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const EscrowOrchestrator = require('../services/escrow-orchestrator-service');
const SettlementService = require('../services/settlement-service');
const ProofOfCareService = require('../services/proof-of-care-service');

/**
 * GET /api/research-bounties
 * List bounties (optional ?status=open)
 */
router.get('/', (req, res) => {
  try {
    const status = req.query.status;
    const limit = parseInt(req.query.limit, 10) || 50;
    const bounties = db.listResearchBounties({ status, limit });
    res.json({ success: true, bounties });
  } catch (err) {
    console.error('List research bounties error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/research-bounties/:id
 */
router.get('/:id', (req, res) => {
  try {
    const bounty = db.getResearchBounty(req.params.id);
    if (!bounty) return res.status(404).json({ success: false, error: 'Bounty not found' });
    res.json({ success: true, bounty });
  } catch (err) {
    console.error('Get research bounty error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/research-bounties
 * Create Pharma data request (e.g., "Need 100 pediatric cancer scans").
 */
router.post('/', (req, res) => {
  try {
    const { requester_id, title, description, data_type, target_count, bounty_amount_per_unit, impact_tier = 1 } = req.body;
    if (!title || !target_count || !bounty_amount_per_unit) {
      return res.status(400).json({ success: false, error: 'title, target_count, bounty_amount_per_unit required' });
    }
    const totalBountyAmount = target_count * bounty_amount_per_unit;
    const id = db.createResearchBounty({
      requester_id,
      title,
      description,
      data_type,
      target_count,
      bounty_amount_per_unit,
      total_bounty_amount: totalBountyAmount,
      impact_tier,
      status: 'open'
    });
    const bounty = db.getResearchBounty(id);
    res.status(201).json({ success: true, bounty });
  } catch (err) {
    console.error('Create research bounty error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/research-bounties/:id/fulfill
 * Increment fulfilled_count. When fulfilled_count >= target_count, escrow can release.
 */
router.patch('/:id/fulfill', (req, res) => {
  try {
    const bounty = db.getResearchBounty(req.params.id);
    if (!bounty) return res.status(404).json({ success: false, error: 'Bounty not found' });
    const increment = parseInt(req.body.increment, 10) || 1;
    const newCount = (bounty.fulfilled_count || 0) + increment;
    db.updateResearchBounty(req.params.id, { fulfilled_count: newCount });
    const updated = db.getResearchBounty(req.params.id);
    res.json({ success: true, bounty: updated });
  } catch (err) {
    console.error('Fulfill bounty error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/research-bounties/:id/release-check
 * Check if Data Request can trigger escrow release (for relayer).
 */
router.get('/:id/release-check', async (req, res) => {
  try {
    const bounty = db.getResearchBounty(req.params.id);
    if (!bounty) return res.status(404).json({ success: false, error: 'Bounty not found' });

    const proofOfCare = { verified: !!bounty.escrow_hash };
    const route = await EscrowOrchestrator.getDataRequestSettlementRoute({
      bounty,
      fulfillmentCount: bounty.fulfilled_count || 0,
      proofOfCare
    });

    const splits = bounty.escrow_hash
      ? SettlementService.computeImpactWeightedSplits(bounty.total_bounty_amount, SettlementService.getImpactWeightMultiplier(bounty.impact_tier || 1))
      : null;

    res.json({
      success: true,
      canRelease: route.canRelease,
      route: route.route,
      fulfillmentCount: bounty.fulfilled_count,
      targetCount: bounty.target_count,
      fulfilled: route.fulfilled,
      splits,
      escrowHash: bounty.escrow_hash
    });
  } catch (err) {
    console.error('Release check error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
