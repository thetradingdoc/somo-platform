'use strict';

const db = require('../database');
const { isIsoDateOnly } = require('./patient-portal-shared');

function ensurePatientShelfInventoryColumns() {
  const addCol = (sql) => {
    try {
      db.db.prepare(sql).run();
    } catch (_) {}
  };
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN opened_date TEXT');
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN expiry_date TEXT');
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN pao_months INTEGER');
  addCol("ALTER TABLE patient_onboarding_step3_products ADD COLUMN inventory_status TEXT DEFAULT 'stock'");
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN price_usd REAL');
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN key_ingredients TEXT');
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN display_color TEXT');
}

function formatShelfProductApiRow(r) {
  const { safeParseJsonArray } = require('./patient-portal-shared');
  return {
    id: r.id,
    product_name: r.custom_product_name || r.product_name || 'Product',
    selection_mode: r.selection_mode,
    catalog_product_id: r.catalog_product_id,
    custom_brand: r.custom_brand,
    category: r.category,
    usage_time: r.usage_time,
    frequency_rule: r.frequency_rule,
    days_of_week: safeParseJsonArray(r.days_of_week_json),
    goal: r.goal,
    opened_date: r.opened_date,
    expiry_date: r.expiry_date,
    pao_months: r.pao_months,
    inventory_status: r.inventory_status,
    price_usd: r.price_usd,
    key_ingredients: r.key_ingredients,
    display_color: r.display_color,
    updated_at: r.updated_at,
  };
}

function loadPatientShelfProductRows(sessionId) {
  ensurePatientShelfInventoryColumns();
  return db.db
    .prepare(`
      SELECT id, selection_mode, catalog_product_id, custom_product_name, custom_brand, category, usage_time,
        frequency_rule, days_of_week_json, goal, opened_date, expiry_date, pao_months, inventory_status,
        price_usd, key_ingredients, display_color, updated_at
      FROM patient_onboarding_step3_products
      WHERE session_id = ?
      ORDER BY datetime(updated_at) DESC
    `)
    .all(sessionId);
}

module.exports = {
  ensurePatientShelfInventoryColumns,
  formatShelfProductApiRow,
  loadPatientShelfProductRows,
};
