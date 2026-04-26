function normalizePayerSuggestions(payers) {
  return (Array.isArray(payers) ? payers : [])
    .map((p) => ({
      payer_id: p?.payer_id || p?.payerId || null,
      payer_name: p?.payer_name || p?.payerName || p?.name || null
    }))
    .filter((p) => p.payer_id || p.payer_name);
}

function resolvePayerSearchResult(searchResult) {
  const payers = Array.isArray(searchResult?.payers) ? searchResult.payers : [];
  const suggestions = normalizePayerSuggestions(payers);

  if (suggestions.length === 0) {
    return {
      status: 'none',
      suggestions: [],
      error: searchResult?.error || 'No payer match found'
    };
  }

  if (suggestions.length === 1) {
    const single = suggestions[0];
    if (!single.payer_id) {
      return {
        status: 'error',
        suggestions,
        error: 'Payer match missing payer_id'
      };
    }
    return {
      status: 'single',
      payer_id: single.payer_id,
      payer_name: single.payer_name || null,
      suggestions
    };
  }

  return {
    status: 'ambiguous',
    suggestions,
    error: `Multiple payer matches found (${suggestions.length})`
  };
}

module.exports = {
  normalizePayerSuggestions,
  resolvePayerSearchResult
};

