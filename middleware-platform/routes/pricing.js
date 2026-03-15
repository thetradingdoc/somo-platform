/**
 * Visit Pricing API (Tasks 16–17, 26, 54)
 * GET /api/pricing - Get effective price for clinic + appointment type
 * POST /api/admin/pricing - Upsert visit pricing (admin only, per-clinic RBAC, audit log)
 */

const express = require('express');
const db = require('../database');

const router = express.Router();

// Task 26: Per-clinic RBAC - allowed clinic IDs for admin (env comma-separated; empty = all clinics)
const ADMIN_CLINIC_IDS = (process.env.ADMIN_PRICING_CLINIC_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function canAdminModifyPricing(clinicId) {
  if (ADMIN_CLINIC_IDS.length === 0) return true;
  return ADMIN_CLINIC_IDS.includes(String(clinicId).trim());
}

function logPricingAudit(req, { clinic_id, appointment_type, action, old_row, new_base_price, new_surge }) {
  if (!db.insertPricingAuditLog) return;
  db.insertPricingAuditLog({
    clinic_id,
    appointment_type,
    action,
    old_base_price: old_row?.base_price ?? null,
    new_base_price,
    old_surge_multiplier: old_row?.surge_multiplier ?? null,
    new_surge_multiplier: new_surge ?? 1.0,
    actor_id: req.adminSession?.id?.slice(0, 12) || null,
    ip: req.ip || null
  });
}

/**
 * GET /api/pricing
 * Query: clinic_id, appointment_type (optional, defaults to 'General Consult')
 * Used by create_appointment_checkout flow (same source as db.getEffectiveVisitPrice).
 */
router.get('/', (req, res) => {
  try {
    const clinicId = req.query.clinic_id || null;
    const appointmentType = req.query.appointment_type || 'General Consult';
    if (!clinicId) {
      return res.status(400).json({ success: false, error: 'clinic_id is required' });
    }
    const pricing = db.getEffectiveVisitPrice(clinicId, appointmentType);
    if (!pricing) {
      return res.status(404).json({ success: false, error: 'Pricing not found' });
    }
    res.json({
      success: true,
      clinic_id: clinicId,
      appointment_type: appointmentType,
      ...pricing
    });
  } catch (error) {
    console.error('GET /api/pricing error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/pricing (mount under /api/admin, requires admin auth)
 * Task 26: RBAC - admin may only modify clinics in ADMIN_PRICING_CLINIC_IDS (empty = all).
 * Task 54: Audit log for every pricing change.
 * Body: { clinic_id, appointment_type, base_price, surge_multiplier? }
 */
function postPricing(req, res) {
  try {
    const { clinic_id, appointment_type, base_price, surge_multiplier } = req.body;
    if (!clinic_id || appointment_type == null || base_price == null) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id, appointment_type, and base_price are required'
      });
    }

    if (!canAdminModifyPricing(clinic_id)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to modify pricing for this clinic'
      });
    }

    const oldRow = db.getVisitPricing ? db.getVisitPricing(clinic_id, appointment_type) : null;
    const newSurge = surge_multiplier != null ? parseFloat(surge_multiplier) : 1.0;

    db.upsertVisitPricing({
      clinic_id,
      appointment_type: String(appointment_type),
      base_price: parseFloat(base_price),
      surge_multiplier: newSurge
    });
    const row = db.getVisitPricing(clinic_id, appointment_type);

    logPricingAudit(req, {
      clinic_id,
      appointment_type,
      action: oldRow ? 'update' : 'create',
      old_row: oldRow,
      new_base_price: parseFloat(base_price),
      new_surge: newSurge
    });

    res.json({ success: true, pricing: row });
  } catch (error) {
    console.error('POST /api/admin/pricing error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = router;
module.exports.postPricing = postPricing;
