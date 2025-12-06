/**
 * Bulk Import Products Script
 * Imports products from VIBESAK/VIBES AK product lists
 * 
 * Usage:
 *   NODE_ENV=production node middleware-platform/scripts/bulk-import-products.js <subdomain> [--dry-run]
 * 
 * Example:
 *   NODE_ENV=production node middleware-platform/scripts/bulk-import-products.js akin-dunbar
 */

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');

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

async function main() {
    const [subdomain, ...flags] = process.argv.slice(2);
    const isDryRun = flags.includes('--dry-run');

    if (!subdomain) {
        console.error('Usage: node bulk-import-products.js <subdomain> [--dry-run]');
        console.error('Example: node bulk-import-products.js akin-dunbar');
        process.exit(1);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 Bulk Import Products');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(` Subdomain: ${subdomain}`);
    console.log(` Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (will create products)'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Get merchant by subdomain
    const merchant = db.getMerchantBySubdomain(subdomain);
    if (!merchant) {
        console.error(`❌ Merchant not found for subdomain "${subdomain}"`);
        console.error('   Please create the merchant first or check the subdomain.');
        process.exit(1);
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

            if (isDryRun) {
                console.log(`[DRY RUN] Would create: ${productName} - $${variant.price}`);
                created++;
            } else {
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
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Import Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(` Created: ${created}`);
    console.log(` Skipped: ${skipped}`);
    console.log(` Errors: ${errors}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (isDryRun) {
        console.log('⚠️  This was a DRY RUN. No products were actually created.');
        console.log('   Run without --dry-run to create products.\n');
    } else {
        console.log('✅ Bulk import complete!\n');
    }
}

main().catch((err) => {
    console.error('❌ Unexpected error:', err);
    process.exit(1);
});


