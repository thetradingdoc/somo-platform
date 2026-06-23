'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateMerchantOrderCommerceIdempotency(db) {
  try {
    db.pragma('foreign_keys = OFF');
    const tableInfo = db.prepare('PRAGMA table_info(merchant_orders)').all();
    const columnNames = tableInfo.map((col) => col.name);
    if (!columnNames.includes('external_order_id')) {
      dbLog('📦 Adding external_order_id column to merchant_orders...');
      db.prepare('ALTER TABLE merchant_orders ADD COLUMN external_order_id TEXT').run();
    }
    try {
      db.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_orders_pi_unique
        ON merchant_orders(stripe_payment_intent_id)
        WHERE stripe_payment_intent_id IS NOT NULL AND length(trim(stripe_payment_intent_id)) > 0
      `).run();
    } catch (e) {
      console.warn('⚠️  merchant_orders stripe_payment_intent_id unique index:', e.message);
    }
    try {
      db.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_orders_vc_unique
        ON merchant_orders(voice_checkout_id)
        WHERE voice_checkout_id IS NOT NULL AND length(trim(voice_checkout_id)) > 0
      `).run();
    } catch (e) {
      console.warn('⚠️  merchant_orders voice_checkout_id unique index:', e.message);
    }
    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  merchant_orders commerce idempotency migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add merchant_id column to customers table

