export function buildScanQuality(product) {
  const p = product && typeof product === 'object' ? product : {};
  const hasName = !!String(p.product_name || '').trim();
  const hasIngredients = !!String(p.ingredients_text || '').trim();
  const hasCategories = Array.isArray(p.categories_tags) && p.categories_tags.length > 0;
  const hasImage = !!String(p.image_url || '').trim();

  if (hasName && hasIngredients && hasCategories) {
    return {
      tier: 'full',
      analyzeEnabled: true,
      analyzeLabel: 'Analyze for my skin',
      summary: 'Full profile available',
      missing: []
    };
  }

  const missing = [];
  if (!hasName) missing.push('name');
  if (!hasIngredients) missing.push('ingredients');
  if (!hasCategories) missing.push('categories');
  if (!hasImage) missing.push('image');

  if (hasName && (hasIngredients || hasCategories)) {
    return {
      tier: 'partial',
      analyzeEnabled: hasIngredients,
      analyzeLabel: hasIngredients ? 'Analyze with partial profile' : 'Add ingredients to analyze',
      summary: 'Partial profile',
      missing
    };
  }

  return {
    tier: 'insufficient',
    analyzeEnabled: false,
    analyzeLabel: 'Add ingredients to analyze',
    summary: 'Insufficient product data',
    missing
  };
}

