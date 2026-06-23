/**
 * Seed or update Vitamin B3 Serum | Pore & Sebum Control as a canonical product.
 *
 * Usage:
 *   node scripts/data/seed-vitamin-b3-serum-product.js --merchant-id=<merchant_uuid>
 *   node scripts/data/seed-vitamin-b3-serum-product.js <subdomain>
 */

require('dotenv').config();
const db = require('../../database');

const PRODUCT_ID = 'prod-vitamin-b3-serum-pore-sebum-control';
const PRODUCT_NAME = 'Vitamin B3 Serum | Pore & Sebum Control';
const PRODUCT_PRICE = 27.99;
const PRODUCT_INVENTORY = 200;
const PRODUCT_CATEGORY = 'Serums';
const PRODUCT_PROTOCOL_STAGE = 'Stabilize';
const PRODUCT_TAGS = ['serum', 'niacinamide', 'b3', 'stabilize', 'pore', 'sebum', 'barrier', 'clinical'];
const PRODUCT_IMAGE_URL = '/images/products/vitamin-b3-serum.png';

const PRODUCT_DESCRIPTION = `The Barrier Stabilizer 10% is a high-potency clinical solution engineered to optimize skin health and fortify the lipid bilayer. Formulated with a dermatological-grade concentration of Niacinamide (Vitamin B3), this serum is "prescribed" for the correction of enlarged pores, chronic redness, and uneven skin tone. It functions as the "Stabilize" stage of our professional skin care protocol, regulating sebaceous activity while increasing the skin’s natural resilience against environmental stressors.

This advanced complex is reinforced with Sodium Hyaluronate for molecular-level hydration and a Lactobacillus/Arundinaria Gigantea Ferment to bio-hack the skin microbiome. To ensure maximum efficacy for sensitive skin profiles, we have integrated Chamomilla Recutita and Allantoin—botanical compounds clinically recognized for their ability to soothe inflammation and accelerate dermal recovery.

The result is a highly refined, even-toned complexion supported by a structurally sound skin barrier. This lightweight, water-based delivery system ensures rapid absorption, making it an essential daily requirement for all skin types seeking high-clarity results.

The Clinical Difference:
- Sebum Regulation: Clinically targets the root cause of oil overproduction and pore congestion.
- Microbiome Support: Uses fermented filtrates to balance the skin’s protective flora.
- Transepidermal Defense: Sodium Hyaluronate prevents moisture loss, ensuring long-term hydration.

Suggested Use:
For a complete skin care transformation, apply a pea-sized amount to the face and neck using gentle tapping motions. This serum should be applied after cleansing and before heavier oil-based treatments or moisturizers.`;

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

  console.log('✅ Vitamin B3 Serum seed complete');
  console.log(`   Merchant: ${merchant.name} (${merchant.id})`);
  console.log(`   Action: ${result.action}`);
  console.log(`   Product ID: ${product.id}`);
  console.log(`   Price: $${Number(product.price).toFixed(2)}`);
  console.log(`   Inventory: ${product.inventory}`);
}

main();

