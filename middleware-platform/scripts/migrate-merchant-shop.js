#!/usr/bin/env node

/**
 * Migration Script: Merchant Shop → Middleware
 * 
 * NOTE: This script is kept for historical reference only.
 * Merchant-shop has been fully merged into middleware.
 * 
 * If you have old merchant-shop data to migrate, run this script.
 * Otherwise, you can safely ignore this file.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Paths
const merchantShopDbPath = path.join(__dirname, '../../merchant-shop/merchant.db');
const middlewareDbPath = process.env.DB_PATH || path.join(__dirname, '../middleware-dev.db');

console.log('🔄 MERCHANT SHOP MIGRATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Check if merchant-shop database exists
if (!fs.existsSync(merchantShopDbPath)) {
  console.log('⚠️  Merchant shop database not found at:', merchantShopDbPath);
  console.log('   Skipping migration (no data to migrate)');
  process.exit(0);
}

// Check if middleware database exists
if (!fs.existsSync(middlewareDbPath)) {
  console.log('❌ Middleware database not found at:', middlewareDbPath);
  console.log('   Please start the middleware server first to create the database');
  process.exit(1);
}

console.log('📦 Source (merchant-shop):', merchantShopDbPath);
console.log('📦 Target (middleware):', middlewareDbPath);
console.log('');

try {
  // Open databases
  const merchantDb = new Database(merchantShopDbPath, { readonly: true });
  const middlewareDb = new Database(middlewareDbPath);

  // Migrate products
  console.log('📦 Migrating products...');
  const products = merchantDb.prepare('SELECT * FROM products').all();
  console.log(`   Found ${products.length} products`);

  let productsMigrated = 0;
  let productsSkipped = 0;

  for (const product of products) {
    try {
      // Check if product already exists
      const existing = middlewareDb.prepare('SELECT id FROM products WHERE id = ?').get(product.id);
      if (existing) {
        productsSkipped++;
        continue;
      }

      middlewareDb.prepare(`
        INSERT INTO products (id, merchant_id, name, description, price, inventory, image_url, category, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        product.id,
        null, // merchant_id (can be set later)
        product.name,
        product.description || null,
        product.price,
        product.inventory || 0,
        product.image_url || null,
        product.category || null,
        product.created_at || new Date().toISOString()
      );
      productsMigrated++;
    } catch (error) {
      console.error(`   ❌ Error migrating product ${product.id}:`, error.message);
    }
  }

  console.log(`   ✅ Migrated ${productsMigrated} products`);
  if (productsSkipped > 0) {
    console.log(`   ⚠️  Skipped ${productsSkipped} products (already exist)`);
  }

  // Migrate orders
  console.log('\n📋 Migrating orders...');
  const orders = merchantDb.prepare('SELECT * FROM orders').all();
  console.log(`   Found ${orders.length} orders`);

  let ordersMigrated = 0;
  let ordersSkipped = 0;

  for (const order of orders) {
    try {
      // Check if order already exists
      const existing = middlewareDb.prepare('SELECT id FROM merchant_orders WHERE id = ?').get(order.id);
      if (existing) {
        ordersSkipped++;
        continue;
      }

      middlewareDb.prepare(`
        INSERT INTO merchant_orders (
          id, merchant_id, product_id, quantity, customer_email, customer_name,
          customer_phone, shipping_address, total_amount, status, payment_status, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        order.id,
        null, // merchant_id (can be set later)
        order.product_id,
        order.quantity,
        order.customer_email,
        order.customer_name || null,
        null, // customer_phone (not in old schema)
        order.shipping_address || null,
        order.total_amount,
        order.status || 'pending',
        order.payment_status || 'pending',
        order.source || 'direct',
        order.created_at || new Date().toISOString()
      );
      ordersMigrated++;
    } catch (error) {
      console.error(`   ❌ Error migrating order ${order.id}:`, error.message);
    }
  }

  console.log(`   ✅ Migrated ${ordersMigrated} orders`);
  if (ordersSkipped > 0) {
    console.log(`   ⚠️  Skipped ${ordersSkipped} orders (already exist)`);
  }

  // Close databases
  merchantDb.close();
  middlewareDb.close();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ MIGRATION COMPLETE!');
  console.log(`   Products: ${productsMigrated} migrated, ${productsSkipped} skipped`);
  console.log(`   Orders: ${ordersMigrated} migrated, ${ordersSkipped} skipped`);
  console.log('\n💡 Next steps:');
  console.log('   1. Verify data in middleware database');
  console.log('   2. Update merchant_id fields if needed');
  console.log('   3. Test product/order endpoints');
  console.log('   4. Remove merchant-shop service (optional)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
}

