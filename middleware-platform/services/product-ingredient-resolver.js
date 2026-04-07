const db = require('../database');

function _norm(s) {
  return String(s || '').trim().toLowerCase();
}

async function resolveProductByName({ productName, brand = '' } = {}) {
  const name = _norm(productName);
  if (!name) return { success: false, error: 'product_name_required' };
  const matches = db.findProductCatalogByName ? db.findProductCatalogByName(name, brand || null, 5) : [];
  if (!matches.length) {
    return { success: false, error: 'product_not_found', product_name: productName, brand: brand || null, matches: [] };
  }
  const top = matches[0];
  const ingredients = db.getProductIngredients ? db.getProductIngredients(top.id) : [];
  return {
    success: true,
    product: {
      id: top.id,
      source: top.source,
      source_product_id: top.source_product_id,
      brand: top.brand,
      product_name: top.product_name,
      inci_text: top.inci_text
    },
    ingredients,
    matches: matches.map((m) => ({ id: m.id, brand: m.brand, product_name: m.product_name })).slice(0, 5)
  };
}

async function lookupIngredientFunctions(inciList) {
  const list = Array.isArray(inciList) ? inciList.map(_norm).filter(Boolean) : [];
  if (!list.length) return { success: false, error: 'inci_list_required' };
  const results = list.map((inci) => {
    const cosing = db.getCosingIngredientByInci ? db.getCosingIngredientByInci(inci) : null;
    const restrictions = db.getCosmeticRestrictionsByInci ? db.getCosmeticRestrictionsByInci(inci) : [];
    return {
      inci_name: inci,
      functions: cosing?.functions || [],
      cosing,
      restrictions
    };
  });
  return { success: true, results };
}

module.exports = {
  resolveProductByName,
  lookupIngredientFunctions
};
