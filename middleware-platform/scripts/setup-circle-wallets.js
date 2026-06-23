/**
 * Setup Circle Wallets for Test Accounts
 * Creates wallets for Provider, Insurer, and test Patients
 * 
 * Requires:
 * - CIRCLE_API_KEY in .env file
 * - CIRCLE_ENTITY_SECRET in .env file (get from Circle Console)
 * 
 * Documentation: https://developers.circle.com/sdk-explorer/developer-controlled-wallets/Node.js/getting-started
 */

require('dotenv').config();
const db = require('../database');
const CircleService = require('../services/platform/circle-service');

async function setupCircleWallets() {
    console.log('🚀 Setting up Circle wallets for test accounts...\n');
    console.log('📚 Using Circle Node.js SDK for Developer-Controlled Wallets\n');

    // Check if SDK is available
    if (!CircleService.isAvailable()) {
        console.error('❌ Circle SDK not available or entity secret not configured.');
        console.error('\n💡 Setup Instructions:');
        console.error('   1. Install Circle SDK: npm install @circle-fin/developer-controlled-wallets');
        console.error('   2. Get your Entity Secret from Circle Console: https://console.circle.com');
        console.error('   3. Add to .env file: CIRCLE_ENTITY_SECRET=your_entity_secret');
        console.error('   4. Make sure CIRCLE_API_KEY is also set in .env file');
        console.error('\n📖 Documentation: https://developers.circle.com/interactive-quickstarts/get-started');
        return;
    }

    try {
        // Step 1: Create a wallet set (required for developer-controlled wallets)
        console.log('📦 Step 1: Creating wallet set...');
        const walletSetResult = await CircleService.createWalletSet({
            name: 'Healthcare Billing Wallets',
            description: 'Wallet set for Provider, Insurer, and Patient accounts'
        });

        if (!walletSetResult.success) {
            console.error(`❌ Failed to create wallet set: ${walletSetResult.error}`);
            if (walletSetResult.details) {
                console.error('   Details:', JSON.stringify(walletSetResult.details, null, 2));
            }
            return;
        }

        const walletSetId = walletSetResult.walletSetId;
        console.log(`✅ Wallet set created: ${walletSetId}\n`);

        // Step 2: Create wallets for each entity
        const entities = [
            { type: 'provider', id: 'default', description: 'Default Provider Wallet' },
            { type: 'insurer', id: 'TEST_INSURER_001', description: 'Test Insurer Wallet' },
            { type: 'insurer', id: 'TEST_INSURER_002', description: 'Test Insurer Wallet 2' },
            { type: 'patient', id: 'default', description: 'Patient Wallet' },
        ];

        console.log('📦 Step 2: Creating wallets for entities...\n');

        for (const entity of entities) {
            try {
                console.log(`   Creating wallet for ${entity.type}:${entity.id}...`);

                // Check if wallet already exists
                const existing = db.getCircleAccountByEntity(entity.type, entity.id);
                if (existing) {
                    console.log(`   ⚠️  Wallet already exists in database: ${existing.circle_wallet_id}`);
                    console.log(`   ✅ Skipping creation (wallet ID: ${existing.circle_wallet_id})\n`);
                    continue;
                }

                // Create wallet via Circle SDK
                const result = await CircleService.createWallet({
                    walletSetId: walletSetId,
                    entityType: entity.type,
                    entityId: entity.id,
                    description: entity.description
                });

                if (!result.success) {
                    console.error(`   ❌ Failed to create wallet: ${result.error}`);
                    if (result.details) {
                        console.error(`      Details:`, JSON.stringify(result.details, null, 2));
                    }
                    continue;
                }

                // Store in database
                const accountId = `circle-account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                db.createCircleAccount({
                    id: accountId,
                    entity_type: entity.type,
                    entity_id: entity.id,
                    circle_wallet_id: result.walletId,
                    currency: 'USDC',
                    status: 'active'
                });

                console.log(`   ✅ Wallet created successfully: ${result.walletId}`);
                
                // Get wallet balance
                const balanceResult = await CircleService.getWalletBalance(result.walletId);
                if (balanceResult.success) {
                    console.log(`   💰 Wallet balance:`, JSON.stringify(balanceResult.balances, null, 2));
                }
                console.log('');
            } catch (error) {
                console.error(`   ❌ Error creating wallet for ${entity.type}:${entity.id}:`, error.message);
                console.error(`      Stack:`, error.stack);
            }
        }

        console.log('✅ Circle wallet setup complete!');
        console.log('\n📋 Summary:');
        console.log(`   Wallet Set ID: ${walletSetId}`);
        console.log('   Provider wallets: Check database for provider accounts');
        console.log('   Insurer wallets: Check database for insurer accounts');
        console.log('   Patient wallets: Will be created on-demand when needed');
        console.log('\n💡 Next Steps:');
        console.log('   1. Verify wallets in Circle Console: https://console.circle.com');
        console.log('   2. Fund test wallets if needed for testing');
        console.log('   3. Test payment transfers between wallets');
        
    } catch (error) {
        console.error('❌ Fatal error during setup:', error.message);
        console.error('   Stack:', error.stack);
    }
}

// Run setup
setupCircleWallets().catch(console.error);
