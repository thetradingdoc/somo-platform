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
const PRODUCT_NAME = 'Skin Hydration Serum | Snail Mucin';
const PRODUCT_PRICE = 29.99;
const PRODUCT_INVENTORY = 200;
const PRODUCT_CATEGORY = 'Serums';
const PRODUCT_PROTOCOL_STAGE = 'Stabilize';
const PRODUCT_TAGS = ['serum', 'snail-mucin', 'hydration', 'barrier', 'collagen', 'centella', 'clinical'];
const PRODUCT_IMAGE_URL = '/images/products/snail-mucin-serum.png';

const PRODUCT_DESCRIPTION = `Unlock a higher standard of skin care with the Skin Hydration Serum. Engineered for deep skin transformation, this advanced serum targets the foundational causes of dehydration and environmental fatigue.

By utilizing a high-concentration Snail Secretion Filtrate base, this formula provides the essential biological building blocks, Hydrolyzed Collagen and Hyaluronic Acid, to physically lock in moisture and resurface uneven skin texture.

Unlike standard moisturizers, our complex acts as a dermal recovery treatment. The integration of Centella Asiatica and Provitamin B5 (Panthenol) provides immediate calming for reactive skin, while Glycosaminoglycans work at a cellular level to enhance a plump, firm, and youthful appearance.

This is high-performance skin care designed for the modern professional. The lightweight, fast-absorbing delivery system ensures deep penetration without residue, making it the perfect clinical foundation for both your morning protection and nightly repair skin routines.

The Clinical Difference:
- Intensive Barrier Support: Repairs the skin moisture barrier to prevent trans-epidermal water loss.
- Advanced Texture Correction: Smooths fine lines and rough patches for a glass skin finish.
- Dermatology-Focused Ingredients: Formulated with Betaine and Allantoin to condition and protect sensitive skin.

Suggested Use:
For a complete skin care transformation, apply 3 to 4 drops to a clean face and neck. For best results, use as the Stabilize step in your routine, following your Vitamin C antioxidant serum and preceding your Retinol nightly treatment.`;

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
