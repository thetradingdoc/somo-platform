/**
 * Query Azure Database for Merchant ID
 * 
 * This script queries the Azure Postgres database to find the merchant_id
 * associated with the tenant subdomain "akin-dunbar"
 * 
 * Usage:
 *   NODE_ENV=production node scripts/query-azure-merchant-id.js akin-dunbar
 * 
 * Or set POSTGRES_URL environment variable:
 *   POSTGRES_URL=postgresql://... node scripts/query-azure-merchant-id.js akin-dunbar
 */

require('dotenv').config();

const subdomain = process.argv[2] || 'akin-dunbar';

console.log('\n🔍 QUERYING AZURE DATABASE FOR MERCHANT ID');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Subdomain: ${subdomain}\n`);

// Check if Postgres is configured
if (!process.env.POSTGRES_URL) {
    console.error('❌ POSTGRES_URL environment variable not set');
    console.error('   Please set POSTGRES_URL to your Azure Postgres connection string');
    console.error('   Example: POSTGRES_URL=postgresql://user:pass@host:5432/dbname');
    process.exit(1);
}

console.log('✅ POSTGRES_URL detected');
console.log(`   Host: ${process.env.POSTGRES_URL.match(/@([^:]+)/)?.[1] || 'unknown'}\n`);

async function queryMerchant() {
    try {
        // Import postgres utility
        const { createPool } = require('../utils/postgres');
        const pgPool = createPool();

        console.log('📡 Connecting to Azure Postgres...\n');

        // Query merchant by subdomain
        const merchantResult = await pgPool`
      SELECT id, name, subdomain, status, api_url, created_at
      FROM merchants
      WHERE subdomain = ${subdomain}
      LIMIT 1
    `;

        if (!merchantResult || merchantResult.length === 0) {
            console.log(`❌ Merchant not found with subdomain: ${subdomain}\n`);

            // List all merchants
            console.log('📋 All merchants in database:');
            const allMerchantsResult = await pgPool`
        SELECT id, name, subdomain, status
        FROM merchants
        ORDER BY created_at DESC
        LIMIT 20
      `;

            if (allMerchantsResult.length === 0) {
                console.log('   No merchants found in database');
            } else {
                allMerchantsResult.forEach((m, i) => {
                    console.log(`\n${i + 1}. ${m.name || 'Unnamed'}`);
                    console.log(`   ID: ${m.id}`);
                    console.log(`   Subdomain: ${m.subdomain || 'N/A'}`);
                    console.log(`   Status: ${m.status || 'N/A'}`);
                });
            }
            process.exit(1);
        }

        const m = merchantResult[0];

        console.log('✅ MERCHANT FOUND!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Merchant ID: ${m.id}`);
        console.log(`Name: ${m.name || 'N/A'}`);
        console.log(`Subdomain: ${m.subdomain || 'N/A'}`);
        console.log(`Status: ${m.status || 'N/A'}`);
        console.log(`API URL: ${m.api_url || 'N/A'}`);
        console.log(`Created: ${m.created_at || 'N/A'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        console.log('🎯 MERCHANT ID FOR AKIN-DUNBAR:');
        console.log(`   ${m.id}\n`);

        // Also check if there's a clinic associated
        const clinicResult = await pgPool`
      SELECT clinic_id, name, slug, merchant_id, retell_agent_id
      FROM clinics
      WHERE merchant_id = ${m.id}
      LIMIT 1
    `;

        if (clinicResult && clinicResult.length > 0) {
            const c = clinicResult[0];
            console.log('🏥 ASSOCIATED CLINIC:');
            console.log(`   Clinic ID: ${c.clinic_id}`);
            console.log(`   Name: ${c.name || 'N/A'}`);
            console.log(`   Slug: ${c.slug || 'N/A'}`);
            console.log(`   Retell Agent ID: ${c.retell_agent_id || 'N/A'}\n`);
        }

        // Close connection
        await pgPool.end();

    } catch (error) {
        console.error('❌ Error querying database:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

queryMerchant();

