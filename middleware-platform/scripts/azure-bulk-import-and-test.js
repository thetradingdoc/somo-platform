/**
 * Azure Bulk Import Products and Test Voice Agent
 * 
 * This script should be run in Azure App Service Console:
 *   cd /home/site/wwwroot/middleware-platform
 *   NODE_ENV=production node scripts/azure-bulk-import-and-test.js akin-dunbar
 */

require('dotenv').config();

const path = require('path');
const axios = require('axios');

// Ensure we are running from project root
const projectRoot = path.join(__dirname, '..');
process.chdir(projectRoot);

const db = require('../database');

// Product data extracted from images
const PRODUCTS = [
    // EXOTICS - Premium Tier ($45-240)
    {
        name: 'MONA LISA',
        description: '60% Indica / 40% Sativa, THC: 28%',
        category: 'Exotics',
        prices: [
            { size: '1/8', price: 45 },
            { size: '1/4', price: 80 },
            { size: '1/2', price: 140 },
            { size: 'OZ', price: 240 }
        ]
    },
    {
        name: 'ZLUSHIES',
        description: '40% Sativa / 60% Indica, THC: 25%',
        category: 'Exotics',
        prices: [
            { size: '1/8', price: 45 },
            { size: '1/4', price: 80 },
            { size: '1/2', price: 140 },
            { size: 'OZ', price: 240 }
        ]
    },
    {
        name: 'CHERRY ZLUSHIES',
        description: '60% Indica / 40% Sativa, THC: 30%',
        category: 'Exotics',
        prices: [
            { size: '1/8', price: 45 },
            { size: '1/4', price: 90 },
            { size: '1/2', price: 165 },
            { size: 'OZ', price: 350 }
        ]
    },
    {
        name: 'PINK PICASSO',
        description: '50% Indica / 50% Sativa, THC: 30%',
        category: 'Exotics',
        prices: [
            { size: '1/8', price: 45 },
            { size: '1/4', price: 90 },
            { size: '1/2', price: 165 },
            { size: 'OZ', price: 350 }
        ]
    },
    {
        name: 'ZAFFYS',
        description: 'Premium exotic strain',
        category: 'Exotics',
        prices: [
            { size: '1/8', price: 45 },
            { size: '1/4', price: 90 },
            { size: '1/2', price: 165 },
            { size: 'OZ', price: 350 }
        ]
    },
    {
        name: 'JUICY DROP\'Z',
        description: 'Indica Dominant, THC: 31%',
        category: 'Exotics',
        prices: [
            { size: '1/8', price: 45 },
            { size: '1/4', price: 90 },
            { size: '1/2', price: 165 },
            { size: 'OZ', price: 350 }
        ]
    },
    {
        name: 'BROOKLYN GUMBO',
        description: '65% Indica / 35% Sativa, THC: 28%',
        category: 'Exotics',
        prices: [
            { size: '1/8', price: 45 },
            { size: '1/4', price: 90 },
            { size: '1/2', price: 165 },
            { size: 'OZ', price: 350 }
        ]
    },
    {
        name: 'PURPLE URKLE',
        description: '70% Indica / 30% Sativa, THC: 26%',
        category: 'Exotics',
        prices: [
            { size: '1/8', price: 45 },
            { size: '1/4', price: 90 },
            { size: '1/2', price: 165 },
            { size: 'OZ', price: 350 }
        ]
    },

    // MIDS - Standard Tier ($30-180)
    {
        name: 'GMO',
        description: '90% Sativa / 10% Indica, THC: 24%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 30 },
            { size: '1/4', price: 55 },
            { size: '1/2', price: 105 },
            { size: 'OZ', price: 130 }
        ]
    },
    {
        name: 'CHERRY PIE',
        description: '80% Indica / 20% Sativa, THC: 24%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 30 },
            { size: '1/4', price: 55 },
            { size: '1/2', price: 105 },
            { size: 'OZ', price: 130 }
        ]
    },
    {
        name: 'GARY PAYTON',
        description: '50% Sativa / 50% Indica, THC: 25%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 30 },
            { size: '1/4', price: 55 },
            { size: '1/2', price: 110 },
            { size: 'OZ', price: 150 }
        ]
    },
    {
        name: 'BLACK DIAMOND',
        description: '70% Indica / 30% Sativa, THC: 24%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 30 },
            { size: '1/4', price: 55 },
            { size: '1/2', price: 105 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'PURPLE PESO',
        description: 'Indica Dominant, THC: 22%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 30 },
            { size: '1/4', price: 55 },
            { size: '1/2', price: 105 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'OREO',
        description: '70% Indica / 30% Sativa, THC: 22%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 30 },
            { size: '1/4', price: 55 },
            { size: '1/2', price: 105 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'KANDY KRUSH',
        description: '75% Indica / 25% Sativa, THC: 23%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 35 },
            { size: '1/4', price: 65 },
            { size: '1/2', price: 110 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'BLUE RUNTZ',
        description: '65% Indica / 35% Sativa, THC: 26%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 35 },
            { size: '1/4', price: 65 },
            { size: '1/2', price: 110 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'GMO KUSH',
        description: '60% Indica / 40% Sativa, THC: 25%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 35 },
            { size: '1/4', price: 65 },
            { size: '1/2', price: 110 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'ROCK CANDY',
        description: '80% Indica / 20% Sativa, THC: 22%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 35 },
            { size: '1/4', price: 65 },
            { size: '1/2', price: 110 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'COOKIES',
        description: '60% Indica / 40% Sativa, THC: 24%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 35 },
            { size: '1/4', price: 65 },
            { size: '1/2', price: 110 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'LEMON CHERRY',
        description: '50% Indica / 50% Sativa, THC: 25%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 35 },
            { size: '1/4', price: 65 },
            { size: '1/2', price: 110 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'LAFFY TAFFY',
        description: '60% Sativa / 40% Indica, THC: 24%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 35 },
            { size: '1/4', price: 65 },
            { size: '1/2', price: 110 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'BLUE NERDS',
        description: '50% Sativa / 50% Indica, THC: 22%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 35 },
            { size: '1/4', price: 65 },
            { size: '1/2', price: 110 },
            { size: 'OZ', price: 180 }
        ]
    },
    {
        name: 'UNICORN PISS',
        description: '50% Indica / 50% Sativa, THC: 24%',
        category: 'Mids',
        prices: [
            { size: '1/8', price: 35 },
            { size: '1/4', price: 65 },
            { size: '1/2', price: 110 },
            { size: 'OZ', price: 180 }
        ]
    },

    // SPECIALTY ITEMS
    {
        name: 'GOLDEN TEACHER MUSHROOMS',
        description: 'Psilocybe Cubensis species. Contains psilocybin and psilocin. Provides unique healing qualities and euphoric experience.',
        category: 'Mushrooms',
        prices: [
            { size: '1g', price: 50 }
        ]
    },
    {
        name: 'MYSTERY BAGS',
        description: '3.5g mystery selection',
        category: 'Mystery',
        prices: [
            { size: '3.5g', price: 25 }
        ]
    },
    {
        name: 'SHAKE BAGS',
        description: '3.5g shake',
        category: 'Shake',
        prices: [
            { size: '3.5g', price: 20 }
        ]
    },
    {
        name: 'MOON ROCK',
        description: 'Premium moon rock',
        category: 'Moon Rock',
        prices: [
            { size: '1g', price: 40 }
        ]
    },
    {
        name: 'EDIBLES',
        description: 'Assorted edibles',
        category: 'Edibles',
        prices: [
            { size: 'Each', price: 40 }
        ]
    },
    {
        name: 'PRE-ROLLS',
        description: 'Any strain pre-rolled',
        category: 'Pre-Rolls',
        prices: [
            { size: 'Each', price: 20 }
        ]
    }
];

async function bulkImportProducts(subdomain) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 Bulk Import Products');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(` Subdomain: ${subdomain}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Get merchant by subdomain
    const merchant = db.getMerchantBySubdomain(subdomain);
    if (!merchant) {
        console.error(`❌ Merchant not found for subdomain "${subdomain}"`);
        return false;
    }

    console.log(`✅ Found merchant: ${merchant.id} (${merchant.name})\n`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const productTemplate of PRODUCTS) {
        // Create a product for each size/price variant
        for (const variant of productTemplate.prices) {
            const productName = `${productTemplate.name} - ${variant.size}`;
            const fullDescription = `${productTemplate.description}${variant.size ? ` | Size: ${variant.size}` : ''}`;

            // Check if product already exists
            const existingProducts = db.db.prepare(`
                SELECT * FROM products 
                WHERE merchant_id = ? AND name = ?
            `).all(merchant.id, productName);

            if (existingProducts.length > 0) {
                console.log(`⏭️  Skipped: ${productName} (already exists)`);
                skipped++;
                continue;
            }

            try {
                db.createProduct({
                    merchant_id: merchant.id,
                    name: productName,
                    description: fullDescription,
                    price: variant.price,
                    inventory: 100, // Default starting inventory
                    category: productTemplate.category,
                    image_url: null
                });
                console.log(`✅ Created: ${productName} - $${variant.price}`);
                created++;
            } catch (error) {
                console.error(`❌ Error creating ${productName}:`, error.message);
                errors++;
            }
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Import Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(` Created: ${created}`);
    console.log(` Skipped: ${skipped}`);
    console.log(` Errors: ${errors}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return created > 0;
}

async function testVoiceProductSearch(merchantId, apiBase) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧪 Testing Voice Product Search');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
        // Test 1: Search all products
        console.log('📦 Test 1: Search All Products');
        const response1 = await axios.post(`${apiBase}/voice/products/search`, {
            merchant_id: merchantId,
            query: null
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log(`✅ Status: ${response1.status}`);
        console.log(`✅ Success: ${response1.data.success}`);
        console.log(`✅ Product Count: ${response1.data.product_count}`);
        console.log(`✅ Merchant: ${response1.data.merchant_name}`);

        if (response1.data.products && response1.data.products.length > 0) {
            console.log(`\n📋 Sample Products (first 3):`);
            response1.data.products.slice(0, 3).forEach((product, idx) => {
                console.log(`  ${idx + 1}. ${product.name} - $${product.price} (Available: ${product.available ? 'Yes' : 'No'})`);
            });
        }

        // Test 2: Search with query
        console.log('\n\n🔍 Test 2: Search with Query "blue"');
        const response2 = await axios.post(`${apiBase}/voice/products/search`, {
            merchant_id: merchantId,
            query: 'blue'
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log(`✅ Status: ${response2.status}`);
        console.log(`✅ Product Count: ${response2.data.product_count}`);
        if (response2.data.products && response2.data.products.length > 0) {
            response2.data.products.forEach((product, idx) => {
                console.log(`  ${idx + 1}. ${product.name} - $${product.price}`);
            });
        }

        // Test 3: Get single product
        if (response1.data.products && response1.data.products.length > 0) {
            console.log('\n\n📦 Test 3: Get Single Product');
            const firstProduct = db.getProductsByMerchant(merchantId)[0];
            const response3 = await axios.get(`${apiBase}/voice/products/${firstProduct.id}`, {
                params: { merchant_id: merchantId }
            });

            console.log(`✅ Status: ${response3.status}`);
            console.log(`✅ Product: ${response3.data.product.name} - $${response3.data.product.price}`);
        }

        return true;
    } catch (error) {
        console.error('❌ Error testing product search:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}

async function testCheckout(merchantId, apiBase) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🛒 Testing Checkout Creation');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
        const products = db.getProductsByMerchant(merchantId);
        if (products.length === 0) {
            console.log('⚠️  No products available. Cannot test checkout.');
            return false;
        }

        const testProduct = products[0];
        console.log(`Testing checkout with: ${testProduct.name} ($${testProduct.price})`);

        const checkoutData = {
            merchant_id: merchantId,
            product_id: testProduct.id,
            quantity: 1,
            customer_name: 'Test Customer',
            customer_phone: '+1234567890',
            customer_email: 'test@example.com'
        };

        const response = await axios.post(`${apiBase}/voice/checkout/create`, checkoutData, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log(`✅ Status: ${response.status}`);
        console.log(`✅ Success: ${response.data.success}`);
        if (response.data.checkout_id) {
            console.log(`✅ Checkout ID: ${response.data.checkout_id}`);
        }
        if (response.data.payment_link) {
            console.log(`✅ Payment Link: ${response.data.payment_link}`);
        }
        if (response.data.payment_token) {
            console.log(`✅ Payment Token: ${response.data.payment_token}`);
        }

        return true;
    } catch (error) {
        console.error('❌ Error testing checkout:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}

async function main() {
    const subdomain = process.argv[2] || 'akin-dunbar';
    const apiBase = process.env.API_BASE || 'https://api.doclittle.site';

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 Azure Bulk Import & Test');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(` Subdomain: ${subdomain}`);
    console.log(` API Base: ${apiBase}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Step 1: Import products
    const importSuccess = await bulkImportProducts(subdomain);
    if (!importSuccess) {
        console.error('❌ Product import failed. Cannot proceed with tests.');
        process.exit(1);
    }

    // Step 2: Get merchant ID
    const merchant = db.getMerchantBySubdomain(subdomain);
    if (!merchant) {
        console.error('❌ Merchant not found after import');
        process.exit(1);
    }

    // Step 3: Test product search
    await testVoiceProductSearch(merchant.id, apiBase);

    // Step 4: Test checkout
    await testCheckout(merchant.id, apiBase);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All Tests Complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((err) => {
    console.error('❌ Unexpected error:', err);
    process.exit(1);
});


