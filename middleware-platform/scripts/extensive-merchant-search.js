/**
 * Extensive Merchant Search
 * Searches all databases and code for merchant IDs and tenants
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const targetMerchantId = 'd10794ff-ca11-4e6f-93e9-560162b4f884';
const targetTenant = 'doctor-little';

console.log('\n🔍 EXTENSIVE MERCHANT & TENANT SEARCH');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Target Merchant ID: ${targetMerchantId}`);
console.log(`Target Tenant: ${targetTenant}\n`);

// Find all database files
const dbFiles = [];
const searchPaths = [
  '/Users/jeremiahrichie',
  '/Users/jeremiahrichie/agentic-commerce-platform',
  '/Users/jeremiahrichie/agentic-commerce-platform/middleware-platform',
  process.cwd(),
  path.join(process.cwd(), '..')
];

searchPaths.forEach(basePath => {
  ['middleware-dev.db', 'middleware-prod.db', 'middleware-test.db'].forEach(dbName => {
    const dbPath = path.join(basePath, dbName);
    if (fs.existsSync(dbPath)) {
      dbFiles.push(dbPath);
    }
  });
});

// Remove duplicates
const uniqueDbFiles = [...new Set(dbFiles)];

console.log('📁 Found database files:');
uniqueDbFiles.forEach(f => console.log(`   - ${f}`));
console.log('');

// Search each database
for (const dbPath of uniqueDbFiles) {
  try {
    console.log(`\n📦 Searching: ${dbPath}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const db = new Database(dbPath);
    
    // Check if merchants table exists
    try {
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='merchants'").get();
      if (!tableCheck) {
        console.log('   ⚠️  No merchants table found');
        db.close();
        continue;
      }
    } catch (e) {
      console.log('   ⚠️  Cannot access database:', e.message);
      db.close();
      continue;
    }
    
    // Search for target merchant ID
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(targetMerchantId);
    if (merchant) {
      console.log(`\n✅ FOUND TARGET MERCHANT ID: ${targetMerchantId}`);
      console.log('   Name:', merchant.name || 'N/A');
      console.log('   Subdomain:', merchant.subdomain || 'N/A');
      console.log('   Status:', merchant.status || 'N/A');
      console.log('   API URL:', merchant.api_url || 'N/A');
    } else {
      console.log(`   ❌ Merchant ID ${targetMerchantId} NOT FOUND`);
    }
    
    // Search for doctor-little tenant
    const doctorLittle = db.prepare("SELECT * FROM merchants WHERE subdomain = ? OR name LIKE ?").get('doctor-little', '%doctor-little%');
    if (doctorLittle) {
      console.log(`\n✅ FOUND DOCTOR-LITTLE TENANT:`);
      console.log('   ID:', doctorLittle.id);
      console.log('   Name:', doctorLittle.name || 'N/A');
      console.log('   Subdomain:', doctorLittle.subdomain || 'N/A');
    } else {
      console.log(`   ❌ doctor-little tenant NOT FOUND`);
    }
    
    // List ALL merchants
    const allMerchants = db.prepare('SELECT id, name, subdomain, status FROM merchants ORDER BY created_at DESC').all();
    console.log(`\n📋 ALL MERCHANTS (${allMerchants.length} total):`);
    allMerchants.forEach((m, i) => {
      console.log(`   ${i+1}. ${m.name || 'Unnamed'}`);
      console.log(`      ID: ${m.id}`);
      console.log(`      Subdomain: ${m.subdomain || 'N/A'}`);
      console.log(`      Status: ${m.status || 'N/A'}`);
    });
    
    // Check clinics table for doctor-little
    try {
      const clinics = db.prepare("SELECT * FROM clinics WHERE slug = ? OR name LIKE ?").all('doctor-little', '%doctor-little%');
      if (clinics && clinics.length > 0) {
        console.log(`\n🏥 FOUND CLINICS WITH doctor-little:`);
        clinics.forEach((c, i) => {
          console.log(`   ${i+1}. ${c.name || 'Unnamed'}`);
          console.log(`      Clinic ID: ${c.clinic_id}`);
          console.log(`      Slug: ${c.slug || 'N/A'}`);
          console.log(`      Merchant ID: ${c.merchant_id || 'N/A'}`);
        });
      }
    } catch (e) {
      // Clinics table might not exist
    }
    
    db.close();
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

// Also check Postgres if available
if (process.env.POSTGRES_URL) {
  console.log('\n\n📡 CHECKING POSTGRES (Azure)...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  (async () => {
    try {
      const { createPool } = require('../utils/postgres');
      const pgPool = createPool();
      
      // Search for target merchant
      const merchantResult = await pgPool`
        SELECT * FROM merchants WHERE id = ${targetMerchantId}
      `;
      
      if (merchantResult && merchantResult.length > 0) {
        console.log(`\n✅ FOUND TARGET MERCHANT IN POSTGRES:`);
        const m = merchantResult[0];
        console.log('   ID:', m.id);
        console.log('   Name:', m.name || 'N/A');
        console.log('   Subdomain:', m.subdomain || 'N/A');
      } else {
        console.log(`   ❌ Merchant ID ${targetMerchantId} NOT FOUND in Postgres`);
      }
      
      // Search for doctor-little
      const doctorLittleResult = await pgPool`
        SELECT * FROM merchants WHERE subdomain = 'doctor-little' OR name LIKE '%doctor-little%'
      `;
      
      if (doctorLittleResult && doctorLittleResult.length > 0) {
        console.log(`\n✅ FOUND DOCTOR-LITTLE IN POSTGRES:`);
        doctorLittleResult.forEach((m, i) => {
          console.log(`   ${i+1}. ${m.name || 'Unnamed'}`);
          console.log(`      ID: ${m.id}`);
          console.log(`      Subdomain: ${m.subdomain || 'N/A'}`);
        });
      } else {
        console.log(`   ❌ doctor-little NOT FOUND in Postgres`);
      }
      
      // List all merchants
      const allMerchantsResult = await pgPool`
        SELECT id, name, subdomain, status FROM merchants ORDER BY created_at DESC
      `;
      
      console.log(`\n📋 ALL MERCHANTS IN POSTGRES (${allMerchantsResult.length} total):`);
      allMerchantsResult.forEach((m, i) => {
        console.log(`   ${i+1}. ${m.name || 'Unnamed'}`);
        console.log(`      ID: ${m.id}`);
        console.log(`      Subdomain: ${m.subdomain || 'N/A'}`);
      });
      
      await pgPool.end();
    } catch (error) {
      console.log(`   ❌ Postgres error: ${error.message}`);
    }
  })();
} else {
  console.log('\n📡 Postgres not configured (POSTGRES_URL not set)');
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');



