/**
 * Get ALL Merchant IDs from all databases INCLUDING Azure Postgres
 * 
 * This script checks:
 * 1. Local SQLite databases (dev, prod, test)
 * 2. Azure Postgres (if POSTGRES_URL is set)
 * 
 * Usage:
 *   node scripts/get-all-merchants-including-azure.js
 * 
 * To check Azure, either:
 * - Run on Azure App Service Console (POSTGRES_URL is auto-set)
 * - Set POSTGRES_URL locally: POSTGRES_URL=postgresql://... node scripts/get-all-merchants-including-azure.js
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

console.log('\n🔍 GETTING ALL MERCHANT IDs (INCLUDING AZURE PRODUCTION)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const allMerchants = new Map(); // Use Map to deduplicate by ID

// Find all SQLite database files
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
      dbFiles.push({ path: dbPath, name: dbName });
    }
  });
});

// Remove duplicates
const uniqueDbFiles = [...new Map(dbFiles.map(f => [f.path, f])).values()];

console.log('📁 Checking Local SQLite databases...\n');

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
    
    const merchants = db.prepare('SELECT id, name, subdomain, status, created_at FROM merchants').all();
    
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
            created_at: m.created_at,
            sources: [`Local: ${dbName}`]
          });
        } else {
          // Add this database as another source
          allMerchants.get(m.id).sources.push(`Local: ${dbName}`);
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

// Check Azure Postgres
console.log('📡 Checking Azure Postgres Production...\n');

if (process.env.POSTGRES_URL) {
  console.log('✅ POSTGRES_URL detected');
  const hostMatch = process.env.POSTGRES_URL.match(/@([^:]+)/);
  console.log(`   Host: ${hostMatch ? hostMatch[1] : 'unknown'}\n`);
  
  (async () => {
    try {
      const { createPool } = require('../utils/postgres');
      const pgPool = createPool();
      
      console.log('📡 Connecting to Azure Postgres...\n');
      
      const merchants = await pgPool`
        SELECT id, name, subdomain, status, created_at 
        FROM merchants 
        ORDER BY created_at DESC
      `;
      
      if (merchants && merchants.length > 0) {
        console.log(`📦 Azure Postgres Production:`);
        console.log(`   Found ${merchants.length} merchant(s)\n`);
        
        merchants.forEach(m => {
          if (!allMerchants.has(m.id)) {
            allMerchants.set(m.id, {
              id: m.id,
              name: m.name,
              subdomain: m.subdomain,
              status: m.status,
              created_at: m.created_at,
              sources: ['Azure Postgres (Production)']
            });
          } else {
            // Add Azure as another source
            const existing = allMerchants.get(m.id);
            if (!existing.sources.includes('Azure Postgres (Production)')) {
              existing.sources.push('Azure Postgres (Production)');
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
      console.log(`   Stack: ${error.stack}\n`);
      displayResults();
    }
  })();
} else {
  console.log('⚠️  POSTGRES_URL not set - cannot check Azure Postgres');
  console.log('   To check Azure:');
  console.log('   1. Run on Azure App Service Console (env vars auto-set)');
  console.log('   2. Or set: POSTGRES_URL=postgresql://... node scripts/get-all-merchants-including-azure.js\n');
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
  
  // Separate by source
  const localOnly = merchantsArray.filter(m => !m.sources.some(s => s.includes('Azure')));
  const azureOnly = merchantsArray.filter(m => m.sources.every(s => s.includes('Azure')));
  const both = merchantsArray.filter(m => 
    m.sources.some(s => s.includes('Azure')) && 
    m.sources.some(s => s.includes('Local'))
  );
  
  console.log(`Total Unique Merchants: ${merchantsArray.length}`);
  console.log(`   - Local only: ${localOnly.length}`);
  console.log(`   - Azure only: ${azureOnly.length}`);
  console.log(`   - In both: ${both.length}\n`);
  
  // Show Azure merchants first (production)
  if (azureOnly.length > 0) {
    console.log('🌐 AZURE POSTGRES (PRODUCTION) ONLY:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    azureOnly.forEach((m, i) => {
      console.log(`${i + 1}. ${m.name || 'Unnamed'}`);
      console.log(`   ID: ${m.id}`);
      console.log(`   Subdomain: ${m.subdomain || 'NULL'}`);
      console.log(`   Status: ${m.status || 'N/A'}`);
      console.log(`   Created: ${m.created_at || 'N/A'}`);
      console.log(`   Source: ${m.sources.join(', ')}`);
      console.log('');
    });
  }
  
  // Show merchants in both
  if (both.length > 0) {
    console.log('🔄 IN BOTH LOCAL AND AZURE:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    both.forEach((m, i) => {
      console.log(`${i + 1}. ${m.name || 'Unnamed'}`);
      console.log(`   ID: ${m.id}`);
      console.log(`   Subdomain: ${m.subdomain || 'NULL'}`);
      console.log(`   Status: ${m.status || 'N/A'}`);
      console.log(`   Created: ${m.created_at || 'N/A'}`);
      console.log(`   Source: ${m.sources.join(', ')}`);
      console.log('');
    });
  }
  
  // Show local only
  if (localOnly.length > 0) {
    console.log('💻 LOCAL ONLY (NOT IN AZURE):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    localOnly.forEach((m, i) => {
      console.log(`${i + 1}. ${m.name || 'Unnamed'}`);
      console.log(`   ID: ${m.id}`);
      console.log(`   Subdomain: ${m.subdomain || 'NULL'}`);
      console.log(`   Status: ${m.status || 'N/A'}`);
      console.log(`   Created: ${m.created_at || 'N/A'}`);
      console.log(`   Source: ${m.sources.join(', ')}`);
      console.log('');
    });
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📝 ALL MERCHANT IDs (for copy/paste):\n');
  merchantsArray.forEach((m) => {
    console.log(`${m.id}`);
  });
  console.log('');
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n💡 TO CHECK AZURE PRODUCTION:');
  console.log('   Run on Azure App Service Console:');
  console.log('   cd /home/site/wwwroot/middleware-platform');
  console.log('   node scripts/get-all-merchants-including-azure.js');
  console.log('');
}



