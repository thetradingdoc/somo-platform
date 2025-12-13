/**
 * Check Azure Postgres for doctor-little tenant and account
 * 
 * This script is designed to run on Azure App Service Console where
 * POSTGRES_URL is available as an environment variable.
 * 
 * To run on Azure:
 *   1. Go to Azure Portal → App Service → Console
 *   2. cd /home/site/wwwroot/middleware-platform
 *   3. node scripts/check-azure-doctor-little-remote.js
 * 
 * Or run locally with POSTGRES_URL set:
 *   POSTGRES_URL=postgresql://... node scripts/check-azure-doctor-little-remote.js
 */

// Don't use dotenv on Azure - env vars come from App Settings
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (e) {
    // dotenv not available - continue
  }
}

const email = 'doctorjay254+1000@gmail.com';
const subdomain = 'doctor-little';

console.log('\n🔍 CHECKING AZURE POSTGRES FOR DOCTOR-LITTLE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Email: ${email}`);
console.log(`Subdomain: ${subdomain}\n`);

if (!process.env.POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable not set');
  console.error('   On Azure: This should be set in App Settings');
  console.error('   Locally: Set POSTGRES_URL=postgresql://user:pass@host:5432/dbname');
  process.exit(1);
}

console.log('✅ POSTGRES_URL detected');
const hostMatch = process.env.POSTGRES_URL.match(/@([^:]+)/);
console.log(`   Host: ${hostMatch ? hostMatch[1] : 'unknown'}\n`);

(async () => {
  try {
    const { createPool } = require('../utils/postgres');
    const pgPool = createPool();
    
    console.log('📡 Connected to Azure Postgres\n');
    
    // 1. Search for customer by email
    console.log('1️⃣  SEARCHING FOR CUSTOMER BY EMAIL:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const customers = await pgPool`
      SELECT id, name, email, merchant_id, customer_type, status, email_verified, created_at
      FROM customers
      WHERE email = ${email}
    `;
    
    if (customers.length > 0) {
      const customer = customers[0];
      console.log('✅ CUSTOMER FOUND:');
      console.log(JSON.stringify(customer, null, 2));
      console.log('');
      
      // 2. Get merchant for this customer
      if (customer.merchant_id) {
        console.log('2️⃣  SEARCHING FOR MERCHANT:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const merchants = await pgPool`
          SELECT id, name, subdomain, status, api_url, created_at
          FROM merchants
          WHERE id = ${customer.merchant_id}
        `;
        
        if (merchants.length > 0) {
          const merchant = merchants[0];
          console.log('✅ MERCHANT FOUND:');
          console.log(JSON.stringify(merchant, null, 2));
          console.log('');
          
          if (!merchant.subdomain || merchant.subdomain !== subdomain) {
            console.log('⚠️  ISSUE DETECTED:');
            console.log(`   Current subdomain: ${merchant.subdomain || 'NULL'}`);
            console.log(`   Expected subdomain: ${subdomain}`);
            console.log(`   The merchant exists but subdomain is not set correctly!\n`);
            
            console.log('💡 TO FIX: Run this SQL on Azure Postgres:');
            console.log(`   UPDATE merchants SET subdomain = '${subdomain}' WHERE id = '${merchant.id}';\n`);
          } else {
            console.log('✅ Subdomain is correctly set!\n');
          }
        } else {
          console.log(`❌ Merchant not found for ID: ${customer.merchant_id}\n`);
        }
      } else {
        console.log('⚠️  Customer has no merchant_id\n');
      }
    } else {
      console.log('❌ Customer not found with email:', email);
      console.log('');
      
      // Search for similar emails
      console.log('🔍 Searching for similar emails...');
      const similarCustomers = await pgPool`
        SELECT id, name, email, merchant_id, created_at
        FROM customers
        WHERE email LIKE '%doctorjay254%'
        ORDER BY created_at DESC
        LIMIT 10
      `;
      
      if (similarCustomers.length > 0) {
        console.log(`\n📋 Found ${similarCustomers.length} customers with similar email:`);
        similarCustomers.forEach((c, i) => {
          console.log(`   ${i+1}. ${c.email} (ID: ${c.id}, Merchant: ${c.merchant_id || 'N/A'})`);
        });
        console.log('');
      }
    }
    
    // 3. Search for merchants with doctor-little subdomain
    console.log('3️⃣  SEARCHING FOR MERCHANTS WITH SUBDOMAIN "doctor-little":');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const doctorLittleMerchants = await pgPool`
      SELECT id, name, subdomain, status, api_url, created_at
      FROM merchants
      WHERE subdomain = ${subdomain}
    `;
    
    if (doctorLittleMerchants.length > 0) {
      console.log(`✅ Found ${doctorLittleMerchants.length} merchant(s) with subdomain "${subdomain}":`);
      doctorLittleMerchants.forEach((m, i) => {
        console.log(`\n   ${i+1}. ${m.name}`);
        console.log(`      ID: ${m.id}`);
        console.log(`      Subdomain: ${m.subdomain}`);
        console.log(`      Status: ${m.status}`);
        console.log(`      Created: ${m.created_at}`);
      });
      console.log('');
    } else {
      console.log(`❌ No merchants found with subdomain "${subdomain}"\n`);
    }
    
    // 4. Search for merchants with "doctor" or "little" in name/subdomain
    console.log('4️⃣  SEARCHING FOR MERCHANTS WITH "doctor" OR "little":');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const doctorMerchants = await pgPool`
      SELECT id, name, subdomain, status, created_at
      FROM merchants
      WHERE LOWER(name) LIKE '%doctor%' OR LOWER(name) LIKE '%little%' 
         OR LOWER(subdomain) LIKE '%doctor%' OR LOWER(subdomain) LIKE '%little%'
      ORDER BY created_at DESC
    `;
    
    if (doctorMerchants.length > 0) {
      console.log(`✅ Found ${doctorMerchants.length} merchant(s):`);
      doctorMerchants.forEach((m, i) => {
        console.log(`\n   ${i+1}. ${m.name}`);
        console.log(`      ID: ${m.id}`);
        console.log(`      Subdomain: ${m.subdomain || 'NULL ⚠️'}`);
        console.log(`      Status: ${m.status}`);
      });
      console.log('');
    } else {
      console.log('❌ No merchants found with "doctor" or "little"\n');
    }
    
    // 5. List all merchants (last 20)
    console.log('5️⃣  ALL MERCHANTS (last 20):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const allMerchants = await pgPool`
      SELECT id, name, subdomain, status, created_at
      FROM merchants
      ORDER BY created_at DESC
      LIMIT 20
    `;
    
    if (allMerchants.length > 0) {
      console.log(`📋 Total merchants shown: ${allMerchants.length}\n`);
      allMerchants.forEach((m, i) => {
        console.log(`   ${i+1}. ${m.name || 'Unnamed'}`);
        console.log(`      ID: ${m.id}`);
        console.log(`      Subdomain: ${m.subdomain || 'NULL ⚠️'}`);
        console.log(`      Status: ${m.status || 'N/A'}`);
        console.log(`      Created: ${m.created_at || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('❌ No merchants found in database\n');
    }
    
    await pgPool.end();
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Query complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('❌ Error querying Postgres:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
})();



