/**
 * Get ALL Merchant IDs from all databases
 * 
 * Usage:
 *   node scripts/get-all-merchant-ids.js
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

console.log('\n🔍 GETTING ALL MERCHANT IDs');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const allMerchants = new Map(); // Use Map to deduplicate by ID

// Find all SQLite database files
const dbFiles = [];
const MP_ROOT = path.join(__dirname, '..');
const searchPaths = [
  MP_ROOT,
  path.join(MP_ROOT, 'var', 'db'),
  process.cwd(),
  path.join(process.cwd(), 'var', 'db'),
];

for (const basePath of searchPaths) {
  for (const dbName of ['middleware-dev.db', 'middleware-prod.db', 'middleware-test.db']) {
    for (const dbPath of [path.join(basePath, dbName), path.join(basePath, 'var', 'db', dbName)]) {
      if (fs.existsSync(dbPath)) {
        dbFiles.push({ path: dbPath, name: dbName });
      }
    }
  }
}

// Remove duplicates
const uniqueDbFiles = [...new Map(dbFiles.map(f => [f.path, f])).values()];

console.log('📁 Checking SQLite databases...\n');

// Query each SQLite database
for (const { path: dbPath, name: dbName } of uniqueDbFiles) {
  try {
    const db = new Database(dbPath);
    
    // Check if merchants table exists
    try {
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='merchants'").get();
      if (!tableCheck) {
        console.log(`   ⚠️  ${dbName}: No merchants table`);
        db.close();
        continue;
      }
    } catch (e) {
      console.log(`   ⚠️  ${dbName}: Cannot access - ${e.message}`);
      db.close();
      continue;
    }
    
    const merchants = db.prepare('SELECT id, name, subdomain, status FROM merchants').all();
    
    if (merchants.length > 0) {
      console.log(`📦 ${dbName} (${dbPath}):`);
      console.log(`   Found ${merchants.length} merchant(s)\n`);
      
      merchants.forEach(m => {
        if (!allMerchants.has(m.id)) {
          allMerchants.set(m.id, {
            id: m.id,
            name: m.name,
            subdomain: m.subdomain,
            status: m.status,
            sources: [dbName]
          });
        } else {
          // Add this database as another source
          allMerchants.get(m.id).sources.push(dbName);
        }
      });
    } else {
      console.log(`   ⚠️  ${dbName}: No merchants found\n`);
    }
    
    db.close();
  } catch (error) {
    console.log(`   ❌ ${dbName}: Error - ${error.message}\n`);
  }
}

// Check Azure Postgres if available
if (process.env.POSTGRES_URL) {
  console.log('📡 Checking Azure Postgres...\n');
  
  (async () => {
    try {
      const { createPool } = require('../utils/postgres');
      const pgPool = createPool();
      
      const merchants = await pgPool`
        SELECT id, name, subdomain, status FROM merchants ORDER BY created_at DESC
      `;
      
      if (merchants && merchants.length > 0) {
        console.log(`📦 Azure Postgres:`);
        console.log(`   Found ${merchants.length} merchant(s)\n`);
        
        merchants.forEach(m => {
          if (!allMerchants.has(m.id)) {
            allMerchants.set(m.id, {
              id: m.id,
              name: m.name,
              subdomain: m.subdomain,
              status: m.status,
              sources: ['Azure Postgres']
            });
          } else {
            // Add Azure as another source
            const existing = allMerchants.get(m.id);
            if (!existing.sources.includes('Azure Postgres')) {
              existing.sources.push('Azure Postgres');
            }
          }
        });
      } else {
        console.log(`   ⚠️  Azure Postgres: No merchants found\n`);
      }
      
      await pgPool.end();
      
      // Display results
      displayResults();
    } catch (error) {
      console.log(`   ❌ Azure Postgres: Error - ${error.message}\n`);
      displayResults();
    }
  })();
} else {
  console.log('📡 Azure Postgres: Not configured (POSTGRES_URL not set)\n');
  displayResults();
}

function displayResults() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 ALL MERCHANT IDs FOUND');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (allMerchants.size === 0) {
    console.log('❌ No merchants found in any database\n');
    return;
  }
  
  const merchantsArray = Array.from(allMerchants.values());
  
  console.log(`Total Unique Merchants: ${merchantsArray.length}\n`);
  
  merchantsArray.forEach((m, i) => {
    console.log(`${i + 1}. ${m.name || 'Unnamed'}`);
    console.log(`   ID: ${m.id}`);
    console.log(`   Subdomain: ${m.subdomain || 'NULL'}`);
    console.log(`   Status: ${m.status || 'N/A'}`);
    console.log(`   Found in: ${m.sources.join(', ')}`);
    console.log('');
  });
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📝 MERCHANT IDs ONLY (for copy/paste):\n');
  merchantsArray.forEach((m, i) => {
    console.log(`${m.id}`);
  });
  console.log('');
}



