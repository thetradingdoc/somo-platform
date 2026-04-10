export function prependManualIngredientGuard(replyText) {
  return `Based on provided ingredients only: ${String(replyText || '').trim()}`;
}

