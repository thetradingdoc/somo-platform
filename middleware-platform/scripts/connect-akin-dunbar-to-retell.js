/**
 * Connect "akin-dunbar" tenant to Retell Agent
 * 
 * This script helps you connect the "akin-dunbar" tenant (which has products)
 * to your Retell agent so that search_products function calls work.
 * 
 * Usage:
 *   NODE_ENV=production node scripts/connect-akin-dunbar-to-retell.js
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Determine database path (same logic as database.js)
const env = process.env.NODE_ENV || 'development';
const isProdEnv = env === 'production' || env === 'prod';
const defaultDbDir = isProdEnv ? '/home' : (process.env.HOME || '/home' || __dirname);

let dbFileName;
if (process.env.DB_NAME) {
  dbFileName = process.env.DB_NAME;
} else if (isProdEnv) {
  dbFileName = 'middleware-prod.db';
} else if (env === 'test') {
  dbFileName = 'middleware-test.db';
} else {
  dbFileName = 'middleware-dev.db';
}

const dbPath = path.join(defaultDbDir, dbFileName);
console.log(`📁 Using database: ${dbPath}\n`);

const db = new Database(dbPath);

// Get Retell Agent ID from environment or use default
const RETELL_AGENT_ID = process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a';

console.log('🔗 CONNECTING AKIN-DUNBAR TO RETELL');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Step 1: Find the merchant for "akin-dunbar"
console.log('Step 1: Finding merchant for "akin-dunbar"...');
const merchant = db.prepare('SELECT * FROM merchants WHERE subdomain = ?').get('akin-dunbar');

if (!merchant) {
  console.error('❌ Merchant with subdomain "akin-dunbar" not found!');
  console.error('   Please ensure the merchant exists in the database.\n');
  process.exit(1);
}

console.log(`✅ Found merchant: ${merchant.name}`);
console.log(`   ID: ${merchant.id}`);
console.log(`   Subdomain: ${merchant.subdomain}\n`);

// Step 2: Check if clinic already exists
console.log('Step 2: Checking for existing clinic...');
const existingClinic = db.prepare('SELECT * FROM clinics WHERE slug = ? OR merchant_id = ?').get('akin-dunbar', merchant.id);

if (existingClinic) {
  console.log(`✅ Found existing clinic: ${existingClinic.name}`);
  console.log(`   Clinic ID: ${existingClinic.clinic_id}`);
  console.log(`   Retell Agent ID: ${existingClinic.retell_agent_id || 'NOT SET'}`);
  console.log(`   Merchant ID: ${existingClinic.merchant_id || 'NOT SET'}\n`);
  
  // Update clinic to link to Retell agent and merchant
  if (!existingClinic.retell_agent_id || !existingClinic.merchant_id) {
    console.log('Step 3: Updating clinic to link Retell agent and merchant...');
    db.prepare(`
      UPDATE clinics 
      SET retell_agent_id = ?,
          merchant_id = ?,
          updated_at = datetime('now')
      WHERE clinic_id = ?
    `).run(
      RETELL_AGENT_ID,
      merchant.id,
      existingClinic.clinic_id
    );
    console.log(`✅ Updated clinic to link Retell agent (${RETELL_AGENT_ID}) and merchant (${merchant.id})\n`);
  } else {
    console.log('✅ Clinic already linked to Retell agent and merchant\n');
  }
} else {
  // Step 3: Create new clinic
  console.log('Step 3: Creating new clinic for "akin-dunbar"...');
  const clinicId = uuidv4();
  
  db.prepare(`
    INSERT INTO clinics (
      clinic_id, name, slug, merchant_id, retell_agent_id, 
      retell_agent_status, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    clinicId,
    merchant.name || 'Akin Dunbar',
    'akin-dunbar',
    merchant.id,
    RETELL_AGENT_ID,
    'active',
    1
  );
  
  console.log(`✅ Created clinic: ${clinicId}`);
  console.log(`   Linked to merchant: ${merchant.id}`);
  console.log(`   Linked to Retell agent: ${RETELL_AGENT_ID}\n`);
}

// Step 4: Verify the connection
console.log('Step 4: Verifying connection...');
const clinic = db.prepare('SELECT * FROM clinics WHERE slug = ?').get('akin-dunbar');

if (clinic && clinic.retell_agent_id === RETELL_AGENT_ID && clinic.merchant_id === merchant.id) {
  console.log('✅ Connection verified!\n');
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 CONNECTION SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`Clinic ID: ${clinic.clinic_id}`);
  console.log(`Clinic Name: ${clinic.name || 'Akin Dunbar'}`);
  console.log(`Clinic Slug: ${clinic.slug}`);
  console.log(`Retell Agent ID: ${clinic.retell_agent_id}`);
  console.log(`Merchant ID: ${clinic.merchant_id}`);
  console.log(`Merchant Name: ${merchant.name}`);
  console.log(`Merchant Subdomain: ${merchant.subdomain}\n`);
  
  // Check products
  const products = db.prepare('SELECT COUNT(*) as count FROM products WHERE merchant_id = ?').get(merchant.id);
  console.log(`Products linked to merchant: ${products.count}\n`);
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ SETUP COMPLETE!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('How Retell will find merchant_id:');
  console.log('1. ✅ Retell agent_id lookup → finds clinic → gets merchant_id');
  console.log('2. ✅ Default tenant fallback → finds merchant by subdomain "akin-dunbar"');
  console.log('\nThe search_products function should now work! 🎉\n');
  
} else {
  console.error('❌ Connection verification failed!');
  console.error('   Please check the database manually.\n');
  process.exit(1);
}

db.close();

