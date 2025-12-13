/**
 * Find Merchant ID for akin-dunbar
 * 
 * This script tries both SQLite (local) and Postgres (Azure) to find the merchant_id
 * 
 * Usage:
 *   node scripts/find-merchant-id-akin-dunbar.js
 */

require('dotenv').config();

const subdomain = 'akin-dunbar';

console.log('\n🔍 FINDING MERCHANT ID FOR:', subdomain);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

async function findMerchant() {
  let merchant = null;
  let source = '';

  // Try SQLite first (local database)
  try {
    console.log('📦 Trying SQLite database...');
    const Database = require('better-sqlite3');
    const path = require('path');
    const fs = require('fs');
    
    const env = process.env.NODE_ENV || 'development';
    const isProdEnv = env === 'production' || env === 'prod';
    const defaultDbDir = isProdEnv ? '/home' : (process.env.HOME || '/home' || __dirname);
    
    let dbFileName;
    if (process.env.DB_NAME) {
      dbFileName = process.env.DB_NAME;
    } else if (env === 'production' || env === 'prod') {
      dbFileName = 'middleware-prod.db';
    } else if (env === 'test') {
      dbFileName = 'middleware-test.db';
    } else {
      dbFileName = 'middleware-dev.db';
    }
    
    const dbPath = path.join(defaultDbDir, dbFileName);
    
    // Try multiple possible locations
    const possiblePaths = [
      dbPath,
      path.join(__dirname, '..', dbFileName),
      path.join(process.cwd(), dbFileName),
      path.join(process.cwd(), 'middleware-platform', dbFileName)
    ];
    
    for (const tryPath of possiblePaths) {
      if (fs.existsSync(tryPath)) {
        console.log(`   Found database at: ${tryPath}`);
        const db = new Database(tryPath);
        merchant = db.prepare('SELECT * FROM merchants WHERE subdomain = ?').get(subdomain);
        if (merchant) {
          source = `SQLite (${tryPath})`;
          db.close();
          break;
        }
        db.close();
      }
    }
    
    if (merchant) {
      console.log('   ✅ Found in SQLite!\n');
    } else {
      console.log('   ⚠️  Not found in SQLite\n');
    }
  } catch (error) {
    console.log('   ⚠️  SQLite error:', error.message, '\n');
  }

  // Try Postgres (Azure)
  if (!merchant && process.env.POSTGRES_URL) {
    try {
      console.log('📡 Trying Postgres database (Azure)...');
      const { createPool } = require('../utils/postgres');
      const pgPool = createPool();
      
      const result = await pgPool`
        SELECT id, name, subdomain, status, api_url, created_at
        FROM merchants
        WHERE subdomain = ${subdomain}
        LIMIT 1
      `;
      
      if (result && result.length > 0) {
        merchant = result[0];
        source = 'Postgres (Azure)';
        console.log('   ✅ Found in Postgres!\n');
      } else {
        console.log('   ⚠️  Not found in Postgres\n');
      }
      
      await pgPool.end();
    } catch (error) {
      console.log('   ⚠️  Postgres error:', error.message, '\n');
    }
  } else if (!merchant && !process.env.POSTGRES_URL) {
    console.log('📡 Postgres not configured (POSTGRES_URL not set)\n');
  }

  // Display results
  if (merchant) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MERCHANT FOUND!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Source: ${source}`);
    console.log(`Merchant ID: ${merchant.id}`);
    console.log(`Name: ${merchant.name || 'N/A'}`);
    console.log(`Subdomain: ${merchant.subdomain || 'N/A'}`);
    console.log(`Status: ${merchant.status || 'N/A'}`);
    if (merchant.api_url) {
      console.log(`API URL: ${merchant.api_url}`);
    }
    if (merchant.created_at) {
      console.log(`Created: ${merchant.created_at}`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('🎯 MERCHANT ID FOR AKIN-DUNBAR:');
    console.log(`   ${merchant.id}\n`);
    
    return merchant.id;
  } else {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('❌ MERCHANT NOT FOUND');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('The merchant with subdomain "akin-dunbar" was not found in:');
    console.log('  - SQLite databases (local)');
    if (process.env.POSTGRES_URL) {
      console.log('  - Postgres database (Azure)');
    } else {
      console.log('  - Postgres database (not configured - POSTGRES_URL missing)');
    }
    console.log('\n💡 To query Azure Postgres, set POSTGRES_URL in your .env file');
    console.log('   Example: POSTGRES_URL=postgresql://user:pass@host:5432/dbname\n');
    process.exit(1);
  }
}

findMerchant().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});



