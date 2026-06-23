/**
 * Seed or update Retinol Brightening Night Serum as a canonical product.
 *
 * Usage:
 *   node scripts/data/seed-retinol-peptide-night-serum-product.js --merchant-id=<merchant_uuid>
 *   node scripts/data/seed-retinol-peptide-night-serum-product.js <subdomain>
 */

require('dotenv').config();
const db = require('../../database');

const PRODUCT_ID = 'prod-retinol-peptide-night-serum';
const PRODUCT_NAME = 'Retinol Brightening Night Serum';
const PRODUCT_PRICE = 29.99;
const PRODUCT_INVENTORY = 200;
const PRODUCT_CATEGORY = 'Serums';
const PRODUCT_PROTOCOL_STAGE = 'Rebuild';
const PRODUCT_TAGS = ['serum', 'retinol', 'peptide', 'night', 'rebuild', 'clinical', 'collagen'];
const PRODUCT_IMAGE_URL = '/images/products/retinol-brightening-night-serum.png';

const PRODUCT_DESCRIPTION = `The Retinol + Peptide Resurfacing Complex is a medical-grade formula engineered to fundamentally transform skin health while you sleep. Designed as the "Rebuild" anchor of a professional skin care routine, this high-potency serum combines Retinol—the gold standard in dermatology—with a targeted Hexapeptide-11 chain to physically resurface skin texture and restore structural firmness.

This is not a traditional moisturizer; it is a bio-active treatment for the modern skin profile. By accelerating cellular turnover, the complex clears deep-seated congestion and smooths fine lines, while the Peptide matrix signals the body to synthesize new collagen. To ensure a "guaranteed transformation" without the typical irritation of high-strength Vitamin A, we’ve integrated Bisabolol and Nourishing Phospholipids to stabilize the skin moisture barrier and maintain a balanced, calm complexion.

The lightweight, silky delivery system is optimized for fast absorption, allowing the active ingredients to penetrate deeply without a heavy residue. It is the essential final step for anyone seeking a polished, even, and high-clarity skin appearance.

The Clinical Difference:
- Structural Renewal: Stimulates the skin to produce new, healthy cells for a younger appearance.
- Precision Peptides: Uses Hexapeptide-11 to improve skin elasticity and tone.
- Barrier Protection: Phospholipids act as a delivery vehicle that mimics the skin’s natural lipids, reducing sensitivity.

Suggested Use:
For maximum skin care results, apply 3–4 drops to a cleansed face and neck in the evening only. This formula is the "Rebuild" stage of our clinical cycle. Crucial: Always apply a broad-spectrum SPF 30+ the following morning, as Retinol increases skin sensitivity to UV light.`;

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

  console.log('✅ Retinol Brightening Night Serum seed complete');
  console.log(`   Merchant: ${merchant.name} (${merchant.id})`);
  console.log(`   Action: ${result.action}`);
  console.log(`   Product ID: ${product.id}`);
  console.log(`   Price: $${Number(product.price).toFixed(2)}`);
  console.log(`   Inventory: ${product.inventory}`);
}

main();

