/**
 * Seed or update a canonical Snail Mucin product.
 *
 * Usage:
 *   node scripts/seed-snail-mucin-product.js doctor-little
 *   node scripts/seed-snail-mucin-product.js --merchant-id=<merchant_uuid>
 */

require('dotenv').config();
const db = require('../database');

const PRODUCT_ID = 'prod-skin-hydration-serum-snail-mucin';
const PRODUCT_NAME = 'Dark Spot Repair Serum | Snail mucin';
const PRODUCT_PRICE = 29.99;
const PRODUCT_INVENTORY = 200;
const PRODUCT_CATEGORY = 'Serums';
const PRODUCT_PROTOCOL_STAGE = 'Stabilize';
const PRODUCT_TAGS = ['serum', 'snail-mucin', 'hydration', 'barrier', 'collagen', 'centella', 'clinical'];
const PRODUCT_IMAGE_URL = '/images/products/dark-spot-repair-snail-mucin-serum.png';

const PRODUCT_DESCRIPTION = `Snail Mucin Dark Spot Repair Serum & Hydrating Essence.

Transform your complexion with our dual-action Dark Spot Repair Serum. Engineered as a high-performance skin hydration complex, this advanced formula targets the root causes of hyperpigmentation, dehydration, and environmental fatigue. Using a clinical-grade Snail Secretion Filtrate base, this serum delivers the biological building blocks, Hydrolyzed Collagen and Hyaluronic Acid, to physically lock in moisture and fade dark spots.

Unlike standard moisturizers, our dark spot corrector acts as a total dermal recovery treatment. The integration of Centella Asiatica (Cica) and Provitamin B5 (Panthenol) provides immediate calming for reactive skin, while Glycosaminoglycans work at a cellular level to create a plump, firm, and youthful appearance.

This is high-performance skin care designed for the modern professional. Our lightweight, fast-absorbing snail mucin essence ensures deep penetration without residue, making it the perfect foundation for both your morning glow and nightly repair skin routines.

The Clinical Difference: Why It Works
- Intensive Barrier Repair: Strengthens the skin's moisture barrier to prevent water loss and soothe sensitivity.
- Dark Spot & Acne Scar Treatment: Clinically-backed ingredients help even skin tone and smooth rough patches for a "glass skin" finish.
- Dermatology-Focused Ingredients: Formulated with Betaine and Allantoin to condition, protect, and refine skin texture.`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const merchantIdArg = args.find((a) => a.startsWith('--merchant-id='));
  if (merchantIdArg) {
    return { merchantId: merchantIdArg.split('=')[1], subdomain: null };
  }
  return { merchantId: null, subdomain: args[0] || process.env.DEFAULT_TENANT_SUBDOMAIN || 'doctor-little' };
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
      category: PRODUCT_CATEGORY
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

  console.log('✅ Snail Mucin product seed complete');
  console.log(`   Merchant: ${merchant.name} (${merchant.id})`);
  console.log(`   Action: ${result.action}`);
  console.log(`   Product ID: ${product.id}`);
  console.log(`   Price: $${Number(product.price).toFixed(2)}`);
  console.log(`   Inventory: ${product.inventory}`);
}

main();
