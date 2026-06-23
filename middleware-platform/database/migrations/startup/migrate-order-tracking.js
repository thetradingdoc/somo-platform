'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateOrderTracking(db) {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(merchant_orders)").all();
    const columnNames = tableInfo.map(col => col.name);

    const trackingFields = {
      'delivery_status': "TEXT DEFAULT 'pending'",
      'driver_name': 'TEXT',
      'driver_phone': 'TEXT',
      'current_latitude': 'REAL',
      'current_longitude': 'REAL',
      'current_address': 'TEXT',
      'estimated_arrival': 'DATETIME',
      'last_location_update': 'DATETIME',
      'tracking_events': 'TEXT', // JSON array of tracking events
      'pickup_address': 'TEXT', // Pickup/from location (store/warehouse)
      'pickup_latitude': 'REAL', // Pickup location coordinates
      'pickup_longitude': 'REAL',
      'drop_point': 'TEXT', // Drop point/delivery address (same as shipping_address but explicit)
      commerce_quote_id: 'TEXT',
      voice_checkout_id: 'TEXT',
      stripe_payment_intent_id: 'TEXT'
    };

    let addedCount = 0;
    for (const [fieldName, fieldType] of Object.entries(trackingFields)) {
      if (!columnNames.includes(fieldName)) {
        dbLog(`📦 Adding ${fieldName} column to merchant_orders table...`);
        db.prepare(`ALTER TABLE merchant_orders ADD COLUMN ${fieldName} ${fieldType}`).run();
        addedCount++;
      }
    }

    if (addedCount > 0) {
      dbLog(`✅ Migration complete: ${addedCount} tracking columns added to merchant_orders`);
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  Order tracking migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: external_order_id + partial unique indexes for commerce idempotency (PI / voice checkout)

