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
    const visitMode = (req.query.visit_mode || 'sync_video').toString().trim();
    if (!clinicId) {
      return res.status(400).json({ success: false, error: 'clinic_id is required' });
    }
    const pricing = db.getEffectiveVisitPrice(clinicId, appointmentType);
    if (!pricing) {
      return res.status(404).json({ success: false, error: 'Pricing not found' });
    }
    const basePrice = pricing.base_price ?? pricing.effective_price ?? 0;
    const multiplier = visitMode === 'async_review' ? 0.6 : 1;
    const effectivePrice = basePrice * multiplier;
    res.json({
      success: true,
      clinic_id: clinicId,
      appointment_type: appointmentType,
      visit_mode: visitMode,
      base_price: basePrice,
      effective_price: effectivePrice,
      ...pricing,
      ...(visitMode === 'async_review' ? { effective_price: effectivePrice, async_discount: 0.6 } : {})
    });
  } catch (error) {
    console.error('GET /api/pricing error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Phase 1: deterministic region pricing quote (fast, no network calls)
// GET /api/pricing/quote?country=US OR ?phone_country_code=+263 OR ?phone=+2637...
router.get('/quote', (req, res) => {
  try {
    const PHONE_MAP = require('../config/phone-country-map');
    const countryRaw = (req.query.country || req.query.country_code || '').toString().trim().toUpperCase();
    const phoneCountryCode = (req.query.phone_country_code || '').toString().trim();
    const phone = (req.query.phone || '').toString().trim();

    let iso2 = countryRaw || '';
    if (!iso2 && phoneCountryCode) iso2 = PHONE_MAP[phoneCountryCode] || '';
    if (!iso2 && phone.startsWith('+')) {
      // longest prefix match
      const keys = Object.keys(PHONE_MAP).sort((a, b) => b.length - a.length);
      const hit = keys.find(k => phone.startsWith(k));
      if (hit) iso2 = PHONE_MAP[hit] || '';
    }

    // Default to US if unknown (deterministic)
    if (!iso2) iso2 = 'US';

    const TIERS = {
      HIGH: { tier: 'HIGH', price_usd: 150, floor_usd: 25 },
      MID: { tier: 'MID', price_usd: 75, floor_usd: 25 },
      STANDARD: { tier: 'STANDARD', price_usd: 45, floor_usd: 25 },
      ACCESS: { tier: 'ACCESS', price_usd: 25, floor_usd: 25 }
    };

    const COUNTRY_TO_TIER = {
      // Tier 1
      US: 'HIGH', GB: 'HIGH', AE: 'HIGH', QA: 'HIGH',
      // Tier 2
      BR: 'MID', ZA: 'MID', MX: 'MID', PL: 'MID',
      // Tier 3
      IN: 'STANDARD', VN: 'STANDARD', KE: 'STANDARD',
      // Tier 4
      ZW: 'ACCESS', UG: 'ACCESS', NA: 'ACCESS', PG: 'ACCESS'
    };

    const tierKey = COUNTRY_TO_TIER[iso2] || 'STANDARD';
    const t = TIERS[tierKey] || TIERS.STANDARD;
    let price = Math.max(t.floor_usd, t.price_usd);
    const visitMode = (req.query.visit_mode || 'sync_video').toString().trim();
    if (visitMode === 'async_review') price *= 0.6;

    return res.json({
      success: true,
      iso2,
      tier: t.tier,
      currency: 'USD',
      visit_mode: visitMode,
      price_usd: price,
      price_usd_cents: Math.round(price * 100),
      floor_usd: t.floor_usd
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
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
