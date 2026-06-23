/**
 * Seed or update Vitamin C Serum | Antioxidant Pro-Shield as a canonical product.
 *
 * Usage:
 *   node scripts/data/seed-vitamin-c-serum-product.js --merchant-id=<merchant_uuid>
 *   node scripts/data/seed-vitamin-c-serum-product.js <subdomain>
 */

require('dotenv').config();
const db = require('../../database');

const PRODUCT_ID = 'prod-vitamin-c-serum-antioxidant-pro-shield';
const PRODUCT_NAME = 'Vitamin C Serum | Antioxidant Pro-Shield';
const PRODUCT_PRICE = 21.99;
const PRODUCT_INVENTORY = 200;
const PRODUCT_CATEGORY = 'Serums';
const PRODUCT_PROTOCOL_STAGE = 'Protect';
const PRODUCT_TAGS = [
  'serum',
  'vitamin-c',
  'antioxidant',
  'protect',
  'morning',
  'ferulic',
  'triple-c',
  'clinical',
  'photo-protection'
];
const PRODUCT_IMAGE_URL = '/images/products/vitamin-c-serum.png';

const PRODUCT_DESCRIPTION = `The Vitamin C Serum is a high-potency skin care treatment engineered to neutralize oxidative stress and provide a clinical defense against environmental DNA damage. As the "Protect" stage of our professional skin care protocol, this serum features a stabilized triple-C matrix of L-Ascorbic Acid, Magnesium Ascorbyl Phosphate, and 3-Glyceryl Ascorbate. When synergized with Ferulic Acid, these bio-available actives provide a 15% equivalent antioxidant capacity to inhibit the enzymatic triggers of hyperpigmentation and dark spots.

Designed for the high-exposure NYC environment, this complex does more than brighten; it functions as a secondary biological shield. The integration of Rice Extract and Calendula supports the skin moisture barrier, while Imperata Cylindrica Root provides deep-tissue hydration. This medical-grade formulation is essential for patients seeking a "guaranteed transformation" in skin clarity, luminosity, and structural resilience.

The lightweight delivery system is optimized for morning application, ensuring that the skin is fortified against UV-induced free radicals and urban pollutants throughout the day.

The Clinical Difference:
- Triple-Phase Vitamin C: Utilizes three distinct forms of Vitamin C for maximum stability and multi-layer skin penetration.
- Photo-Protection Synergy: Ferulic Acid doubles the photoprotective capacity of Vitamin C, making it a critical requirement for daytime skin care.
- Botanical Conditioning: Chamomilla Recutita and Calendula provide anti-inflammatory support to maintain a calm, radiant complexion.

Suggested Use:
For a complete skin care transformation, apply a small amount to clean, dry skin every morning. This is the "Protect" step in your clinical cycle. Clinical Note: Always follow with a broad-spectrum SPF 30+ to seal the antioxidant shield and prevent further UV damage.`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const merchantIdArg = args.find((a) => a.startsWith('--merchant-id='));
  if (merchantIdArg) {
    return { merchantId: merchantIdArg.split('=')[1], subdomain: null };
  }
  return { merchantId: null, subdomain: args[0] || process.env.DEFAULT_TENANT_SUBDOMAIN || 'demo' };
}

function resolveMerchant({ merchantId, subdomain }) {
  if (merchantId) {
    const merchant = db.getMerchant(merchantId);
    if (!merchant) throw new Error(`Merchant not found for id ${merchantId}`);
    return merchant;
  }
  const merchant = db.getMerchantBySubdomain(subdomain);
  if (!merchant) throw new Error(`Merchant not found for subdomain ${subdomain}`);
  return merchant;
}

function upsertProduct(merchantId) {
  const existing = db.getProduct(PRODUCT_ID);
  if (existing) {
    db.updateProduct(PRODUCT_ID, {
      merchant_id: merchantId,
      name: PRODUCT_NAME,
      description: PRODUCT_DESCRIPTION,
      price: PRODUCT_PRICE,
      inventory: PRODUCT_INVENTORY,
      image_url: PRODUCT_IMAGE_URL,
      category: PRODUCT_CATEGORY,
      tags: PRODUCT_TAGS,
      protocol_stage: PRODUCT_PROTOCOL_STAGE
    });
    return { action: 'updated', id: PRODUCT_ID };
  }

  db.createProduct({
    id: PRODUCT_ID,
    merchant_id: merchantId,
    name: PRODUCT_NAME,
    description: PRODUCT_DESCRIPTION,
    price: PRODUCT_PRICE,
    inventory: PRODUCT_INVENTORY,
    image_url: PRODUCT_IMAGE_URL,
    category: PRODUCT_CATEGORY,
    tags: PRODUCT_TAGS,
    protocol_stage: PRODUCT_PROTOCOL_STAGE
  });
  return { action: 'created', id: PRODUCT_ID };
}

function main() {
  const args = parseArgs(process.argv);
  const merchant = resolveMerchant(args);
  const result = upsertProduct(merchant.id);
  const product = db.getProduct(result.id);

  console.log('✅ Vitamin C Serum seed complete');
  console.log(`   Merchant: ${merchant.name} (${merchant.id})`);
  console.log(`   Action: ${result.action}`);
  console.log(`   Product ID: ${product.id}`);
  console.log(`   Category: ${product.category}`);
  console.log(`   Protocol: ${product.protocol_stage || '—'}`);
  console.log(`   Tags: ${product.tags || '—'}`);
  console.log(`   Price: $${Number(product.price).toFixed(2)}`);
  console.log(`   Inventory: ${product.inventory}`);
}

main();
