'use strict';

/**
 * Open Food / Open Beauty Facts expose several image fields; upstream may omit `image_url`
 * but set `image_front_url`, `image_front_small_url`, or label photos.
 */
const CATALOG_IMAGE_KEYS = [
  'image_url',
  'image_front_url',
  'image_front_small_url',
  'image_small_url',
  'image_ingredients_url',
  'image_nutrition_url',
  'image_packaging_url',
  'image_ingredients_small_url',
  'image_nutrition_small_url',
  'image_packaging_small_url'
];

function pickFirstCatalogImageUrl(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of CATALOG_IMAGE_KEYS) {
    const s = String(obj[k] ?? '').trim();
    if (s && /^https?:\/\//i.test(s)) return s;
  }
  return null;
}

module.exports = {
  CATALOG_IMAGE_KEYS,
  pickFirstCatalogImageUrl
};
